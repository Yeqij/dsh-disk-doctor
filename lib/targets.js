/**
 * The scan target table: which paths on disk belong to which report category, and
 * how each category is broken into rankable items.
 *
 * Every category resolves to roots, and every root enumerates **items** — the unit
 * the report ranks. Items partition their root exactly once, so category totals are
 * a plain sum of item totals and no path is ever counted twice.
 *
 * Categories are grouped into three **areas** — the data folder, the application
 * install, and the system caches DSH feeds. The areas are reported side by side and
 * are never added together: the pnpm store and the plugin `node_modules` trees it
 * hard-links into hold the *same physical files*, so a grand total would be a lie.
 * See {@link AREA_DEFS}.
 *
 * Path knowledge here is derived from DSH `0.2.0-rc.2`, including the exact
 * `projectKey()` algorithm that names a session's project directory, so sessions
 * can be labelled with their real workspace title.
 *
 * @module dsh-disk-doctor/targets
 */

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

/**
 * Encode a project directory into the single filesystem-safe directory name DSH
 * uses under `sessions/`.
 *
 * Mirrors `projectKey()` in `@deepseek-ai/dsh-session-persistence-jsonl`
 * (0.2.0-rc.2): separator runs collapse to one `-`, unsafe code units become
 * uppercase `~XXXX`, and the result is wrapped in `--`. The transform is
 * intentionally lossy, so this is used only to *build* a lookup key from a known
 * real path — never to guess a path back from a directory name.
 *
 * @param {string} cwd - absolute project directory.
 * @returns {string} the project directory key, for example `--E-disk-doctor--`.
 */
export function projectKey (cwd) {
  let readable = ''
  let separatorRun = false
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch
      separatorRun = false
    } else {
      readable += '~' + code.toString(16).toUpperCase().padStart(4, '0')
      separatorRun = false
    }
  }
  return `--${(readable.replace(/^-+/, '') || 'root').slice(0, 251)}--`
}

/**
 * Best-effort human form of a project directory key, for when the real path is
 * unknown. `~XXXX` escapes are decoded; remaining `-` stay literal because a
 * separator and a literal hyphen are indistinguishable after encoding.
 *
 * @param {string} key - a directory name produced by {@link projectKey}.
 * @returns {string} a readable label, for example `E-disk-doctor`.
 */
export function readableProjectKey (key) {
  const inner = key.replace(/^--/, '').replace(/--$/, '')
  if (inner === '' || inner === 'root') return 'root'
  return inner.replace(/~([0-9A-Fa-f]{4})/g, (_match, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
}

/**
 * Comparison key for a path, case-insensitive on Windows.
 * @param {string} candidate - absolute path.
 * @returns {string} the normalized comparison key.
 */
export function pathKey (candidate) {
  const resolved = path.resolve(candidate)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

/**
 * True when `candidate` is an existing directory (following symlinks).
 * @param {string} candidate - absolute path to test.
 * @returns {boolean} whether it is a directory.
 */
export function isDirectory (candidate) {
  try {
    return fs.statSync(candidate).isDirectory()
  } catch {
    return false
  }
}

/**
 * Read directory entries, treating any failure as "empty".
 * @param {string} dir - directory to list.
 * @returns {Promise<import('node:fs').Dirent[]>} entries.
 */
async function readEntries (dir) {
  try {
    return await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

/**
 * Classify one directory entry without following symlinks.
 *
 * The default policy leaves links alone, so a link is never expanded and never
 * silently pulls in bytes that live outside `$DSH_HOME`.
 *
 * @param {import('node:fs').Dirent} entry - the entry.
 * @returns {{ isDir: boolean, isSymlink: boolean }} the entry's kind.
 */
function classify (entry) {
  return { isDir: entry.isDirectory(), isSymlink: entry.isSymbolicLink() }
}

/**
 * Depth-1 entries of a root, one item each. The default enumeration.
 * @param {{ path: string }} root - the root.
 * @returns {Promise<object[]>} items.
 */
export async function itemsByFirstLevel (root) {
  const entries = await readEntries(root.path)
  return entries.map((entry) => ({
    label: root.label ?? entry.name,
    path: path.join(root.path, entry.name),
    ...classify(entry)
  }))
}

/**
 * Build the session-id → workspace-title index from DSH's workspace storage.
 *
 * Returns empty maps when the file is missing or malformed, so the report degrades
 * to project-directory keys instead of failing.
 *
 * @param {string} dshHome - the DSH home directory.
 * @returns {{ bySessionId: Map<string, string>, byProjectKey: Map<string, string>, warnings: string[] }}
 *   lookups derived from `storages/workspace.json`.
 */
export function readWorkspaceIndex (dshHome) {
  const bySessionId = new Map()
  const byProjectKey = new Map()
  const warnings = []
  const file = path.join(dshHome, 'storages', 'workspace.json')
  let raw
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch {
    return { bySessionId, byProjectKey, warnings }
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    warnings.push(`workspace.json 无法解析，会话将以项目目录键显示：${file}`)
    return { bySessionId, byProjectKey, warnings }
  }
  const workspaces = parsed?.tables?.workspaces
  if (workspaces === null || typeof workspaces !== 'object') return { bySessionId, byProjectKey, warnings }
  for (const workspace of Object.values(workspaces)) {
    if (workspace === null || typeof workspace !== 'object') continue
    const title = typeof workspace.title === 'string' && workspace.title !== '' ? workspace.title : undefined
    const absPath = typeof workspace.path === 'string' && workspace.path !== '' ? workspace.path : undefined
    const label = title ?? absPath
    if (label === undefined) continue
    if (absPath !== undefined) byProjectKey.set(projectKey(absPath), label)
    if (Array.isArray(workspace.sessionIds)) {
      for (const id of workspace.sessionIds) if (typeof id === 'string') bySessionId.set(id, label)
    }
  }
  return { bySessionId, byProjectKey, warnings }
}

/**
 * Enumerate session directories as `<project key>/<session id>` items.
 * @param {{ path: string }} root - the sessions root.
 * @returns {Promise<object[]>} one item per project directory entry.
 */
async function enumerateSessions (root) {
  const items = []
  for (const projectEntry of await readEntries(root.path)) {
    const projectPath = path.join(root.path, projectEntry.name)
    const projectKind = classify(projectEntry)
    if (!projectKind.isDir) {
      items.push({ label: projectEntry.name, path: projectPath, ...projectKind })
      continue
    }
    for (const sessionEntry of await readEntries(projectPath)) {
      items.push({
        label: `${projectEntry.name}/${sessionEntry.name}`,
        path: path.join(projectPath, sessionEntry.name),
        ...classify(sessionEntry),
        sessionId: sessionEntry.name,
        projectKey: projectEntry.name
      })
    }
  }
  return items
}

/**
 * Enumerate storage items: projection-cache files individually, everything else by
 * first level.
 * @param {{ path: string }} root - the storages root.
 * @returns {Promise<object[]>} items.
 */
async function enumerateStorages (root) {
  const items = []
  for (const entry of await readEntries(root.path)) {
    const entryPath = path.join(root.path, entry.name)
    const kind = classify(entry)
    if (entry.name !== 'session_projcache' || !kind.isDir) {
      items.push({ label: entry.name, path: entryPath, ...kind })
      continue
    }
    const children = await readEntries(entryPath)
    if (children.length === 0) {
      items.push({ label: entry.name, path: entryPath, ...kind })
      continue
    }
    // Projection cache: list each cached session, but keep whatever else lives
    // beside `sessions/`. This whole subtree is a covered root, so a sibling
    // dropped here is dropped by every category.
    for (const child of children) {
      const childPath = path.join(entryPath, child.name)
      const childKind = classify(child)
      if (child.name === 'sessions' && childKind.isDir) {
        const cached = await readEntries(childPath)
        if (cached.length === 0) {
          items.push({ label: `${entry.name}/sessions`, path: childPath, ...childKind })
          continue
        }
        for (const cachedEntry of cached) {
          items.push({
            label: `${entry.name}/sessions/${cachedEntry.name}`,
            path: path.join(childPath, cachedEntry.name),
            ...classify(cachedEntry)
          })
        }
        continue
      }
      items.push({ label: `${entry.name}/${child.name}`, path: childPath, ...childKind })
    }
  }
  return items
}

/**
 * Enumerate `node_modules` packages, keeping npm scopes as one item.
 * @param {{ path: string }} root - a `node_modules` root.
 * @returns {Promise<object[]>} items.
 */
async function enumeratePackages (root) {
  const items = []
  for (const entry of await readEntries(root.path)) {
    const entryPath = path.join(root.path, entry.name)
    const kind = classify(entry)
    if (entry.name.startsWith('@') && kind.isDir) {
      for (const scoped of await readEntries(entryPath)) {
        items.push({
          label: `${entry.name}/${scoped.name}`,
          path: path.join(entryPath, scoped.name),
          ...classify(scoped)
        })
      }
      continue
    }
    items.push({ label: entry.name, path: entryPath, ...kind })
  }
  return items
}

/**
 * Enumerate runtime dependency components, so node/python/pnpm rank apart.
 * @param {{ path: string }} root - the `dsh-runtimes` root.
 * @returns {Promise<object[]>} items.
 */
async function enumerateRuntimes (root) {
  const items = []
  for (const entry of await readEntries(root.path)) {
    const entryPath = path.join(root.path, entry.name)
    const kind = classify(entry)
    if (!kind.isDir) {
      items.push({ label: entry.name, path: entryPath, ...kind })
      continue
    }
    const children = await readEntries(entryPath)
    if (children.length === 0) {
      items.push({ label: entry.name, path: entryPath, ...kind })
      continue
    }
    // A runtime directory holds `dependencies/` plus its own files. Expanding only
    // `dependencies` would drop everything beside it, and the catch-all cannot
    // recover it because this whole subtree is a covered root — so every child is
    // accounted for exactly once.
    for (const child of children) {
      const childPath = path.join(entryPath, child.name)
      const childKind = classify(child)
      if (child.name === 'dependencies' && childKind.isDir) {
        const deps = await readEntries(childPath)
        if (deps.length === 0) {
          items.push({ label: `${entry.name}/dependencies`, path: childPath, ...childKind })
          continue
        }
        for (const dep of deps) {
          items.push({
            label: `${entry.name}/dependencies/${dep.name}`,
            path: path.join(childPath, dep.name),
            ...classify(dep)
          })
        }
        continue
      }
      items.push({ label: `${entry.name}/${child.name}`, path: childPath, ...childKind })
    }
  }
  return items
}

/**
 * The three areas, in report order.
 *
 * `note(env)` states, in one plain sentence, where that area's bytes actually live
 * (or why the area came up empty). It is part of the contract because a report that
 * silently omits a machine's application folder is exactly the failure this
 * separation exists to fix.
 *
 * @type {ReadonlyArray<{ id: string, label: string, labelEn: string, note: (env: object) => string }>}
 */
export const AREA_DEFS = [
  {
    id: 'data',
    label: 'DSH 数据',
    labelEn: 'DSH data',
    note: (env) => `数据文件夹：${env.dshHome}`
  },
  {
    id: 'app',
    label: 'DSH 程序',
    labelEn: 'DSH application',
    note: (env) => {
      const parts = []
      if (isPathString(env.appRoot)) {
        const how = env.appRootSource === 'config' ? '来自设置' : '自动找到'
        parts.push(`安装位置：${env.appRoot}（${how}）`)
      } else {
        parts.push('没能自动找到程序安装位置，这部分没有统计进去（可在设置里填写）')
      }
      if (isPathString(env.npmGlobalDsh)) parts.push(`npm 全局安装：${env.npmGlobalDsh}`)
      parts.push('只读展示，不参与清理')
      return parts.join('；')
    }
  },
  {
    id: 'cache',
    label: '系统缓存',
    labelEn: 'System caches',
    note: (env) => {
      const found = []
      if (isPathString(env.chromiumDir)) found.push(`桌面端用户数据 ${env.chromiumDir}`)
      if (isPathString(env.pnpmStore)) found.push(`pnpm 内容仓库 ${env.pnpmStore}`)
      return found.length === 0
        ? '这台机器上没有找到 DSH 用到的系统缓存'
        : `这些是 DSH 之外的位置，与上面的区不能相加：${found.join('、')}`
    }
  }
]

/** True for a non-empty path string. */
function isPathString (value) {
  return typeof value === 'string' && value !== ''
}

/**
 * The category table. Order is report order; `other` is resolved last because it
 * excludes every other category's roots.
 *
 * Every category names its `area`, which is what keeps the three totals honest:
 * `other` is a catch-all for the data folder only, never for the machine.
 *
 * @type {ReadonlyArray<object>}
 */
export const CATEGORY_DEFS = [
  {
    id: 'sessions',
    area: 'data',
    label: '会话日志',
    labelEn: 'Session logs',
    regenerable: false,
    safety: 'keep',
    resolve: (env) => ({ roots: [{ path: path.join(env.dshHome, 'sessions'), expand: true }] }),
    enumerate: enumerateSessions
  },
  {
    id: 'storages',
    area: 'data',
    label: '存储与投影缓存',
    labelEn: 'Storage and projection cache',
    regenerable: false,
    safety: 'care',
    resolve: (env) => ({ roots: [{ path: path.join(env.dshHome, 'storages'), expand: true }] }),
    enumerate: enumerateStorages
  },
  {
    id: 'profile-deps',
    area: 'data',
    label: '插件 node_modules',
    labelEn: 'Plugin node_modules',
    regenerable: true,
    safety: 'care',
    resolve: (env) => {
      const profilesRoot = path.join(env.dshHome, 'profiles')
      const roots = []
      // A profile's own `node_modules` comes first: that is where a plugin the user
      // installed as a link actually lands, and it must not be crowded out by the
      // shared farm below (which is mostly junctions into the global npm tree).
      let names = []
      try {
        names = fs.readdirSync(profilesRoot, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
      } catch { /* profiles/ absent: no roots */ }
      for (const name of names) {
        const dir = path.join(profilesRoot, name, 'node_modules')
        if (isDirectory(dir)) roots.push({ path: dir, expand: true, profile: name })
      }
      const shared = path.join(profilesRoot, 'node_modules')
      if (isDirectory(shared)) roots.push({ path: shared, expand: true })
      return { roots }
    },
    enumerate: enumeratePackages
  },
  {
    id: 'profile-logs',
    area: 'data',
    label: '插件安装日志',
    labelEn: 'Plugin install logs',
    regenerable: true,
    safety: 'safe',
    resolve: (env) => ({ roots: profileRoots(env, path.join('.plugin-manager', 'logs')) }),
    // What it owns, whether or not the folder is there right now — an undo needs this.
    owns: (env, candidate) => ownsProfileLeaf(env, candidate, ['.plugin-manager', 'logs'])
  },
  {
    id: 'profile-market',
    area: 'data',
    label: '市场数据',
    labelEn: 'Market data',
    regenerable: true,
    safety: 'safe',
    resolve: (env) => ({ roots: profileRoots(env, '.dsh-market') }),
    owns: (env, candidate) => ownsProfileLeaf(env, candidate, ['.dsh-market'])
  },
  {
    id: 'plugin-cache',
    area: 'data',
    label: '插件下载缓存',
    labelEn: 'Plugin package cache',
    regenerable: true,
    safety: 'safe',
    resolve: (env) => ({ roots: [{ path: path.join(env.dshHome, 'plugin-packages'), expand: true }] }),
    owns: (env, candidate) => isUnder(candidate, path.join(env.dshHome, 'plugin-packages'))
  },
  {
    id: 'runtimes',
    area: 'data',
    label: '运行时依赖',
    labelEn: 'Runtime dependencies',
    regenerable: false,
    safety: 'keep',
    resolve: (env) => ({ roots: [{ path: path.join(env.dshHome, 'dsh-runtimes'), expand: true }] }),
    enumerate: enumerateRuntimes
  },
  {
    id: 'temp-spill',
    area: 'data',
    label: '临时目录与溢出',
    labelEn: 'Temp and spill directories',
    regenerable: true,
    safety: 'safe',
    resolve: (env) => {
      const roots = []
      let entries
      try {
        entries = fs.readdirSync(env.tempDir, { withFileTypes: true })
      } catch {
        return { roots, warning: '临时文件夹读不了，这部分没有统计进去' }
      }
      for (const entry of entries) {
        if (!entry.name.startsWith('dsh-')) continue
        const full = path.join(env.tempDir, entry.name)
        if (!isDirectory(full)) continue
        roots.push({ path: full, label: entry.name, whole: true })
      }
      return { roots }
    },
    // Named by shape rather than by a list: `resolve` can only enumerate the `dsh-*`
    // folders that exist at this instant, and straight after a move none of them do.
    owns: (env, candidate) => pathKey(path.dirname(candidate)) === pathKey(env.tempDir) &&
      path.basename(candidate).startsWith('dsh-')
  },
  {
    id: 'attachments',
    area: 'data',
    label: '附件',
    labelEn: 'Attachments',
    regenerable: false,
    safety: 'keep',
    resolve: (env) => {
      const roots = []
      let entries
      try {
        entries = fs.readdirSync(env.dshHome, { withFileTypes: true })
      } catch {
        return { roots }
      }
      for (const entry of entries) {
        if (!/attach/i.test(entry.name)) continue
        const full = path.join(env.dshHome, entry.name)
        if (isDirectory(full)) roots.push({ path: full, expand: true })
      }
      if (roots.length === 0) {
        return { roots, warning: '你还没用过附件功能，相关内容并进了「其他」' }
      }
      return { roots }
    }
  },
  {
    id: 'runtime-app',
    area: 'data',
    label: 'Electron 运行文件',
    labelEn: 'Electron runtime files',
    regenerable: false,
    safety: 'keep',
    resolve: (env) => ({ roots: [{ path: path.join(env.dshHome, 'electron'), expand: true }] })
  },
  {
    id: 'app-install',
    area: 'app',
    label: '程序安装目录',
    labelEn: 'Application install folder',
    regenerable: false,
    safety: 'keep',
    resolve: (env) => (isPathString(env.appRoot)
      ? { roots: [{ path: env.appRoot, expand: true }] }
      : { roots: [] })
  },
  {
    id: 'npm-global-dsh',
    area: 'app',
    label: '全局安装的 DSH（npm）',
    labelEn: 'Global npm DSH install',
    regenerable: false,
    safety: 'keep',
    resolve: (env) => (isPathString(env.npmGlobalDsh)
      ? { roots: [{ path: env.npmGlobalDsh, expand: true }] }
      : { roots: [] })
  },
  {
    id: 'chromium-data',
    area: 'cache',
    label: '桌面端用户数据',
    labelEn: 'Desktop user data',
    regenerable: false,
    safety: 'care',
    resolve: (env) => (isPathString(env.chromiumDir)
      ? { roots: [{ path: env.chromiumDir, expand: true }] }
      : { roots: [] })
  },
  {
    id: 'pnpm-store',
    area: 'cache',
    label: 'pnpm 内容仓库',
    labelEn: 'pnpm content store',
    regenerable: false,
    safety: 'care',
    // The store holds the real files that plugin `node_modules` entries hard-link
    // to, so this category is the one that reports how much of it is shared with
    // the data area rather than counted twice.
    overlapProbe: true,
    resolve: (env) => (isPathString(env.pnpmStore)
      ? { roots: [{ path: env.pnpmStore, expand: true }] }
      : { roots: [] })
  },
  {
    id: 'other',
    area: 'data',
    label: '其他',
    labelEn: 'Other',
    regenerable: false,
    safety: 'care',
    resolve: (env) => ({ roots: [{ path: env.dshHome, expand: true, isCatchAll: true }] })
  }
]

/** One item per profile root under `profiles/<name>/<leaf>`. */
function profileRoots (env, leaf) {
  const profilesRoot = path.join(env.dshHome, 'profiles')
  const roots = []
  let names = []
  try {
    names = fs.readdirSync(profilesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch { /* profiles/ absent */ }
  for (const name of names) {
    const dir = path.join(profilesRoot, name, leaf)
    if (isDirectory(dir)) roots.push({ path: dir, label: name, whole: true, profile: name })
  }
  return roots
}

/**
 * Resolve the category table against a concrete environment.
 *
 * Categories whose roots do not exist come back with `roots: []` plus a warning, so
 * the report can state what was looked for instead of silently omitting it.
 *
 * @param {{ dshHome: string, tempDir: string, appRoot?: string|null,
 *   chromiumDir?: string|null, pnpmStore?: string|null }} env - resolved scan environment.
 * @param {Set<string>|null} [only] - when set, resolve only these category ids.
 * @returns {{ categories: object[], warnings: string[], covered: Set<string> }}
 *   resolved categories in report order, plus the path keys the catch-all must skip.
 */
export function resolveTargets (env, only = null) {
  const categories = []
  const warnings = []
  const covered = new Set()
  const isSelected = (id) => only === null || only.has(id)

  for (const def of CATEGORY_DEFS) {
    if (def.id === 'other') continue
    const resolved = def.resolve(env)
    const all = resolved.roots ?? []
    const roots = all.filter((root) => isDirectory(root.path) || isRootFile(root.path))
    // Every category's roots are collected even when unselected: the catch-all is
    // defined as "everything these categories do not already cover". Only the data
    // area can shade the catch-all, which itself only walks the data folder.
    for (const root of roots) {
      if (def.area === 'data' && !root.isCatchAll) covered.add(pathKey(root.path))
    }
    if (!isSelected(def.id)) continue
    if (resolved.warning !== undefined) warnings.push(resolved.warning)
    // Plain words, and named by label rather than by internal id: a reader should
    // never be shown `plugin-cache`, and a folder that was never created is not a
    // problem to act on.
    if (roots.length < all.length) {
      warnings.push(`${def.label}：有 ${all.length - roots.length} 个文件夹还没建，不影响统计`)
    }
    categories.push({ ...def, enumerate: def.enumerate ?? itemsByFirstLevel, roots })
  }

  if (isSelected('other')) {
    const otherDef = CATEGORY_DEFS.find((def) => def.id === 'other')
    const otherRoots = (otherDef.resolve(env).roots ?? []).filter((root) => isDirectory(root.path))
    categories.push({ ...otherDef, enumerate: otherDef.enumerate ?? itemsByFirstLevel, roots: otherRoots })
  }

  return { categories, warnings, covered }
}

/** True when the path exists and is a regular file. */
function isRootFile (candidate) {
  try {
    return fs.statSync(candidate).isFile()
  } catch {
    return false
  }
}

/**
 * True when `candidate` is `<profiles>/<one existing profile>/<…leaf>`.
 *
 * The leaf is what a category owns; the profile directory above it survives a move, so
 * requiring it to exist keeps a hand-edited manifest from inventing a new profile folder
 * to move something into.
 *
 * @param {{ dshHome: string }} env - the scan environment.
 * @param {string} candidate - the resolved path to test.
 * @param {string[]} leaf - the segments below the profile directory.
 * @returns {boolean} whether the category owns it.
 */
function ownsProfileLeaf (env, candidate, leaf) {
  const profilesRoot = path.join(env.dshHome, 'profiles')
  const relative = path.relative(profilesRoot, candidate)
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return false
  const parts = relative.split(path.sep)
  if (parts.length !== leaf.length + 1) return false
  if (!isDirectory(path.join(profilesRoot, parts[0]))) return false
  return leaf.every((segment, index) => segment === parts[index + 1])
}

/**
 * True when `candidate` is a folder a green cleanup is allowed to own.
 *
 * This is deliberately **independent of whether the path exists right now**, which is the
 * whole point: an undo has to recognise the folder it moved away, and a whole-folder item
 * (`.dsh-market`, a `dsh-spill-*` directory) is exactly the case where the root is gone
 * because it *is* the item. A rule phrased as "inside a root that exists" would refuse to
 * put the user's own files back.
 *
 * It covers the 🟢 categories only; 🟠 and ⚪ can never be owned by a cleanup.
 *
 * @param {{ dshHome: string, tempDir: string }} env - the scan environment.
 * @param {string} candidate - the path to test.
 * @returns {boolean} whether a cleanup may move it.
 */
export function ownsCleanupPath (env, candidate) {
  if (typeof candidate !== 'string' || candidate === '') return false
  const resolved = path.resolve(candidate)
  for (const def of CATEGORY_DEFS) {
    if (def.safety !== 'safe') continue
    if (def.owns !== undefined) {
      if (def.owns(env, resolved)) return true
      continue
    }
    for (const root of def.resolve(env).roots ?? []) {
      if (isUnder(resolved, root.path)) return true
    }
  }
  return false
}

/**
 * True when `candidate` is `base` itself or lies strictly inside it.
 * @param {string} candidate - absolute path.
 * @param {string} base - absolute path.
 * @returns {boolean} whether `candidate` is inside `base`.
 */
export function isUnder (candidate, base) {
  const rel = path.relative(path.resolve(base), path.resolve(candidate))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}
