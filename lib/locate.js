/**
 * Where DSH keeps things on *this* machine.
 *
 * The scanner can only be honest about a machine if it knows which directories that
 * machine actually uses. Three of them are not derivable from the others:
 *
 * 1. **The data folder** — `$DSH_HOME`, falling back to `~/.dsh`. DSH itself reads
 *    that environment variable, so the plugin must read it too; otherwise a user
 *    who moved their data folder sees a report about a directory DSH never opens.
 * 2. **The application install folder** — the packed Electron app, which lives
 *    outside the data folder entirely (`E:\dsh1` here, something else elsewhere).
 *    It is found from the running executable and *validated*: a directory only
 *    counts when it actually holds the packed application.
 * 3. **System caches DSH feeds** — the Chromium user-data folder and the pnpm
 *    content store. Both are named by the platform, not by DSH.
 *
 * Every function here is pure with respect to its inputs: the environment, the
 * executable path and the filesystem probes are all injectable, so the rules are
 * tested without depending on the machine they run on.
 *
 * @module dsh-disk-doctor/locate
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Directory name DSH uses under the OS home when `$DSH_HOME` is unset. */
export const DSH_HOME_DIR_NAME = '.dsh'

/** Environment variable DSH honours as an override for its data folder. */
export const DSH_HOME_ENV = 'DSH_HOME'

/** The vendor folder Electron puts the app's user data under. */
const VENDOR_SEGMENTS = ['@deepseek-ai', 'dsh-desktop']

/** The npm scope DSH's own packages are published under. */
const VENDOR_SCOPE = ['@deepseek-ai']

/** True when `candidate` is an existing directory. */
function defaultIsDirectory (candidate) {
  try {
    return fs.statSync(candidate).isDirectory()
  } catch {
    return false
  }
}

/** True when `candidate` is an existing regular file. */
function defaultIsFile (candidate) {
  try {
    return fs.statSync(candidate).isFile()
  } catch {
    return false
  }
}

/**
 * Expand the tilde forms DSH documents: `~`, `~/…` and `~\…`. A `~name` prefix is
 * deliberately left alone, because only the shell can resolve another user's home.
 *
 * @param {string} candidate - a configured path.
 * @param {string} [home] - the home directory to expand against.
 * @returns {string} the expanded path.
 */
export function expandHome (candidate, home = os.homedir()) {
  if (candidate === '~') return home
  if (candidate.startsWith('~/') || candidate.startsWith('~\\')) {
    return path.join(home, candidate.slice(2))
  }
  return candidate
}

/**
 * The data folder DSH uses on this machine.
 *
 * @param {NodeJS.ProcessEnv} [env] - the process environment.
 * @param {string} [home] - the OS home directory.
 * @returns {string} the absolute data folder. Not canonicalized: the caller decides.
 */
export function resolveDshHome (env = process.env, home = os.homedir()) {
  const configured = typeof env?.[DSH_HOME_ENV] === 'string' ? env[DSH_HOME_ENV].trim() : ''
  if (configured === '') return path.join(home, DSH_HOME_DIR_NAME)
  return expandHome(configured, home)
}

/**
 * The directory names that prove `root` is an unpacked Electron application rather
 * than an ordinary folder that happens to sit next to a `resources` directory.
 *
 * @param {string} root - a candidate application root.
 * @returns {string[]} marker paths, any one of which is sufficient.
 */
function appMarkers (root) {
  const resources = path.join(root, 'resources')
  const contents = path.join(root, 'Contents', 'Resources')
  return [
    path.join(resources, 'app.asar'),
    path.join(resources, 'app.asar.unpacked'),
    path.join(resources, 'app-update.yml'),
    path.join(contents, 'app.asar'),
    path.join(contents, 'app.asar.unpacked')
  ]
}

/**
 * True when `root` holds a packed Electron application.
 *
 * This is the whole safety net of install-folder detection: the executable path is
 * a heuristic (a headless deployment runs a plain `node`, whose directory has no
 * `app.asar`), so a candidate is only accepted when the application is really there.
 *
 * @param {string} root - a candidate application root.
 * @param {{ isFile?: (p: string) => boolean }} [deps] - injectable probes.
 * @returns {boolean} whether the packed application is present.
 */
export function looksLikeAppRoot (root, deps = {}) {
  if (typeof root !== 'string' || root.trim() === '') return false
  const isFile = deps.isFile ?? defaultIsFile
  return appMarkers(root).some((marker) => isFile(marker))
}

/**
 * The plausible application roots implied by one directory.
 *
 * A directory can name the resources folder (Electron's `resourcesPath`), the
 * macOS `Contents` folder, or the folder an executable sits in. All three
 * spellings of the same installation collapse onto the bundle root here.
 *
 * @param {string} candidate - a directory inside or beside an installation.
 * @returns {string[]} candidate application roots, most specific first.
 */
function rootsAround (candidate) {
  const isBundle = (value) => path.basename(value).toLowerCase().endsWith('.app')
  const roots = []
  const own = path.basename(candidate).toLowerCase()
  if (own === 'contents' && isBundle(path.dirname(candidate))) roots.push(path.dirname(candidate))
  roots.push(candidate)
  const parent = path.dirname(candidate)
  if (isBundle(parent)) roots.push(parent)
  if (isBundle(path.dirname(parent))) roots.push(path.dirname(parent))
  return [...new Set(roots)]
}

/**
 * Find the folder the DSH application is installed in.
 *
 * Tried in order: the runtime's own `resourcesPath`, the desktop launcher's
 * exported executable path, and finally `process.execPath` — which, because the
 * host runs as Electron-in-Node mode, is the application executable rather than a
 * `node` binary. Each candidate must pass {@link looksLikeAppRoot}.
 *
 * @param {object} [options] - overrides, all optional.
 * @param {NodeJS.ProcessEnv} [options.env] - the process environment.
 * @param {string} [options.execPath] - the running executable.
 * @param {string} [options.resourcesPath] - Electron's resources folder, when present.
 * @param {(p: string) => boolean} [options.isFile] - injectable probe.
 * @returns {{ path: string, source: string }|null} the install folder and how it was found.
 */
export function detectAppRoot (options = {}) {
  const env = options.env ?? process.env
  const execPath = options.execPath ?? process.execPath
  const resourcesPath = options.resourcesPath ?? process.resourcesPath
  // A resources folder *contains* the application and an executable *sits beside*
  // it, so both contribute the folder that holds them as the candidate root.
  const sources = []
  if (typeof resourcesPath === 'string' && resourcesPath !== '') {
    sources.push(['resourcesPath', path.dirname(resourcesPath)])
  }
  if (typeof env?.DSH_DESKTOP_NODE_EXECUTABLE === 'string' && env.DSH_DESKTOP_NODE_EXECUTABLE !== '') {
    sources.push(['DSH_DESKTOP_NODE_EXECUTABLE', path.dirname(env.DSH_DESKTOP_NODE_EXECUTABLE)])
  }
  if (typeof execPath === 'string' && execPath !== '') sources.push(['execPath', path.dirname(execPath)])

  for (const [source, value] of sources) {
    for (const root of rootsAround(value)) {
      if (looksLikeAppRoot(root, options)) return { path: root, source }
    }
  }
  return null
}

/**
 * The Chromium profile DSH's desktop window keeps (cookies, local storage, cache).
 *
 * @param {object} [options] - overrides, all optional.
 * @param {NodeJS.ProcessEnv} [options.env] - the process environment.
 * @param {string} [options.home] - the OS home directory.
 * @param {(p: string) => boolean} [options.isDirectory] - injectable probe.
 * @returns {string|null} the existing folder, or null when this machine has none.
 */
export function detectChromiumDataDir (options = {}) {
  const env = options.env ?? process.env
  const home = options.home ?? os.homedir()
  const isDirectory = options.isDirectory ?? defaultIsDirectory
  const candidates = []
  if (typeof env?.APPDATA === 'string' && env.APPDATA !== '') {
    candidates.push(path.join(env.APPDATA, ...VENDOR_SEGMENTS))
  }
  candidates.push(path.join(home, '.config', ...VENDOR_SEGMENTS))
  candidates.push(path.join(home, 'Library', 'Application Support', ...VENDOR_SEGMENTS))
  for (const candidate of candidates) if (isDirectory(candidate)) return candidate
  return null
}

/**
 * The pnpm content store: where package files physically live before pnpm hard-links
 * them into a `node_modules` tree.
 *
 * @param {object} [options] - overrides, all optional.
 * @param {NodeJS.ProcessEnv} [options.env] - the process environment.
 * @param {string} [options.home] - the OS home directory.
 * @param {(p: string) => boolean} [options.isDirectory] - injectable probe.
 * @returns {string|null} the existing folder, or null when pnpm is not used here.
 */
export function detectPnpmStore (options = {}) {
  const env = options.env ?? process.env
  const home = options.home ?? os.homedir()
  const isDirectory = options.isDirectory ?? defaultIsDirectory
  const candidates = []
  if (typeof env?.PNPM_HOME === 'string' && env.PNPM_HOME !== '') candidates.push(env.PNPM_HOME)
  if (typeof env?.LOCALAPPDATA === 'string' && env.LOCALAPPDATA !== '') {
    candidates.push(path.join(env.LOCALAPPDATA, 'pnpm'))
  }
  candidates.push(path.join(home, '.local', 'share', 'pnpm'))
  candidates.push(path.join(home, 'Library', 'pnpm'))
  for (const candidate of candidates) if (isDirectory(candidate)) return candidate
  return null
}

/**
 * A second, separate DSH installation: the one npm puts under its global root.
 *
 * The desktop application and the global `dsh` CLI are two installations on one
 * machine (they cannot even read each other's profile), and a profile's shared
 * `node_modules` is a farm of junctions into this one. Leaving it out is how a
 * quarter of a gigabyte stays invisible next to a report that looks complete.
 *
 * @param {object} [options] - overrides, all optional.
 * @param {NodeJS.ProcessEnv} [options.env] - the process environment.
 * @param {string} [options.home] - the OS home directory.
 * @param {(p: string) => boolean} [options.isDirectory] - injectable probe.
 * @param {(p: string) => boolean} [options.isFile] - injectable probe.
 * @returns {string|null} the existing package folder, or null when npm has none.
 */
export function detectNpmGlobalDsh (options = {}) {
  const env = options.env ?? process.env
  const home = options.home ?? os.homedir()
  const isDirectory = options.isDirectory ?? defaultIsDirectory
  const isFile = options.isFile ?? defaultIsFile
  const roots = []
  if (typeof env?.APPDATA === 'string' && env.APPDATA !== '') roots.push(path.join(env.APPDATA, 'npm', 'node_modules'))
  if (typeof env?.npm_config_prefix === 'string' && env.npm_config_prefix !== '') {
    roots.push(path.join(env.npm_config_prefix, 'lib', 'node_modules'))
    roots.push(path.join(env.npm_config_prefix, 'node_modules'))
  }
  roots.push(path.join(home, '.npm-global', 'lib', 'node_modules'))
  roots.push('/usr/local/lib/node_modules')
  roots.push('/usr/lib/node_modules')
  for (const root of roots) {
    const candidate = path.join(root, ...VENDOR_SCOPE, 'dsh')
    if (isDirectory(candidate) && isFile(path.join(candidate, 'package.json'))) return candidate
  }
  return null
}
