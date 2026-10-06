/**
 * Cleanup: the preview of what *would* move, and the one step that actually moves it.
 *
 * Two halves, deliberately kept in one module so the safer half is what the dangerous
 * half is built on:
 *
 * 1. **The preview** answers "what would actually happen?" without any of it happening.
 *    It runs the same read-only scan the report runs and has no write of any kind.
 *    It enumerates the safe categories with a much higher ceiling than the report's Top
 *    N, because a plan that lists fifteen of forty folders is a lie about what would move.
 * 2. **The move** renames the previewed items into a quarantine folder and writes a
 *    manifest beside them. Three properties make it recoverable by construction:
 *
 *    - **It never deletes anything.** `rename` is the only mutating call in this file, so
 *      the bytes always still exist somewhere; emptying the quarantine is the user's job,
 *      done outside this plugin. There is no code path here that can destroy data.
 *    - **The manifest is written after every item**, not at the end, so an interrupted run
 *      still leaves a record that matches the disk exactly.
 *    - **Undo re-validates the manifest** before moving anything back: the batch id must
 *      be a timestamp, every recorded target must sit inside that batch, and every
 *      recorded original must sit inside a root the scan actually covers. A tampered or
 *      hand-edited manifest therefore cannot be used to move files anywhere else, and an
 *      original path that is occupied again is refused rather than overwritten.
 *
 * The tiers that cannot be cleaned correctly by moving bytes stay out of both halves:
 * ⚪「不要动」holds the program, the runtime and the conversations, and 🟠「要谨慎处理」
 * holds the installed plugins, where "move it and restart" is guaranteed to fail.
 *
 * @module dsh-disk-doctor/cleanup
 */

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

import { timestampSlug } from './report.js'
import { scan } from './scan.js'
import { CATEGORY_DEFS, isUnder, ownsCleanupPath, pathKey, resolveTargets } from './targets.js'

/**
 * How many items per safe category a preview enumerates. A plan must be able to say
 * "this is everything"; a category that exceeds this is reported as truncated instead
 * of quietly listing a prefix.
 */
export const PREVIEW_ITEM_LIMIT = 500

/**
 * How recently an item may have been touched and still be considered in use.
 *
 * Temporary spill directories are the reason this rule exists: DSH creates them while
 * it works, and on this machine the largest "safely cleanable" item at any moment is
 * usually the running session's own subprocess spill. Moving that out from under a live
 * process is not a cleanup, it is a way to break something — and no amount of file
 * deletion is worth that. Anything younger than this window, or that cannot be
 * inspected at all, is left out of the plan and reported instead.
 */
export const RECENT_USE_MS = 60 * 60 * 1000

/** Where the one writable area of the plugin lives, relative to the data folder. */
const QUARANTINE_SEGMENTS = ['disk-doctor', 'quarantine']

/** The record each batch carries, so an undo needs nothing but the disk. */
export const MANIFEST_NAME = 'manifest.json'

/** A batch folder name: the timestamp slug the plan proposes, plus a suffix when two runs
 * land in the same second. Each run must have its own record, because two runs sharing one
 * manifest would leave the first run's moves unrecorded — and unrecorded means un-undoable. */
const BATCH_ID_PATTERN = /^\d{8}-\d{6}(-\d+)?$/

/**
 * The quarantine folder for a data directory.
 * @param {string} dshHome - the data folder.
 * @returns {string} its path.
 */
export function quarantineRoot (dshHome) {
  return path.join(dshHome, ...QUARANTINE_SEGMENTS)
}

/**
 * The categories allowed to take part: the 🟢「可以安全清理」ones, and only those.
 *
 * The refused tiers are refused for a stated reason rather than by omission:
 * ⚪「不要动」holds the program itself, the runtime and the conversations, and moving
 * any of it breaks DSH; 🟠「要谨慎处理」holds the installed plugins, where "move it and
 * restart to see" is guaranteed to fail — that is the expected outcome, not evidence
 * that the move was unsafe. Neither tier can be cleaned correctly by moving bytes.
 *
 * @returns {{ ids: string[], labels: string[] }} the eligible category ids and labels.
 */
export function cleanableCategories () {
  const defs = CATEGORY_DEFS.filter((def) => def.safety === 'safe')
  return { ids: defs.map((def) => def.id), labels: defs.map((def) => def.label) }
}

/**
 * The folder this cleanup would use, were it ever to move anything.
 * @param {string} dshHome - the data folder.
 * @param {Date} [now] - the instant the plan is drawn up.
 * @returns {string} the quarantine folder for this run.
 */
export function quarantineDirectory (dshHome, now = new Date()) {
  return path.join(dshHome, ...QUARANTINE_SEGMENTS, timestampSlug(now))
}

/**
 * Draw up a dry run.
 *
 * @param {object} options - the same options a scan takes, plus `now`.
 * @param {string} options.dshHome - the data folder.
 * @param {string} options.tempDir - the platform temp directory.
 * @param {string|null} [options.appRoot] - detected install folder (for the notes).
 * @param {string|null} [options.chromiumDir] - detected desktop user data.
 * @param {string|null} [options.pnpmStore] - detected pnpm content store.
 * @param {boolean} [options.followSymlinks] - whether to follow links.
 * @param {string[]} [options.excludeGlobs] - extra exclusions.
 * @param {Date} [options.now] - the instant the plan is drawn up.
 * @returns {Promise<object>} the plan: `dryRun: true`, the items, the totals and the
 *   sentences a reader needs before deciding anything.
 */
export async function planCleanup (options) {
  const now = options.now ?? new Date()
  const eligible = cleanableCategories()
  const report = await scan({
    dshHome: options.dshHome,
    tempDir: options.tempDir,
    appRoot: options.appRoot ?? null,
    appRootSource: options.appRootSource ?? null,
    npmGlobalDsh: options.npmGlobalDsh ?? null,
    chromiumDir: options.chromiumDir ?? null,
    pnpmStore: options.pnpmStore ?? null,
    followSymlinks: options.followSymlinks === true,
    excludeGlobs: options.excludeGlobs ?? [],
    only: eligible.ids,
    topN: PREVIEW_ITEM_LIMIT,
    ...(options.limits === undefined ? {} : { limits: options.limits })
  })

  const items = []
  const skipped = []
  const categories = []
  let truncated = false
  for (const category of report.categories) {
    if (category.bytes === 0 && category.itemCount === 0) continue
    if (category.itemCount > category.topItems.length) truncated = true
    categories.push({
      id: category.id,
      label: category.label,
      bytes: category.bytes,
      files: category.files,
      itemCount: category.itemCount
    })
    for (const item of category.topItems) {
      // Anything recently touched — or unreadable, which is not the same as absent — is
      // left where it is; see RECENT_USE_MS. The scan already reports the newest mtime
      // *inside* the item, which is what a live directory actually looks like: a folder's
      // own timestamp stays put while the process keeps writing files into it.
      const recent = await recentlyUsed(item, now)
      if (recent) {
        skipped.push({
          categoryId: category.id,
          categoryLabel: category.label,
          path: item.path,
          bytes: item.bytes,
          reason: 'recent'
        })
        continue
      }
      items.push({
        categoryId: category.id,
        categoryLabel: category.label,
        path: item.path,
        bytes: item.bytes,
        files: item.files,
        mtimeMs: item.mtimeMs ?? 0,
        // Which root it came from, so the move can keep the original layout inside the
        // batch and the undo can prove the path is one the scan is allowed to touch.
        root: category.roots.find((root) => isUnder(item.path, root)) ?? null,
        ...(item.note === undefined ? {} : { note: item.note })
      })
    }
  }
  items.sort((a, b) => b.bytes - a.bytes)
  skipped.sort((a, b) => b.bytes - a.bytes)

  const totalBytes = items.reduce((sum, item) => sum + item.bytes, 0)
  const totalFiles = items.reduce((sum, item) => sum + item.files, 0)

  return {
    schema: 'dsh-disk-doctor/cleanup@1',
    generatedAt: now.toISOString(),
    /** The one thing a reader must not miss. */
    dryRun: true,
    destination: quarantineDirectory(options.dshHome, now),
    totalBytes,
    totalFiles,
    itemCount: items.length,
    truncated,
    eligible: eligible.ids,
    items,
    /** Found but deliberately not planned, with the reason. */
    skipped,
    skippedBytes: skipped.reduce((sum, item) => sum + item.bytes, 0),
    categories,
    warnings: previewWarnings({ totalBytes, truncated, skippedBytes: skipped.reduce((sum, item) => sum + item.bytes, 0) }),
    /** Repeated from the scan so a caller can see what was refused and why. */
    refused: CATEGORY_DEFS
      .filter((def) => def.safety !== 'safe')
      .map((def) => ({ id: def.id, label: def.label, safety: def.safety }))
  }
}

/**
 * Whether an item is too fresh to touch, or cannot be inspected at all.
 *
 * @param {{ path: string, mtimeMs?: number }} item - the scanned item.
 * @param {Date} now - the instant the plan is drawn up.
 * @returns {Promise<boolean>} true when the item must be left alone.
 */
async function recentlyUsed (item, now) {
  if (Number.isFinite(item.mtimeMs) && item.mtimeMs > 0) {
    return now.getTime() - item.mtimeMs < RECENT_USE_MS
  }
  // An item with no file timestamps (an empty directory, say) still gets a look: stat is
  // the fallback, and anything that cannot be inspected is left alone rather than planned.
  try {
    const stat = await fsp.stat(item.path)
    return now.getTime() - stat.mtimeMs < RECENT_USE_MS
  } catch {
    return true
  }
}

/**
 * The sentences that go with a preview, written before anyone acts on it.
 *
 * They answer the two questions a preview raises: "will this break anything?" and
 * "why is the number so small when the disk is full?" — the second one matters, because
 * the tiers that hold the gigabytes are refused on purpose and a reader who is not told
 * that will assume the feature is broken.
 *
 * @param {{totalBytes: number, truncated: boolean, skippedBytes: number}} facts
 *   - what the scan found.
 * @returns {string[]} the warnings.
 */
function previewWarnings (facts) {
  const warnings = [
    '这是**预演**：只列出「如果清理会移动什么」，没有移动、复制或删除任何文件'
  ]
  if (facts.totalBytes === 0 && facts.skippedBytes === 0) {
    warnings.push('现在没有「可以安全清理」的内容，清理功能暂时没有东西可做')
  }
  warnings.push('只有 🟢「可以安全清理」的内容参与；🟠「要谨慎处理」和 ⚪「不要动」一律不参与——' +
    '插件本体、自带运行环境、程序文件和你的对话都不在清理范围内')
  if (facts.totalBytes > 0) {
    warnings.push('这些内容 DSH 会按需重新生成（市场缓存、安装日志、下载缓存、临时文件），' +
      '所以清理不会影响使用，只是下次用到时要重新下载或重建')
  }
  if (facts.skippedBytes > 0) {
    warnings.push(`另有 ${facts.skippedBytes} 字节的临时内容最近 1 小时内还在改动，可能正被 DSH 使用，` +
      '这次不列入计划（等它们安静下来再清）')
  }
  if (facts.truncated) {
    warnings.push(`某一类的条目超过 ${PREVIEW_ITEM_LIMIT} 条，上面没有列全（总量仍然准确）`)
  }
  return warnings
}

/**
 * Move everything the preview lists into a fresh quarantine batch.
 *
 * The plan is drawn up *now*, immediately before anything moves, so this can never act
 * on a stale list: an item that started being written to since the user looked at the
 * preview simply drops out of the move and is reported in `skippedRecent`. Each item is
 * then renamed — never copied, never deleted — and the manifest is rewritten after every
 * successful move, so the record on disk matches reality even if the process dies.
 *
 * @param {object} options - the preview's options, plus `now`.
 * @param {string} options.dshHome - the data folder.
 * @param {string} options.tempDir - the platform temp directory.
 * @param {Date} [options.now] - the instant the move starts.
 * @returns {Promise<object>} the batch: what moved, what failed and why.
 */
export async function performCleanup (options) {
  const now = options.now ?? new Date()
  const plan = await planCleanup({ ...options, now })
  // Its own folder, even when another run proposed the same second.
  const batchDir = freeBatchDir(plan.destination)
  const record = {
    schema: 'dsh-disk-doctor/quarantine@1',
    id: path.basename(batchDir),
    createdAt: now.toISOString(),
    dshHome: options.dshHome,
    status: 'moving',
    bytes: 0,
    files: 0,
    items: [],
    skippedRecent: plan.skipped,
    failures: []
  }

  if (plan.items.length === 0) {
    // Nothing to move means nothing to create: the preview promised this folder does not
    // exist, and an empty batch folder plus a manifest would quietly make that false.
    return { ...record, status: 'nothing-to-move', manifestPath: null }
  }
  fs.mkdirSync(batchDir, { recursive: true })
  writeManifest(batchDir, record)

  for (const item of plan.items) {
    // Defence in depth: the plan built this list, and it is still checked before every
    // single move. Anything a cleanup may not own, or that is gone since the scan, is
    // refused rather than touched.
    if (!ownsCleanupPath(options, item.path)) {
      record.failures.push({ original: item.path, reason: 'outside-root' })
      continue
    }
    if (!fs.existsSync(item.path)) {
      record.failures.push({ original: item.path, reason: 'missing' })
      continue
    }
    let target
    try {
      target = uniqueTarget(batchDir, item)
      // Belt and braces: a target that escaped the batch would be a move nobody could undo.
      if (!isUnder(target, batchDir)) {
        record.failures.push({ original: item.path, reason: 'target-outside-batch' })
        continue
      }
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.renameSync(item.path, target)
    } catch (error) {
      record.failures.push({ original: item.path, reason: String(error?.code ?? error?.message ?? error) })
      continue
    }
    record.items.push({
      categoryId: item.categoryId,
      original: item.path,
      target,
      bytes: item.bytes,
      files: item.files,
      mtimeMs: item.mtimeMs ?? 0
    })
    record.bytes += item.bytes
    record.files += item.files
    // Written after every item, so an interrupted run still records exactly what moved. If
    // the record cannot be written, the run stops here: an unrecorded move is the one
    // outcome this design must never produce, and the items already listed stay undoable.
    try {
      writeManifest(batchDir, record)
    } catch (error) {
      record.failures.push({ original: item.path, reason: 'manifest-write-failed' })
      record.status = 'moved-with-failures'
      return { ...record, manifestPath: path.join(batchDir, MANIFEST_NAME) }
    }
  }

  record.status = record.failures.length === 0 ? 'moved' : 'moved-with-failures'
  writeManifest(batchDir, record)
  return { ...record, manifestPath: path.join(batchDir, MANIFEST_NAME) }
}

/**
 * The batch folder for this run: the proposed one, or the first free `-N` variant.
 *
 * Two runs that start in the same second would otherwise share a folder, and the second
 * manifest would overwrite the first — leaving the first run's moved files in quarantine
 * with nothing on disk that says where they came from.
 *
 * @param {string} proposed - the folder the plan proposed.
 * @returns {string} a folder that does not exist yet.
 */
function freeBatchDir (proposed) {
  if (!fs.existsSync(proposed)) return proposed
  for (let index = 2; index < 1000; index++) {
    const candidate = `${proposed}-${index}`
    if (!fs.existsSync(candidate)) return candidate
  }
  throw new Error('EEXIST')
}

/**
 * Where one item goes inside a batch: its category, then the original layout underneath
 * its root, so a look inside the quarantine still tells you where things came from.
 *
 * A name that is already taken gets a numeric suffix. Two profiles both have a
 * `.dsh-market`, and the second one must not land on top of the first.
 *
 * @param {string} batchDir - the batch folder.
 * @param {{ categoryId: string, path: string, root: string }} item - the planned item.
 * @returns {string} a free target path.
 */
function uniqueTarget (batchDir, item) {
  const relative = path.relative(item.root, item.path)
  const leaf = relative === '' ? path.basename(item.path) : relative
  const base = path.join(batchDir, item.categoryId, leaf)
  if (!fs.existsSync(base)) return base
  for (let index = 2; index < 1000; index++) {
    const candidate = `${base}-${index}`
    if (!fs.existsSync(candidate)) return candidate
  }
  throw new Error('EEXIST')
}

/** Write the batch record. The manifest is the only thing standing between a move and an undo. */
function writeManifest (batchDir, record) {
  fs.mkdirSync(batchDir, { recursive: true })
  fs.writeFileSync(path.join(batchDir, MANIFEST_NAME), `${JSON.stringify(record, null, 2)}\n`, 'utf8')
}

/**
 * Read one batch's manifest.
 * @param {string} dshHome - the data folder.
 * @param {string} id - the batch id.
 * @returns {object|null} the record, or null when there is no readable manifest there.
 */
export function readManifest (dshHome, id) {
  if (typeof id !== 'string' || !BATCH_ID_PATTERN.test(id)) return null
  try {
    const raw = fs.readFileSync(path.join(quarantineRoot(dshHome), id, MANIFEST_NAME), 'utf8')
    const parsed = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

/**
 * Every quarantine batch on disk, newest first.
 * @param {string} dshHome - the data folder.
 * @returns {Array<object>} one summary per batch.
 */
export function listQuarantine (dshHome) {
  const root = quarantineRoot(dshHome)
  let names
  try {
    names = fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && BATCH_ID_PATTERN.test(entry.name))
      .map((entry) => entry.name)
  } catch {
    return []
  }
  return names.sort().reverse().map((id) => {
    const record = readManifest(dshHome, id)
    return {
      id,
      path: path.join(root, id),
      createdAt: record?.createdAt ?? null,
      status: record?.status ?? 'unreadable',
      itemCount: record?.items?.length ?? 0,
      bytes: record?.bytes ?? 0,
      failures: record?.failures?.length ?? 0
    }
  })
}

/**
 * Move one batch back where it came from.
 *
 * Everything is re-validated against the disk before a single rename happens: the batch
 * id must be a timestamp, every target must sit inside that batch, and every original
 * must sit inside a root the scan covers. A path that is occupied again is refused, never
 * overwritten — the point of a quarantine is that the user's data survives both the move
 * and the undo.
 *
 * @param {object} options - the scan environment plus `id`.
 * @param {string} options.dshHome - the data folder.
 * @param {string} options.tempDir - the platform temp directory.
 * @param {string} options.id - the batch to undo.
 * @returns {object} what was restored, what was refused and why.
 */
export function undoCleanup (options) {
  const { dshHome, id } = options
  const record = readManifest(dshHome, id)
  if (record === null) return { ok: false, reason: 'no-manifest', id }
  if (record.status === 'undone') return { ok: false, reason: 'already-undone', id }

  const batchDir = path.join(quarantineRoot(dshHome), id)
  const restored = []
  const failures = []

  // Reverse order, so nested items come back before the folder that contains them.
  for (const item of [...(record.items ?? [])].reverse()) {
    if (typeof item?.target !== 'string' || typeof item?.original !== 'string') {
      failures.push({ original: String(item?.original ?? ''), reason: 'bad-record' })
      continue
    }
    if (!isUnder(item.target, batchDir)) {
      failures.push({ original: item.original, reason: 'target-outside-batch' })
      continue
    }
    if (!ownsCleanupPath(options, item.original)) {
      failures.push({ original: item.original, reason: 'original-outside-roots' })
      continue
    }
    if (!fs.existsSync(item.target)) {
      failures.push({ original: item.original, reason: 'not-in-quarantine' })
      continue
    }
    if (fs.existsSync(item.original)) {
      failures.push({ original: item.original, reason: 'occupied' })
      continue
    }
    try {
      fs.mkdirSync(path.dirname(item.original), { recursive: true })
      fs.renameSync(item.target, item.original)
    } catch (error) {
      failures.push({ original: item.original, reason: String(error?.code ?? error?.message ?? error) })
      continue
    }
    restored.push({ original: item.original, target: item.target, bytes: item.bytes ?? 0 })
  }

  const status = failures.length === 0 ? 'undone' : restored.length === 0 ? record.status : 'partly-undone'
  const updated = { ...record, status, restored, failures: [...(record.failures ?? []), ...failures] }
  writeManifest(batchDir, updated)
  return {
    ok: failures.length === 0,
    id,
    status,
    restored,
    failures,
    restoredBytes: restored.reduce((sum, item) => sum + item.bytes, 0),
    manifestPath: path.join(batchDir, MANIFEST_NAME)
  }
}

/**
 * Every path a cleanup is allowed to touch: the roots of the 🟢 categories, and nothing
 * else. Used to re-validate a manifest before an undo acts on it.
 *
 * @param {object} env - the scan environment.
 * @returns {string[]} the allowed roots.
 */
function safeRoots (env) {
  const { categories } = resolveTargets({
    dshHome: env.dshHome,
    tempDir: env.tempDir,
    appRoot: env.appRoot ?? null,
    chromiumDir: env.chromiumDir ?? null,
    pnpmStore: env.pnpmStore ?? null
  }, new Set(cleanableCategories().ids))
  return categories.flatMap((category) => category.roots.map((root) => root.path))
}
