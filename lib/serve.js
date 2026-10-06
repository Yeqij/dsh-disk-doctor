/**
 * The browser panel's data source.
 *
 * The panel lives in the browser and the scan runs in the host, so the host serves
 * the report as JSON on a local route and the panel reads it. The route is
 * **read-only**: it never writes a report file and never touches anything but the
 * same scan the tool performs, so opening the panel has no side effects.
 *
 * The route is optional. It registers only when a web server is composed, so a
 * headless deployment keeps working with the tool alone.
 *
 * Every handler asks the Host's Connection service for a verdict before doing
 * anything (`requestRejection`). A route registered straight on `webServer` does
 * not inherit the Host/Origin fence and browser authentication that the `/api`
 * bridge applies to itself, and two of these routes act: one moves files and one
 * opens a folder in the OS file manager.
 *
 * @module dsh-disk-doctor/serve
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

import { listQuarantine, performCleanup, planCleanup, undoCleanup } from './cleanup.js'
import { toJsonReport } from './report.js'
import { scan } from './scan.js'
import { isUnder, resolveTargets } from './targets.js'

/** The local route the panel reads. */
export const REPORT_ROUTE = '/dsh-disk-doctor/report'

/** The local route that reveals a folder in the OS file manager. */
export const OPEN_ROUTE = '/dsh-disk-doctor/open'

/** The local route that returns the cleanup preview. Read-only, like the rest. */
export const CLEANUP_ROUTE = '/dsh-disk-doctor/cleanup'

/** Largest `top` a caller may ask for, so one request cannot demand an unbounded report. */
const MAX_TOP = 100

/** @param {string} target - a path. @returns {boolean} whether it is a directory. */
function defaultIsDirectory (target) {
  try {
    return fs.statSync(target).isDirectory()
  } catch {
    return false
  }
}

/**
 * The scan environment implied by a normalized settings object.
 * @param {object} settings - normalized plugin settings.
 * @returns {object} the environment `resolveTargets`/`scan` expects.
 */
function scanEnv (settings) {
  return {
    dshHome: settings.dshHome,
    tempDir: os.tmpdir(),
    appRoot: settings.paths?.appRoot ?? null,
    appRootSource: settings.paths?.appRootSource ?? null,
    npmGlobalDsh: settings.paths?.npmGlobalDsh ?? null,
    chromiumDir: settings.paths?.chromiumDir ?? null,
    pnpmStore: settings.paths?.pnpmStore ?? null
  }
}

/**
 * Every path the panel is allowed to reveal, each tagged with its safety level.
 *
 * The list is derived from the same target table the report uses, so a row can only
 * be opened when the scan genuinely covers it — and the level decides whether the
 * user has to opt in first.
 *
 * @param {object} settings - normalized plugin settings.
 * @returns {Array<{ path: string, safety: string, categoryId: string, area: string }>} the roots.
 */
export function openRoots (settings) {
  const { categories } = resolveTargets(scanEnv(settings))
  const roots = []
  for (const category of categories) {
    for (const root of category.roots) {
      roots.push({ path: root.path, safety: category.safety, categoryId: category.id, area: category.area })
    }
  }
  return roots
}

/**
 * Decide whether a requested path may be revealed.
 *
 * This powers an endpoint that launches the OS file manager, so the path is the
 * whole attack surface: without the checks below, anything able to reach the route
 * could pop open any directory on the machine. Two rules apply, and both must hold:
 *
 * 1. **Containment** — the path must resolve inside a root the scan actually covers.
 *    Comparing resolved paths refuses `..` traversal and absolute detours alike.
 * 2. **Consent** — 🟢 rows open once the feature is on; 🟠 and ⚪ rows additionally
 *    require the second switch, because opening the folder next to your conversations
 *    or your application files is a bigger favour to ask than opening a temp folder.
 *
 * A file reveals its containing folder rather than being handed to whatever opens it.
 *
 * Exported so the rules are tested on their own, with no web server involved.
 *
 * @param {*} requested - the path the panel asked for.
 * @param {object} settings - normalized plugin settings.
 * @param {{ isDirectory?: (target: string) => boolean, roots?: object[] }} [deps]
 *   - injectable probes; `roots` defaults to the data folder alone.
 * @returns {{ok: true, target: string, safety: string} | {ok: false, reason: string}} the verdict.
 */
export function resolveOpenTarget (requested, settings, deps = {}) {
  if (settings.allowOpenFolder !== true) return { ok: false, reason: 'disabled' }
  if (typeof requested !== 'string' || requested.trim() === '') return { ok: false, reason: 'no-path' }

  let target
  try {
    target = path.resolve(requested)
  } catch {
    return { ok: false, reason: 'bad-path' }
  }
  if (!fs.existsSync(target)) return { ok: false, reason: 'missing' }

  const roots = deps.roots ?? [{ path: settings.dshHome, safety: 'care', categoryId: 'other', area: 'data' }]
  // The most specific covering root wins, so a row inside `sessions/` is judged by
  // the sessions category rather than by the data folder that also contains it.
  const covering = roots
    .filter((root) => typeof root?.path === 'string' && isUnder(target, root.path))
    .sort((a, b) => b.path.length - a.path.length)[0]
  if (covering === undefined) return { ok: false, reason: 'outside-root' }
  if (covering.safety !== 'safe' && settings.allowOpenFolderSensitive !== true) {
    return { ok: false, reason: 'sensitive' }
  }

  const isDirectory = deps.isDirectory ?? defaultIsDirectory
  return {
    ok: true,
    target: isDirectory(target) ? target : path.dirname(target),
    safety: covering.safety
  }
}

/**
 * Hand a directory to the platform's file manager.
 * @param {string} directory - an absolute directory path.
 * @returns {void}
 */
function reveal (directory) {
  const command = process.platform === 'win32'
    ? 'explorer.exe'
    : process.platform === 'darwin' ? 'open' : 'xdg-open'
  const child = spawn(command, [directory], { detached: true, stdio: 'ignore' })
  child.unref()
}

/**
 * Read the requested per-category item count from a request URL.
 * @param {string} requestUrl - the raw request URL, path and query.
 * @param {number} fallback - the configured default.
 * @returns {number} a count within `1..100`.
 */
export function topFromUrl (requestUrl, fallback) {
  let requested
  try {
    requested = Number(new URL(requestUrl ?? '/', 'http://localhost').searchParams.get('top'))
  } catch {
    return fallback
  }
  if (!Number.isInteger(requested) || requested < 1) return fallback
  return Math.min(requested, MAX_TOP)
}

/**
 * Ask the Host's browser-trust fence whether this request may be served at all.
 *
 * A raw route registered on `webServer` sits **outside** the fence that the `/api`
 * bridge applies to itself, so every official route plugin asks the Connection
 * service for a verdict before doing anything (open-in-app is the reference
 * implementation). This does the same, and it matters most for the two routes that
 * act: the fence refuses DNS-rebinding hosts, a mismatched `Origin`, and
 * `sec-fetch-site: cross-site`, so a page the user merely visited cannot POST a
 * move or pop a file-manager window on their machine.
 *
 * A composition that carries a web server but no Connection service (no browser
 * surface) has nothing to ask, so the check is skipped rather than turned into a
 * 500; a fence that answers nothing is still a refusal.
 *
 * @param {object} ctx - the injected context the route was registered from.
 * @param {object} request - the incoming request.
 * @returns {number|undefined} the status to refuse with, or undefined to serve.
 */
function requestRejection (ctx, request) {
  let connection
  try {
    connection = typeof ctx?.get === 'function' ? ctx.get('connection') : undefined
  } catch {
    connection = undefined
  }
  if (connection === undefined || connection === null) return undefined
  if (typeof connection.requestRejection !== 'function') return undefined
  try {
    return connection.requestRejection(request)
  } catch {
    return 403
  }
}

/**
 * Register the panel's report route on the host's web server.
 *
 * @param {object} ctx - the plugin context.
 * @param {object} settings - normalized plugin settings, as of load time.
 * @param {() => object} [current] - re-reads the live settings, so a settings change
 *   reaches the panel's capability flags without a restart.
 * @returns {void}
 */
export function registerReportRoute (ctx, settings, current) {
  const live = () => current === undefined ? settings : current()
  // Optional seat: without a composed web server this is simply skipped.
  ctx.inject(['webServer'], (host) => {
    host.effect(() => host.webServer.register({
      kind: 'exact',
      path: REPORT_ROUTE,
      handler: async (request, response) => {
        const rejection = requestRejection(host, request)
        if (rejection !== undefined) {
          response.writeHead(rejection)
          response.end()
          return
        }
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          response.writeHead(405, { allow: 'GET, HEAD' })
          response.end()
          return
        }
        try {
          const settings = live()
          const report = await scan({
            ...scanEnv(settings),
            topN: topFromUrl(request.url, settings.topN),
            excludeGlobs: settings.excludeGlobs,
            followSymlinks: settings.followSymlinks
          })
          const body = JSON.stringify(toJsonReport(report, {
            dshHome: settings.dshHome,
            generatedAt: new Date(),
            redact: false,
            // The panel needs to know whether the buttons it draws can do anything.
            capabilities: {
              openFolder: settings.allowOpenFolder === true,
              openFolderSensitive: settings.allowOpenFolderSensitive === true,
              cleanup: settings.allowCleanup === true
            }
          }))
          response.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store'
          })
          response.end(request.method === 'HEAD' ? undefined : body)
        } catch (error) {
          response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
          response.end(JSON.stringify({ error: String(error?.message ?? error) }))
        }
      }
    }), 'dsh-disk-doctor: report route')
  })
}

/**
 * Register the cleanup route: a preview anyone can read, and two actions behind a switch.
 *
 * - `GET` returns the plan — what a cleanup would move — plus the batches already sitting
 *   in quarantine, so the panel can offer an undo. Read-only.
 * - `POST ?action=move` performs the move. `POST ?action=undo&id=<batch>` puts one batch
 *   back. Both are refused with 403 unless `allowCleanup` is on, and both re-read the live
 *   settings, so the switch does not need a restart to take effect.
 *
 * There is deliberately no delete action: emptying the quarantine stays the user's job,
 * done outside this plugin, which is why no code path here can destroy data.
 *
 * @param {object} ctx - the plugin context.
 * @param {object} settings - normalized plugin settings, as of load time.
 * @param {() => object} [current] - re-reads the live settings.
 * @returns {void}
 */
export function registerCleanupRoute (ctx, settings, current) {
  const live = () => current === undefined ? settings : current()
  /** The scan environment a cleanup acts in, plus the live exclusions. */
  const cleanupOptions = (settings) => ({
    ...scanEnv(settings),
    excludeGlobs: settings.excludeGlobs,
    followSymlinks: settings.followSymlinks,
    now: new Date()
  })
  ctx.inject(['webServer'], (host) => {
    host.effect(() => host.webServer.register({
      kind: 'exact',
      path: CLEANUP_ROUTE,
      handler: async (request, response) => {
        const json = (status, payload) => {
          response.writeHead(status, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store'
          })
          response.end(request.method === 'HEAD' ? undefined : JSON.stringify(payload))
        }
        if (request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'POST') {
          response.writeHead(405, { allow: 'GET, HEAD, POST' })
          response.end()
          return
        }
        // Before anything is read or planned: is this request the operator's at all?
        const rejection = requestRejection(host, request)
        if (rejection !== undefined) {
          json(rejection, { error: rejection === 403 ? 'forbidden' : 'unauthenticated' })
          return
        }
        const settings = live()
        try {
          if (request.method === 'GET' || request.method === 'HEAD') {
            const plan = await planCleanup(cleanupOptions(settings))
            // The batches ride along with the plan: the panel needs both to draw one
            // "what would move" list and one "put it back" button.
            json(200, { ...plan, batches: listQuarantine(settings.dshHome) })
            return
          }

          if (settings.allowCleanup !== true) {
            json(403, { error: 'disabled' })
            return
          }
          let action = null
          let id = null
          try {
            const url = new URL(request.url ?? '/', 'http://localhost')
            action = url.searchParams.get('action')
            id = url.searchParams.get('id')
          } catch { /* an unparseable URL is refused below */ }

          if (action === 'move') {
            json(200, await performCleanup(cleanupOptions(settings)))
            return
          }
          if (action === 'undo') {
            const result = undoCleanup({ ...scanEnv(settings), id })
            json(result.ok ? 200 : 400, result)
            return
          }
          json(400, { error: 'unknown-action' })
        } catch (error) {
          json(500, { error: String(error?.message ?? error) })
        }
      }
    }), 'dsh-disk-doctor: cleanup route')
  })
}

/**
 * Register the route that reveals one folder in the file manager.
 *
 * POST only: opening a window is not a safe, cacheable read, so it must not be
 * reachable by a stray navigation or a prefetch. The decision itself lives in
 * `resolveOpenTarget`, which is where the containment rule is enforced and tested.
 *
 * @param {object} ctx - the plugin context.
 * @param {object} settings - normalized plugin settings, as of load time.
 * @param {() => object} [current] - re-reads the live settings, so flipping a switch
 *   takes effect on the next click instead of the next restart.
 * @param {{ reveal?: (directory: string) => void }} [deps] - injectable side effect,
 *   so a test can exercise the whole route without opening a window on someone's desk.
 * @returns {void}
 */
export function registerOpenRoute (ctx, settings, current, deps = {}) {
  const live = () => current === undefined ? settings : current()
  const open = deps.reveal ?? reveal
  ctx.inject(['webServer'], (host) => {
    host.effect(() => host.webServer.register({
      kind: 'exact',
      path: OPEN_ROUTE,
      handler: async (request, response) => {
        const rejection = requestRejection(host, request)
        if (rejection !== undefined) {
          response.writeHead(rejection, { 'content-type': 'application/json; charset=utf-8' })
          response.end(JSON.stringify({ error: rejection === 403 ? 'forbidden' : 'unauthenticated' }))
          return
        }
        if (request.method !== 'POST') {
          response.writeHead(405, { allow: 'POST' })
          response.end()
          return
        }
        let requested
        try {
          requested = new URL(request.url ?? '/', 'http://localhost').searchParams.get('path')
        } catch {
          requested = null
        }
        const settings = live()
        const verdict = resolveOpenTarget(requested, settings, { roots: openRoots(settings) })
        const status = verdict.ok ? 200 : verdict.reason === 'disabled' ? 403 : 400
        response.writeHead(status, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store'
        })
        if (!verdict.ok) {
          response.end(JSON.stringify({ error: verdict.reason }))
          return
        }
        try {
          open(verdict.target)
          response.end(JSON.stringify({ opened: true, safety: verdict.safety }))
        } catch (error) {
          response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
          response.end(JSON.stringify({ error: String(error?.message ?? error) }))
        }
      }
    }), 'dsh-disk-doctor: open route')
  })
}
