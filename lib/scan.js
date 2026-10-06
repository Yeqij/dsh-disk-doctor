/**
 * Filesystem traversal and aggregation for the disk report.
 *
 * The walker is deliberately content-blind: it uses `stat` sizes only, never opens
 * a file, and never follows a symlink unless explicitly configured. Every failure
 * mode observed in the field (permission denied, vanished entry, cyclic junction)
 * is recorded and skipped instead of aborting the scan.
 *
 * @module dsh-disk-doctor/scan
 */

import fsp from 'node:fs/promises'
import path from 'node:path'

import { formatBytes } from './report.js'
import { AREA_DEFS, isUnder, pathKey, readWorkspaceIndex, readableProjectKey, resolveTargets } from './targets.js'

/** Default ceilings; a scan stops cleanly and reports `truncated` when it hits one. */
export const DEFAULT_LIMITS = Object.freeze({ maxFiles: 500_000, maxDurationMs: 30_000 })

/** How many `lstat` calls to keep in flight. */
const STAT_CONCURRENCY = 64

/** How many subdirectories to descend at once. */
const DIR_CONCURRENCY = 16

/**
 * Ceilings for the *informational* measurement of linked-away folders.
 *
 * A junction can point at an arbitrarily large tree that the scan does not own; the
 * numbers below keep that side quest from dominating the scan the user asked for.
 *
 * `perRoot` is the important one: one farm of junctions (a pnpm profile's shared
 * `node_modules`, say) must not exhaust the budget before the user's own linked
 * plugins are reached — those are the ones this list exists to surface.
 */
const LINK_LIMITS = Object.freeze({
  maxLinks: 24,
  perRoot: 6,
  maxFiles: 30_000,
  maxDurationMs: 3_000
})

/**
 * Convert one glob to an anchored regular expression.
 *
 * Supports `*` (within a path segment), `**` (across segments) and `?`. This is
 * intentionally a small subset: the config promises extra exclusions, not a full
 * glob engine.
 *
 * @param {string} glob - the pattern, using either separator.
 * @returns {RegExp} a regexp matching normalized `/`-separated absolute paths.
 */
export function globToRegExp (glob) {
  const normalized = glob.replace(/\\/g, '/')
  let out = ''
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i]
    if (ch === '*') {
      if (normalized[i + 1] === '*') {
        i++
        if (normalized[i + 1] === '/') i++
        out += '.*'
      } else {
        out += '[^/]*'
      }
    } else if (ch === '?') {
      out += '[^/]'
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${out}$`, process.platform === 'win32' ? 'i' : '')
}

/**
 * Run `fn` over `items` with a bounded number of concurrent calls.
 * @template T, R
 * @param {T[]} items - inputs.
 * @param {number} limit - maximum concurrent calls.
 * @param {(item: T, index: number) => Promise<R>} fn - worker.
 * @returns {Promise<R[]>} results in input order.
 */
async function mapLimit (items, limit, fn) {
  const results = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await fn(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

/** Format a millisecond timestamp as the local `YYYY-MM-DD` date. */
function formatDay (mtimeMs) {
  const date = new Date(mtimeMs)
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** `realpath` that reports failure as `null` instead of throwing. */
async function safeRealpath (target) {
  try {
    return await fsp.realpath(target)
  } catch {
    return null
  }
}

/**
 * Recursively total one item.
 *
 * @param {string} absPath - the item's path.
 * @param {object} ctx - shared scan state.
 * @returns {Promise<{ bytes: number, files: number, dirs: number, mtimeMs: number }>} the item total.
 */
async function sumTree (absPath, ctx) {
  let bytes = 0
  let files = 0
  let dirs = 0
  let mtimeMs = 0
  const visited = new Set()

  const visit = async (dir) => {
    if (ctx.stopped()) return
    // Following links can reach one real directory twice; count each real
    // directory once. Skipped entirely on the default no-follow path.
    if (ctx.followSymlinks) {
      const real = await safeRealpath(dir)
      const key = real === null ? null : pathKey(real)
      if (key !== null) {
        if (ctx.visitedReal.has(key)) return
        ctx.visitedReal.add(key)
      }
    }
    let entries
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch (err) {
      ctx.unreadable += 1
      ctx.noteUnreadable(dir, err)
      return
    }

    const fileList = []
    const dirList = []

    for (const entry of entries) {
      if (ctx.stopped()) return
      const abs = path.join(dir, entry.name)
      if (ctx.pruned.has(pathKey(abs))) continue
      if (ctx.excludePatterns.length > 0 && ctx.excludePatterns.some((re) => re.test(abs.replace(/\\/g, '/')))) continue

      if (entry.isSymbolicLink()) {
        ctx.symlinks += 1
        if (!ctx.followSymlinks) continue
        let target
        try {
          target = await fsp.stat(abs)
        } catch {
          ctx.unreadable += 1
          continue
        }
        if (target.isDirectory()) dirList.push({ abs, real: await safeRealpath(abs) })
        else if (target.isFile()) fileList.push({ abs, stat: target })
        continue
      }

      if (entry.isDirectory()) dirList.push({ abs })
      else if (entry.isFile()) fileList.push({ abs, stat: null })
      // Sockets, FIFOs and devices carry no reportable size; they are ignored.
    }

    if (fileList.length > 0) {
      await mapLimit(fileList, STAT_CONCURRENCY, async (file) => {
        if (ctx.stopped()) return
        let stat = file.stat
        if (stat === null) {
          try {
            stat = await fsp.lstat(file.abs)
          } catch {
            ctx.unreadable += 1
            return
          }
        }
        if (stat.nlink > 1 && Number.isFinite(stat.ino) && stat.ino !== 0) {
          const inodeKey = `${stat.dev}:${stat.ino}`
          if (ctx.seenInodes !== null) {
            if (ctx.seenInodes.has(inodeKey)) return
            ctx.seenInodes.add(inodeKey)
          }
          // One physical file with several names. The store probe asks whether an
          // earlier category already accounted for this exact file; the answer
          // becomes the overlap figure, never a subtraction from either side.
          if (ctx.hardLinked.has(inodeKey)) {
            if (ctx.probe === true) ctx.probeBytes += stat.size
          } else {
            ctx.hardLinked.set(inodeKey, stat.size)
          }
        }
        bytes += stat.size
        files += 1
        ctx.bytes += stat.size
        ctx.files += 1
        if (stat.mtimeMs > mtimeMs) mtimeMs = stat.mtimeMs
      })
    }

    // Subdirectories are descended concurrently as well. A tree with tens of thousands
    // of directories (an installed npm package is exactly that) spends its time waiting
    // on `readdir`, not on CPU, so walking one directory at a time is what makes a
    // quarter-gigabyte folder take six seconds.
    await mapLimit(dirList, DIR_CONCURRENCY, async (child) => {
      if (ctx.stopped()) return
      if (child.real !== undefined) {
        // The check-and-add is synchronous, so two workers cannot both claim one link.
        if (child.real === null || visited.has(child.real)) return
        visited.add(child.real)
      }
      dirs += 1
      ctx.dirs += 1
      await visit(child.abs)
    })
  }

  await visit(absPath)
  // The item root is a real directory in its own right; counting it keeps the
  // directory total meaningful for categories whose items are directories.
  ctx.dirs += 1
  dirs += 1
  return { bytes, files, dirs, mtimeMs }
}

/**
 * Total a single file item.
 * @param {string} absPath - the file path.
 * @param {object} ctx - shared scan state.
 * @returns {Promise<{ bytes: number, files: number, dirs: number, mtimeMs: number }>} the total.
 */
async function sumFile (absPath, ctx) {
  try {
    const stat = await fsp.lstat(absPath)
    ctx.bytes += stat.size
    ctx.files += 1
    return { bytes: stat.size, files: 1, dirs: 0, mtimeMs: stat.mtimeMs }
  } catch (err) {
    ctx.unreadable += 1
    ctx.noteUnreadable(absPath, err)
    return { bytes: 0, files: 0, dirs: 0, mtimeMs: 0 }
  }
}

/**
 * Build a session item's note from the workspace index and its newest artifact.
 * @param {object} item - the enumerated session item.
 * @param {object} total - the item total (supplies the newest mtime).
 * @param {object} workspaces - the workspace index.
 * @returns {string|undefined} `<date> · <workspace title>` when known.
 */
function sessionNote (item, total, workspaces) {
  const title = workspaces.bySessionId.get(item.sessionId) ?? workspaces.byProjectKey.get(item.projectKey) ??
    readableProjectKey(item.projectKey ?? '')
  const day = total.mtimeMs > 0 ? formatDay(total.mtimeMs) : undefined
  if (day !== undefined && title !== undefined && title !== '') return `${day} · ${title}`
  return day ?? (title === '' ? undefined : title)
}

/**
 * Scan every configured category, grouped into the three reported areas.
 *
 * The three areas are reported side by side and never summed: the pnpm store and the
 * `node_modules` trees it hard-links into hold the same physical files, so a single
 * grand total across areas would double-count real bytes.
 *
 * @param {object} options - resolved scan options.
 * @param {string} options.dshHome - the DSH data folder.
 * @param {string} options.tempDir - the platform temp directory.
 * @param {string|null} [options.appRoot] - the detected application install folder.
 * @param {string|null} [options.chromiumDir] - the detected desktop user-data folder.
 * @param {string|null} [options.pnpmStore] - the detected pnpm content store.
 * @param {number} [options.topN] - items to keep per category (default 10).
 * @param {string[]} [options.excludeGlobs] - extra absolute-path patterns to skip.
 * @param {boolean} [options.followSymlinks] - whether to follow symlinks.
 * @param {{ maxFiles: number, maxDurationMs: number }} [options.limits] - ceilings.
 * @returns {Promise<object>} the report body, ready for rendering.
 */
export async function scan (options) {
  const started = Date.now()
  const limits = { ...DEFAULT_LIMITS, ...(options.limits ?? {}) }
  const topN = Number.isInteger(options.topN) && options.topN > 0 ? options.topN : 10
  const env = {
    dshHome: options.dshHome,
    tempDir: options.tempDir,
    appRoot: pathOrNull(options.appRoot),
    appRootSource: typeof options.appRootSource === 'string' ? options.appRootSource : null,
    npmGlobalDsh: pathOrNull(options.npmGlobalDsh),
    chromiumDir: pathOrNull(options.chromiumDir),
    pnpmStore: pathOrNull(options.pnpmStore)
  }
  const only = Array.isArray(options.only) && options.only.length > 0 ? new Set(options.only) : null
  const { categories: resolved, warnings: targetWarnings, covered } = resolveTargets(env, only)
  const workspaces = readWorkspaceIndex(env.dshHome)

  const warnings = [...targetWarnings, ...workspaces.warnings]
  const unreadablePaths = []
  /** Links that point outside the counted tree; see `recordLinkInstall`. */
  const linkInstalls = []
  const measuredLinkTargets = new Set()
  const perRootLinks = new Map()
  // Links whose target a scanned root already covers need no separate entry: their
  // bytes are counted in that area, and saying "not counted anywhere" would be false.
  const scannedRoots = resolved.flatMap((category) => category.roots.map((root) => root.path))
  let countedLinks = 0
  const linkBudget = {
    remainingFiles: LINK_LIMITS.maxFiles,
    deadline: started + Math.min(LINK_LIMITS.maxDurationMs, limits.maxDurationMs)
  }

  const ctx = {
    bytes: 0,
    files: 0,
    dirs: 0,
    symlinks: 0,
    unreadable: 0,
    truncated: false,
    followSymlinks: options.followSymlinks === true,
    seenInodes: process.platform === 'win32' ? null : new Set(),
    visitedReal: new Set(),
    // inode → size, for files that are one physical file under several names.
    hardLinked: new Map(),
    probe: false,
    probeBytes: 0,
    excludePatterns: (options.excludeGlobs ?? []).map(globToRegExp),
    pruned: covered,
    noteUnreadable (abs, err) {
      if (unreadablePaths.length < 20) unreadablePaths.push({ path: abs, code: err?.code ?? 'UNKNOWN' })
    },
    stopped () {
      if (ctx.truncated) return true
      if (ctx.files >= limits.maxFiles || Date.now() - started > limits.maxDurationMs) {
        ctx.truncated = true
        return true
      }
      return false
    }
  }

  const categories = []
  for (const category of resolved) {
    const before = { bytes: ctx.bytes, files: ctx.files, dirs: ctx.dirs }
    const items = []
    const isExcludedPath = (candidate) =>
      ctx.excludePatterns.length > 0 && ctx.excludePatterns.some((re) => re.test(candidate.replace(/\\/g, '/')))
    for (const root of category.roots) {
      if (ctx.stopped()) break
      if (isExcludedPath(root.path)) continue
      const enumerated = root.whole === true
        ? [{ label: root.label ?? path.basename(root.path), path: root.path, isDir: true }]
        : await category.enumerate(root)
      for (const item of enumerated) {
        if (category.id === 'other' && covered.has(pathKey(item.path))) continue
        // Exclusions are honoured at the item level too, so excluding a category
        // root works even though the walker only ever sees its children.
        if (isExcludedPath(item.path)) continue
        items.push({ ...item, rootIndex: category.roots.indexOf(root) })
      }
    }

    const scored = []
    let linked = 0
    // The store probe is per category, so the overlap figure belongs to one row.
    ctx.probe = category.overlapProbe === true
    ctx.probeBytes = 0
    for (const item of items) {
      if (ctx.stopped()) break
      let isDir = item.isDir === true
      if (item.isSymlink === true) {
        ctx.symlinks += 1
        if (!ctx.followSymlinks) {
          linked += 1
          await recordLinkInstall(item, category, {
            linkInstalls,
            measuredLinkTargets,
            perRoot: perRootLinks,
            scannedRoots,
            onCounted: () => { countedLinks += 1 },
            linkBudget
          })
          continue
        }
        try {
          isDir = (await fsp.stat(item.path)).isDirectory()
        } catch {
          ctx.unreadable += 1
          continue
        }
      }
      const total = isDir ? await sumTree(item.path, ctx) : await sumFile(item.path, ctx)
      scored.push({ item, total })
    }
    scored.sort((a, b) => b.total.bytes - a.total.bytes || a.item.label.localeCompare(b.item.label))

    categories.push({
      id: category.id,
      area: category.area,
      label: category.label,
      labelEn: category.labelEn,
      regenerable: category.regenerable,
      safety: category.safety,
      bytes: ctx.bytes - before.bytes,
      files: ctx.files - before.files,
      dirs: ctx.dirs - before.dirs,
      roots: category.roots.map((root) => root.path),
      itemCount: scored.length,
      linkedItems: linked,
      overlapBytes: ctx.probe ? ctx.probeBytes : 0,
      truncated: ctx.truncated,
      topItems: scored.slice(0, topN).map(({ item, total }) => ({
        path: item.path,
        bytes: total.bytes,
        files: total.files,
        // The newest file inside, not the folder's own timestamp: a directory's mtime does
        // not move when the files within it change, so this is the honest "last touched".
        mtimeMs: Math.round(total.mtimeMs),
        ...(category.id === 'sessions' && sessionNote(item, total, workspaces) !== undefined
          ? { note: sessionNote(item, total, workspaces) }
          : {})
      }))
    })
  }

  const areas = AREA_DEFS
    .map((def) => {
      const own = categories.filter((category) => category.area === def.id)
      const totals = own.reduce((sum, category) => ({
        bytes: sum.bytes + category.bytes,
        files: sum.files + category.files,
        dirs: sum.dirs + category.dirs
      }), { bytes: 0, files: 0, dirs: 0 })
      const notes = [def.note(env)]
      const overlapped = own.reduce((sum, category) => sum + (category.overlapBytes ?? 0), 0)
      if (overlapped > 0) {
        notes.push(`注意：其中约 ${formatBytes(overlapped)} 与「DSH 数据」里的插件文件是同一批物理文件（硬链接），` +
          '所以两个区的数字不能相加，也不是删掉就能省下这么多。')
      }
      return {
        id: def.id,
        label: def.label,
        labelEn: def.labelEn,
        totals,
        roots: own.flatMap((category) => category.roots),
        notes,
        categories: own.map((category) => category.id)
      }
    })
    // An area with nothing selected is left out, so a filtered scan stays to the point.
    .filter((area) => area.categories.length > 0)

  const dataArea = areas.find((area) => area.id === 'data')
  const totals = dataArea?.totals ?? { bytes: 0, files: 0, dirs: 0 }
  const dataCategories = categories.filter((category) => category.area === 'data')

  if (ctx.truncated) {
    warnings.push(`扫描达到上限（${limits.maxFiles} 个文件或 ${Math.round(limits.maxDurationMs / 1000)} 秒），结果不完整`)
  }
  if (ctx.unreadable > 0) warnings.push(`${ctx.unreadable} 个条目无法读取，已跳过（不影响其余统计）`)
  if (ctx.symlinks > 0) {
    warnings.push(`${ctx.symlinks} 个符号链接/junction ${ctx.followSymlinks ? '已跟随' : '未跟随'}，未计入统计`)
  }
  if (linkInstalls.length > 0) {
    warnings.push(`${linkInstalls.length} 个链接安装（例如用 dsh plugin add <本地路径> 装的插件）真实文件在扫描范围之外，` +
      '已单独列出、不计入上面的总数')
  }
  if (countedLinks > 0) {
    warnings.push(`${countedLinks} 个链接安装的目标本身就在扫描范围内（例如 npm 全局安装的那份 DSH），` +
      '它们的字节已经算在所在区里，不再单列')
  }
  for (const missing of unreadablePaths) warnings.push(`无权限或不可读：${missing.path} (${missing.code})`)

  const regenerableBytes = dataCategories
    .filter((category) => category.regenerable)
    .reduce((sum, category) => sum + category.bytes, 0)

  return {
    // The headline number is the data area: the part of DSH the user actually owns.
    // The other two areas carry their own totals and are never added to it.
    totals,
    areas,
    categories,
    linkInstalls,
    regenerableBytes,
    contentBytes: totals.bytes - regenerableBytes,
    symlinks: ctx.symlinks,
    unreadable: ctx.unreadable,
    truncated: ctx.truncated,
    durationMs: Date.now() - started,
    warnings
  }
}

/**
 * A path option as a string, or `null` when it was not detected on this machine.
 * @param {unknown} value - the raw option.
 * @returns {string|null} the path, or null.
 */
function pathOrNull (value) {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/**
 * Measure one link that the scan deliberately did not follow, and remember it.
 *
 * A junction-installed plugin (`dsh plugin add E:\somewhere`) has all of its bytes
 * outside the scanned tree, so it used to vanish from the report entirely — a user
 * who installed something and sees nothing starts distrusting every other number.
 * The entry below states the link, where it really points, and how big that target
 * is; it is kept out of the category totals, which stay purely physical.
 *
 * @param {object} item - the enumerated link item, tagged with its root.
 * @param {object} category - the category being scanned.
 * @param {object} state - shared bookkeeping (list, seen targets, budgets).
 * @returns {Promise<void>}
 */
async function recordLinkInstall (item, category, state) {
  const perRoot = state.perRoot.get(item.rootIndex ?? 0) ?? 0
  if (perRoot >= LINK_LIMITS.perRoot) return
  if (state.linkInstalls.length >= LINK_LIMITS.maxLinks) return
  if (Date.now() > state.linkBudget.deadline || state.linkBudget.remainingFiles <= 0) return
  const target = await safeRealpath(item.path)
  if (target === null) return
  const key = pathKey(target)
  if (state.measuredLinkTargets.has(key)) return
  // A target some scanned root already covers is counted there, so listing it here as
  // "not in any figure" would be a lie. Only the genuinely outside targets are listed.
  if (state.scannedRoots.some((root) => isUnder(target, root))) {
    state.measuredLinkTargets.add(key)
    state.onCounted()
    return
  }
  state.measuredLinkTargets.add(key)
  state.perRoot.set(item.rootIndex ?? 0, perRoot + 1)

  const sink = linkSink(state.linkBudget)
  const total = await sumTree(target, sink)
  state.linkBudget.remainingFiles -= sink.files
  state.linkInstalls.push({
    path: item.path,
    target,
    bytes: total.bytes,
    files: total.files,
    // A bounded measurement is still useful, as long as it says it is bounded.
    truncated: sink.truncated,
    categoryId: category.id,
    area: category.area
  })
}

/**
 * A stand-in scan context for measuring a link target.
 *
 * It carries its own ceilings and writes nowhere near the real counters, so
 * following a link can never change a reported total.
 *
 * @param {{ remainingFiles: number }} budget - the shared budget for link measuring.
 * @returns {object} a context-shaped sink for `sumTree`.
 */
function linkSink (budget) {
  const sink = {
    bytes: 0,
    files: 0,
    dirs: 0,
    symlinks: 0,
    unreadable: 0,
    truncated: false,
    followSymlinks: false,
    seenInodes: null,
    visitedReal: new Set(),
    excludePatterns: [],
    pruned: new Set(),
    noteUnreadable () {},
    stopped () {
      if (sink.truncated) return true
      if (sink.files >= budget.remainingFiles) {
        sink.truncated = true
        return true
      }
      return false
    }
  }
  return sink
}
