/**
 * Entry-module tests: the exported plugin contract, the config surface, and the
 * `disk_report` tool driven end to end through a fake tool registry.
 *
 * `@deepseek-ai/dsh-tools` and `@deepseek-ai/schemastery` are replaced by stubs
 * (see `test/stubs/`), so this runs without a DSH host. The real schema compiler
 * and argument validator are exercised by installing the plugin into a profile.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'

import { apply, CATEGORY_IDS, Config, defaultDshHome, inject, name, normalizeConfig, plainValue, TOOL_NAME } from '../lib/index.js'
import { redactHome } from '../lib/report.js'
import { CLEANUP_ROUTE, OPEN_ROUTE, openRoots, registerOpenRoute, REPORT_ROUTE, resolveOpenTarget, topFromUrl } from '../lib/serve.js'
import { pathKey } from '../lib/targets.js'

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-disk-doctor-plugin-'))
const dshHome = path.join(fixtureRoot, '.dsh')
const reportDir = path.join(fixtureRoot, 'reports')
const tempDir = path.join(fixtureRoot, 'temp')
// The tool scans `os.tmpdir()` because the config has no temp field, so point the
// process at the fixture and restore the real value afterwards.
const originalTemp = { TEMP: process.env.TEMP, TMP: process.env.TMP }
// Location detection reads the platform's own variables. Pointing them at the empty
// fixture keeps this suite hermetic: without this it would scan whatever caches the
// machine running the tests happens to have. `npm_config_prefix` matters as much as
// the other two and is the easy one to miss: `npm test` injects it, and it names the
// npm global root, so a developer machine's real `@deepseek-ai/dsh` install leaks
// into the application area unless it is cleared too.
const originalPaths = {
  APPDATA: process.env.APPDATA,
  LOCALAPPDATA: process.env.LOCALAPPDATA,
  PNPM_HOME: process.env.PNPM_HOME,
  npm_config_prefix: process.env.npm_config_prefix
}

/** Collect the tools a fake context receives from `apply`. */
function fakeContext () {
  const registered = []
  return {
    registered,
    ctx: {
      tools: { register: (tool) => registered.push(tool) },
      // Optional seats (the web server) are absent here; the route has its own suite.
      inject: () => {}
    }
  }
}

before(() => {
  fs.mkdirSync(path.join(dshHome, 'sessions', '--E-demo--', 'session-abc'), { recursive: true })
  fs.writeFileSync(path.join(dshHome, 'sessions', '--E-demo--', 'session-abc', 'session.jsonl.zstd'), Buffer.alloc(4096, 0x41))
  fs.mkdirSync(path.join(dshHome, 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'node'), { recursive: true })
  fs.writeFileSync(path.join(dshHome, 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'node', 'node.exe'), Buffer.alloc(8192, 0x42))
  fs.mkdirSync(path.join(tempDir, 'dsh-spill-xyz'), { recursive: true })
  fs.writeFileSync(path.join(tempDir, 'dsh-spill-xyz', 'blob.bin'), Buffer.alloc(1024, 0x43))
  process.env.TEMP = tempDir
  process.env.TMP = tempDir
  process.env.APPDATA = path.join(fixtureRoot, 'appdata')
  process.env.LOCALAPPDATA = path.join(fixtureRoot, 'localappdata')
  delete process.env.PNPM_HOME
  delete process.env.npm_config_prefix
})

after(() => {
  if (originalTemp.TEMP === undefined) delete process.env.TEMP
  else process.env.TEMP = originalTemp.TEMP
  if (originalTemp.TMP === undefined) delete process.env.TMP
  else process.env.TMP = originalTemp.TMP
  for (const [key, value] of Object.entries(originalPaths)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    fs.rmSync(fixtureRoot, { recursive: true, force: true })
  } catch { /* best effort */ }
})

describe('plugin contract', () => {
  it('exports the cordis plugin shape', () => {
    assert.equal(name, 'disk-doctor')
    assert.deepEqual(inject, ['tools'])
    assert.equal(typeof apply, 'function')
    assert.equal(typeof Config, 'object')
  })

  it('declares exactly the documented configuration fields', () => {
    assert.deepEqual(Object.keys(Config.spec.dict).sort(),
      ['allowCleanup', 'allowOpenFolder', 'allowOpenFolderSensitive', 'appDir', 'dshHome', 'excludeGlobs', 'followSymlinks', 'reportDir', 'topN'])
    const dict = Config.spec.dict
    // The split the user asked for: opening the folder of something safe to clean is
    // allowed out of the box, while the locations that hold conversations or program
    // files need a second, explicit consent.
    assert.equal(dict.allowOpenFolder.spec.default, true)
    assert.equal(dict.allowOpenFolderSensitive.spec.default, false)
    // Moving files is the one thing that has to be asked for, every time it is installed.
    assert.equal(dict.allowCleanup.spec.default, false)
    assert.equal(dict.appDir.spec.default, '', 'the install folder is detected unless overridden')
    assert.equal(dict.dshHome.spec.default, defaultDshHome())
    assert.equal(dict.topN.spec.default, 10)
    assert.equal(dict.topN.spec.min, 1)
    assert.equal(dict.topN.spec.max, 100)
    assert.equal(dict.followSymlinks.spec.default, false)
    assert.deepEqual(dict.excludeGlobs.spec.default, [])
    assert.ok(Object.values(dict).every((field) => typeof field.spec.description === 'string'))
    // DSH projects a settings form only for fields marked volatile; an ordinary
    // field would be invisible in the UI and editable only through YAML.
    assert.ok(Object.values(dict).every((field) => field.spec.volatile === true),
      'every field must be volatile to appear on the settings page')
  })

  it('reads both plain and boxed volatile config values', () => {
    assert.equal(plainValue('C:/plain'), 'C:/plain')
    assert.equal(plainValue(undefined), undefined)
    const box = Object.freeze({ get: () => 'C:/boxed' })
    assert.equal(plainValue(box), 'C:/boxed')

    const settings = normalizeConfig({
      dshHome: Object.freeze({ get: () => dshHome }),
      topN: Object.freeze({ get: () => 5 }),
      followSymlinks: Object.freeze({ get: () => true }),
      excludeGlobs: Object.freeze({ get: () => ['C:/skip'] })
    })
    assert.equal(settings.dshHome, normalizeConfig({ dshHome }).dshHome)
    assert.equal(settings.topN, 5)
    assert.equal(settings.followSymlinks, true)
    assert.deepEqual(settings.excludeGlobs, ['C:/skip'])
  })

  it('normalizes config, including ~ expansion and a default report directory', () => {
    const defaults = normalizeConfig(undefined)
    assert.equal(defaults.dshHome, defaultDshHome())
    assert.equal(defaults.reportDir, path.join(defaultDshHome(), 'disk-doctor', 'reports'))
    assert.deepEqual(defaults.excludeGlobs, [])
    assert.equal(defaults.followSymlinks, false)

    const custom = normalizeConfig({ dshHome, reportDir: '~/reports', topN: 999, excludeGlobs: ['', '  ', 'C:/x'] })
    assert.equal(custom.dshHome, path.resolve(dshHome))
    assert.equal(custom.reportDir, path.join(os.homedir(), 'reports'))
    assert.equal(custom.topN, 10, 'an out-of-range topN falls back to the default')
    assert.deepEqual(custom.excludeGlobs, ['C:/x'])
  })

  it('flags a report directory that leaves the scan root', () => {
    const byDefault = normalizeConfig({ dshHome })
    assert.equal(byDefault.reportDirExplicit, false)
    assert.equal(byDefault.reportDirOutsideHome, false)

    const inside = normalizeConfig({ dshHome, reportDir: path.join(dshHome, 'reports') })
    assert.equal(inside.reportDirExplicit, true)
    assert.equal(inside.reportDirOutsideHome, false)

    assert.equal(normalizeConfig({ dshHome, reportDir }).reportDirOutsideHome, true)
  })

  it('applies the documented boolean defaults even without the host schema', () => {
    // A bare config object (no schema pass) must behave like the documented defaults,
    // not like "false for everything": `undefined === true` would silently disable a
    // permission the settings page says is on.
    const bare = normalizeConfig({ dshHome })
    assert.equal(bare.allowOpenFolder, true, 'opening a safe location is allowed by default')
    assert.equal(bare.allowOpenFolderSensitive, false)
    assert.equal(bare.followSymlinks, false)

    const explicit = normalizeConfig({
      dshHome,
      allowOpenFolder: false,
      allowOpenFolderSensitive: true,
      followSymlinks: true
    })
    assert.equal(explicit.allowOpenFolder, false, 'an explicit false is honoured')
    assert.equal(explicit.allowOpenFolderSensitive, true)
    assert.equal(explicit.followSymlinks, true)

    // And the boxed form the host actually passes reads the same way.
    const boxed = normalizeConfig({
      dshHome,
      allowOpenFolder: Object.freeze({ get: () => false }),
      allowOpenFolderSensitive: Object.freeze({ get: () => true })
    })
    assert.equal(boxed.allowOpenFolder, false)
    assert.equal(boxed.allowOpenFolderSensitive, true)
  })

  it('follows $DSH_HOME exactly the way the host does', () => {
    // The host resolves its data folder from this variable. A plugin that assumed
    // `~/.dsh` would report on a folder DSH never opens — and would look confident
    // while doing it, which is worse than being visibly wrong.
    const saved = process.env.DSH_HOME
    const moved = path.join(fixtureRoot, 'moved-home')
    process.env.DSH_HOME = moved
    try {
      assert.equal(defaultDshHome(), moved)
      assert.equal(normalizeConfig({}).dshHome, path.resolve(moved))
      // An explicit setting still wins over the environment.
      assert.equal(normalizeConfig({ dshHome }).dshHome, path.resolve(dshHome))
    } finally {
      if (saved === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = saved
    }
  })

  it('detects the folders outside the data directory, and lets an override win', () => {
    const installDir = path.join(fixtureRoot, 'install')
    const chromiumDir = path.join(fixtureRoot, 'appdata', '@deepseek-ai', 'dsh-desktop')
    const storeDir = path.join(fixtureRoot, 'localappdata', 'pnpm')
    const detected = normalizeConfig({}, {
      env: { APPDATA: path.join(fixtureRoot, 'appdata'), LOCALAPPDATA: path.join(fixtureRoot, 'localappdata') },
      home: fixtureRoot,
      execPath: path.join(installDir, 'DeepSeek Harness.exe'),
      resourcesPath: undefined,
      isDirectory: (target) => [chromiumDir, storeDir].some((known) => pathKey(known) === pathKey(target)),
      isFile: (target) => pathKey(target) === pathKey(path.join(installDir, 'resources', 'app.asar'))
    })
    assert.equal(pathKey(detected.paths.appRoot), pathKey(installDir))
    assert.equal(detected.paths.appRootSource, 'execPath')
    assert.equal(pathKey(detected.paths.chromiumDir), pathKey(chromiumDir))
    assert.equal(pathKey(detected.paths.pnpmStore), pathKey(storeDir))

    const overridden = normalizeConfig({ appDir: installDir }, { env: {}, home: fixtureRoot, execPath: undefined })
    assert.equal(pathKey(overridden.paths.appRoot), pathKey(installDir))
    assert.equal(overridden.paths.appRootSource, 'config', 'a hand-set folder is not sold as detection')
    assert.equal(overridden.paths.chromiumDir, null)
    assert.equal(overridden.paths.pnpmStore, null)
  })

  it('registers exactly one read-only tool', () => {
    const { ctx, registered } = fakeContext()
    apply(ctx, { dshHome, reportDir })
    assert.equal(registered.length, 1)
    const tool = registered[0]
    assert.equal(tool.name, TOOL_NAME)
    assert.ok(/read-only/i.test(tool.description))
    assert.deepEqual(Object.keys(tool.parameters).sort(), ['categories', 'scope', 'topN', 'write'])
    assert.deepEqual(tool.parameters.categories.items.enum, CATEGORY_IDS)
    assert.equal(tool.output.schema.type, 'object')
    assert.equal(typeof tool.output.schema.properties, 'object')
    assert.equal(tool.output.schema.properties.markdown.required, true)
  })
})

describe('disk_report execution', () => {
  it('returns a summary and writes both report files by default', async () => {
    const { ctx, registered } = fakeContext()
    apply(ctx, { dshHome, reportDir })
    const tool = registered[0]

    const args = { scope: 'summary', write: true }
    const value = await tool.execute(args, {})

    assert.equal(value.totals.bytes, 4096 + 8192 + 1024)
    assert.equal(value.truncated, false)

    // The result reaches session logs and the conversation, so the paths it prints
    // are redacted. The files themselves are written to the configured directory,
    // which is where the test goes looking for them.
    assert.ok(value.reportPath.endsWith('.md'))
    assert.ok(value.jsonPath.endsWith('.json'))
    assert.ok(!value.reportPath.includes(os.homedir()), 'no printed path carries the account name')
    assert.ok(!value.markdown.includes(os.homedir()), 'the rendered summary carries no account name')
    assert.ok(value.reportPath.startsWith('~'), 'paths are written relative to home')

    const written = fs.readdirSync(reportDir).sort()
    const mdName = written.find((name) => name.endsWith('.md'))
    const jsonName = written.find((name) => name.endsWith('.json'))
    assert.ok(mdName !== undefined && jsonName !== undefined, 'both artifacts exist on disk')
    assert.ok(fs.existsSync(path.join(reportDir, mdName)))
    assert.ok(fs.existsSync(path.join(reportDir, jsonName)))

    const document = JSON.parse(fs.readFileSync(path.join(reportDir, jsonName), 'utf8'))
    assert.equal(document.schema, 'dsh-disk-doctor/report@1')
    assert.equal(document.totals.bytes, value.totals.bytes)
    // The artifact is redacted too, so a shared report is safe to hand over.
    assert.ok(!JSON.stringify(document).includes(os.homedir()), 'the saved JSON carries no account name')
    const markdownFile = fs.readFileSync(path.join(reportDir, mdName), 'utf8')
    assert.ok(markdownFile.startsWith('# DSH 空间体检报告'))
    assert.ok(!markdownFile.includes(os.homedir()), 'the saved Markdown carries no account name')

    const rendered = tool.output.render(args, value)
    assert.deepEqual(rendered, [{ type: 'text', text: value.markdown }])
    assert.ok(value.markdown.includes('会话日志'))
    assert.ok(value.markdown.includes(value.reportPath))
  })

  it('writes nothing when write is false', async () => {
    const { ctx, registered } = fakeContext()
    const isolated = path.join(fixtureRoot, 'never-written')
    apply(ctx, { dshHome, reportDir: isolated })
    const value = await registered[0].execute({ write: false }, {})
    assert.equal(value.reportPath, undefined)
    assert.equal(value.jsonPath, undefined)
    assert.ok(!fs.existsSync(isolated))
    assert.ok(!value.markdown.includes('报告已写入'))
  })

  it('adds per-category detail only for scope=full', async () => {
    const { ctx, registered } = fakeContext()
    apply(ctx, { dshHome, reportDir })
    const tool = registered[0]
    const summary = await tool.execute({ scope: 'summary', write: false }, {})
    const full = await tool.execute({ scope: 'full', write: false }, {})
    const sessionsPath = full.categories.find((category) => category.id === 'sessions').topItems[0].path
    assert.ok(full.markdown.split('\n').length > summary.markdown.split('\n').length)
    assert.ok(full.markdown.includes(sessionsPath))
    assert.ok(!summary.markdown.includes(sessionsPath))
  })

  it('restricts the scan to the requested categories', async () => {
    const { ctx, registered } = fakeContext()
    apply(ctx, { dshHome, reportDir })
    const value = await registered[0].execute({ categories: ['sessions'], write: false }, {})
    assert.deepEqual(value.categories.map((category) => category.id), ['sessions'])
    assert.equal(value.totals.bytes, 4096)
  })

  it('surfaces a report directory configured outside the scan root', async () => {
    const { ctx, registered } = fakeContext()
    apply(ctx, { dshHome, reportDir })
    const value = await registered[0].execute({ write: true }, {})
    assert.ok(value.warnings.some((warning) => warning.includes('$DSH_HOME 之外')))
    assert.ok(value.markdown.includes('$DSH_HOME 之外'))
    const jsonName = fs.readdirSync(reportDir).find((name) => name.endsWith('.json'))
    const written = JSON.parse(fs.readFileSync(path.join(reportDir, jsonName), 'utf8'))
    assert.ok(written.warnings.some((warning) => warning.includes('$DSH_HOME 之外')))
  })

  it('rejects an out-of-range topN and an unknown category', async () => {
    const { ctx, registered } = fakeContext()
    apply(ctx, { dshHome, reportDir })
    const tool = registered[0]
    await assert.rejects(() => tool.execute({ topN: 0 }, {}), /topN must be an integer between 1 and 100/)
    await assert.rejects(() => tool.execute({ topN: 101 }, {}), /topN must be an integer between 1 and 100/)
    await assert.rejects(() => tool.execute({ categories: ['nope'] }, {}), /unknown categories: nope/)
  })

  it('honours the configured topN when the caller omits it', async () => {
    const { ctx, registered } = fakeContext()
    apply(ctx, { dshHome, reportDir, topN: 1 })
    const value = await registered[0].execute({ write: false }, {})
    for (const category of value.categories) assert.ok(category.topItems.length <= 1)
  })
})

describe('v0.1 safety invariants', () => {
  // Both halves ship in this package, so the guards cover everything that runs:
  // the host modules and the browser bundle.
  const sourceDirs = [
    { name: 'lib', url: new URL('../lib/', import.meta.url) },
    { name: 'client', url: new URL('../client/', import.meta.url) }
  ]
  const sources = sourceDirs.flatMap(({ name, url }) =>
    fs.readdirSync(url)
      .filter((entry) => entry.endsWith('.js'))
      .map((entry) => ({ label: `${name}/${entry}`, url: new URL(entry, url) }))
  )
  const read = (source) => fs.readFileSync(source.url, 'utf8')

  it('ships no delete path in either half', () => {
    // Renaming a file into quarantine is allowed; destroying one is not. The pattern names
    // every spelling of "delete" the Node API and the shell offer, including the `Sync`
    // forms, so a future edit cannot slip one in unnoticed.
    const forbidden = /\bunlink|\bunlinkSync|rmdir|rmdirSync|\brm\(|\brmSync|trashItem|Remove-Item|shutil\.rmtree/i
    assert.ok(sources.length >= 5)
    for (const source of sources) {
      assert.ok(!forbidden.test(read(source)), `${source.label} must not contain a delete call`)
    }
    // A move is the quarantine's own business: `renameSync` may appear in exactly one file.
    const movers = sources.filter((source) => /renameSync\(/.test(read(source))).map((source) => source.label)
    assert.deepEqual(movers, ['lib/cleanup.js'], 'only the cleanup module ever moves a file')
  })

  it('opens exactly two files for reading, and never a credential store', () => {
    // The privacy claim in the README, bound to the code. Sizing needs metadata only; the
    // two reads are the workspace index (so a report can name a session's workspace) and
    // the plugin's own quarantine manifest (so an undo knows what it moved). Both are
    // closed, named files: nothing walks the disk looking for content to open.
    const reads = []
    for (const source of sources) {
      for (const _match of read(source).matchAll(/readFileSync\(/g)) reads.push(source.label)
    }
    assert.deepEqual([...new Set(reads)].sort(), ['lib/cleanup.js', 'lib/targets.js'],
      'the workspace index and the quarantine manifest, and nothing else')
    assert.equal(reads.length, 2, 'exactly two read calls in the whole package')

    const index = sources.find((source) => source.label === 'lib/targets.js')
    assert.match(read(index), /workspace\.json/, 'one read is the workspace index')
    const cleanup = sources.find((source) => source.label === 'lib/cleanup.js')
    assert.match(read(cleanup), /MANIFEST_NAME/, 'the other is the manifest this plugin wrote itself')

    // Nothing anywhere may name a place secrets live. A *path* to `.env` is the
    // thing being forbidden, so `.env` must not be preceded by an identifier dot:
    // `options.env` is an ordinary parameter, not a credential store.
    for (const source of sources) {
      const code = read(source)
      assert.ok(!/credentials|\.netrc|id_rsa|id_ed25519|(^|[\\/'"`\s])\.env\b|credentials\.yaml/i.test(code),
        `${source.label} must not reach a credential store`)
    }
  })

  it('reaches the network in neither half', () => {
    // Outbound access: an absolute URL, a client that reaches a third-party host, or
    // the host half talking HTTP at all. A relative `fetch` in the browser half is
    // the panel reading its own host's local route, which is not outbound traffic.
    const outbound = /\bfetch\(\s*['"`]https?:|node:https?\b|require\(['"]https?['"]\)|XMLHttpRequest|WebSocket/i
    for (const source of sources) {
      const code = read(source)
      assert.ok(!outbound.test(code), `${source.label} must not reach the network`)
      if (source.label.startsWith('lib/')) {
        assert.ok(!/\bfetch\(/.test(code), `${source.label} must not fetch at all`)
      }
    }
  })

  it('declares a capability block that agrees with what the code does', () => {
    const manifest = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    assert.equal(manifest.dshhub.schemaVersion, 1)
    assert.deepEqual(manifest.dshhub.surfaces, ['host', 'web'],
      'the plugin ships a host half and a browser half')
    assert.deepEqual(manifest.dshhub.permissions.network, [],
      'the manifest must declare zero network origins')
    // The declaration is only worth anything if it matches the code: tie it to the
    // same guard that scans both halves for outbound access.
    const outbound = /\bfetch\(\s*['"`]https?:|node:https?\b|require\(['"]https?['"]\)|XMLHttpRequest|WebSocket/i
    for (const source of sources) {
      assert.ok(!outbound.test(read(source)), `${source.label} reaches the network the manifest denies`)
    }
    // Compatibility must not claim more than was actually verified.
    assert.ok(
      Object.values(manifest.dsh.compatibility.dshReleases).every((state) => state === 'compatible'),
      'every listed DSH release is claimed compatible'
    )
    assert.equal(manifest.dsh.compatibility.dsh, '>=0.1.0-rc.2')
    // DSH decides admission from `engines.dsh` when it is present, and only falls
    // back to the peer ranges when it is absent. Without it every new DSH release
    // invalidates the plugin unless the peer list happens to name that exact
    // version — which is what made 0.1.0 unusable on DSH 0.2.1-rc.2.
    assert.equal(typeof manifest.engines.dsh, 'string', 'the plugin declares a DSH engine range')
    assert.ok(manifest.engines.dsh.trim() !== '', 'the declared DSH range is not empty')
  })

  it('writes only where it is allowed to: report artifacts and the quarantine manifest', () => {
    const writes = []
    for (const source of sources) {
      for (const match of read(source).matchAll(/fs\.(writeFileSync|mkdirSync|appendFileSync|createWriteStream)\(/g)) {
        writes.push(`${source.label}:${match[1]}`)
      }
    }
    // Two modules write, and each only in its own place: the entry module for the report
    // artifacts, the cleanup module for the quarantine folder and its manifest. The
    // browser half touches no filesystem at all, and nothing streams or appends.
    assert.deepEqual([...new Set(writes.map((entry) => entry.split(':')[0]))].sort(),
      ['lib/cleanup.js', 'lib/index.js'])
    assert.equal(writes.filter((entry) => entry.startsWith('lib/index.js')).length, 3,
      'the report artifacts are still the only writes the entry module makes')
    assert.ok(writes.filter((entry) => entry.startsWith('lib/cleanup.js'))
      .every((entry) => entry.endsWith(':writeFileSync') || entry.endsWith(':mkdirSync')),
    'the cleanup module only makes folders and writes its manifest')
  })
})

describe('panel data route', () => {
  /** A response object that records what the handler wrote. */
  function fakeResponse () {
    return {
      status: undefined,
      headers: undefined,
      body: undefined,
      writeHead (status, headers) {
        this.status = status
        this.headers = headers
      },
      end (body) {
        this.body = body
      }
    }
  }

  /**
   * Apply the plugin and hand back the route the host half registered.
   * @param {object} ctx - the context carrying the captured registration.
   * @returns {object} the registration.
   */
  function captureRoute () {
    const registrations = []
    const fakeServer = {
      register (value) {
        registrations.push(value)
        return () => {}
      }
    }
    const ctx = {
      tools: { register: () => {} },
      // Optional seat: the host half asks for `webServer` and gets a child context.
      inject: (names, callback) => {
        assert.deepEqual(names, ['webServer'])
        callback({
          webServer: fakeServer,
          effect: (fn) => fn()
        })
      }
    }
    apply(ctx, { dshHome, reportDir })
    // The host half registers two routes; these cases are about the read-only one.
    const registration = registrations.find((entry) => entry.path === REPORT_ROUTE)
    assert.ok(registration !== undefined, 'the host half must register the panel route')
    return registration
  }

  it('reads the requested item count, ignoring nonsense and clamping the rest', () => {
    assert.equal(topFromUrl(REPORT_ROUTE, 10), 10)
    assert.equal(topFromUrl(`${REPORT_ROUTE}?top=25`, 10), 25)
    assert.equal(topFromUrl(`${REPORT_ROUTE}?top=0`, 10), 10)
    assert.equal(topFromUrl(`${REPORT_ROUTE}?top=-3`, 10), 10)
    assert.equal(topFromUrl(`${REPORT_ROUTE}?top=abc`, 10), 10)
    assert.equal(topFromUrl(`${REPORT_ROUTE}?top=1.5`, 10), 10)
    assert.equal(topFromUrl(`${REPORT_ROUTE}?top=5000`, 10), 100, 'clamped to the documented ceiling')
  })

  it('serves the same report the tool produces, without writing anything', async () => {
    const route = captureRoute()
    assert.equal(route.kind, 'exact')
    assert.equal(route.path, REPORT_ROUTE)
    const before = fs.readdirSync(fixtureRoot).sort()
    const response = fakeResponse()
    await route.handler({ method: 'GET', url: `${REPORT_ROUTE}?top=3` }, response)
    assert.equal(response.status, 200)
    assert.equal(response.headers['cache-control'], 'no-store')
    const body = JSON.parse(response.body)
    assert.equal(body.schema, 'dsh-disk-doctor/report@1')
    assert.equal(body.totals.bytes, 4096 + 8192 + 1024)
    // The panel runs on the user's own screen and needs real paths to offer a copy
    // button; the tool result and the saved file stay redacted.
    assert.equal(body.dshHome, dshHome, 'the route hands the panel real paths')
    assert.ok(!JSON.stringify(body).includes('~~'), 'and never a double-redacted path')
    assert.ok(body.categories.every((category) => category.topItems.length <= 3), 'top is honoured')
    assert.deepEqual(fs.readdirSync(fixtureRoot).sort(), before, 'reading the panel must not create files')
  })

  it('answers HEAD without a body and refuses other methods', async () => {
    const route = captureRoute()
    const head = fakeResponse()
    await route.handler({ method: 'HEAD', url: REPORT_ROUTE }, head)
    assert.equal(head.status, 200)
    assert.equal(head.body, undefined)

    const post = fakeResponse()
    await route.handler({ method: 'POST', url: REPORT_ROUTE }, post)
    assert.equal(post.status, 405)
    assert.equal(post.headers.allow, 'GET, HEAD')
  })

  it('still works when no web server is composed', () => {
    const registered = []
    const ctx = {
      tools: { register: (tool) => registered.push(tool) },
      // A headless deployment never offers the service, so the child never runs.
      inject: () => {}
    }
    apply(ctx, { dshHome, reportDir })
    assert.equal(registered.length, 1, 'the tool registers regardless of the web server')
  })
})
describe('live settings', () => {
  // `.volatile()` fields are edited *without* re-applying the plugin: the host writes
  // the new value into the same frozen reference. A value captured at load time would
  // therefore keep answering with the old one, and the permission switches would look
  // broken until the next restart. These cases pin the live reading down.
  const safeDir = path.join(tempDir, 'dsh-spill-xyz')

  /** The host's volatile reference: frozen shape, value swapped underneath. */
  function box (initial) {
    const state = { value: initial }
    return { state, field: Object.freeze({ get: () => state.value }) }
  }

  /** A context whose optional web-server seat records the routes it is handed. */
  function webContext (deps) {
    const routes = new Map()
    return {
      routes,
      deps,
      ctx: {
        tools: { register: () => {} },
        inject: (names, callback) => {
          if (!names.includes('webServer')) return
          callback({
            effect: (fn) => fn(),
            // The Host's browser-trust fence. Absent unless a case supplies one, which is
            // also the honest default: a composition can carry a web server with no
            // Connection service, and the routes must still work there.
            get: (service) => service === 'connection' ? deps?.connection : undefined,
            webServer: {
              register: (value) => {
                routes.set(value.path, value)
                return () => {}
              }
            }
          })
        }
      }
    }
  }

  /** Drive one route and hand back its status and parsed body. */
  async function call (route, { method, path: target, action, id }) {
    const response = {
      status: undefined,
      body: undefined,
      writeHead (status) { this.status = status },
      end (body) { this.body = body }
    }
    const query = new URLSearchParams()
    if (target !== undefined) query.set('path', target)
    if (action !== undefined) query.set('action', action)
    if (id !== undefined) query.set('id', id)
    const suffix = query.toString() === '' ? '' : `?${query.toString()}`
    await route.handler({ method, url: `${route.path}${suffix}` }, response)
    // A refusal answers with an empty body on purpose; only parsed when there is one.
    return {
      status: response.status,
      body: response.body === undefined ? undefined : JSON.parse(response.body)
    }
  }

  it('asks the Host browser-trust fence before any route acts', async () => {
    // A route registered straight on `webServer` does not inherit the fence the `/api`
    // bridge applies to itself, so a page the user merely visited could otherwise POST a
    // move or pop a file-manager window. The fence belongs to the Host; every route has
    // to consult it, and to do so before it reads, plans or renames anything.
    const consulted = []
    const { ctx, routes } = webContext({
      connection: {
        requestRejection: (request) => {
          consulted.push(request.url)
          return request.headers?.['sec-fetch-site'] === 'cross-site' ? 403 : undefined
        }
      }
    })
    apply(ctx, { dshHome, reportDir, allowOpenFolder: true, allowCleanup: true })
    const send = async (path, method, url, headers) => {
      const response = {
        status: undefined,
        body: undefined,
        writeHead (status) { this.status = status },
        end (body) { this.body = body }
      }
      const route = routes.get(path)
      assert.ok(route !== undefined, `${path} must be registered`)
      await route.handler({ method, url, headers }, response)
      return response
    }

    // A cross-site request is refused on all three, whichever verb it uses.
    for (const [path, method] of [[REPORT_ROUTE, 'GET'], [CLEANUP_ROUTE, 'GET'], [OPEN_ROUTE, 'POST']]) {
      const refused = await send(path, method, path, { 'sec-fetch-site': 'cross-site' })
      assert.equal(refused.status, 403, `${path} must refuse a cross-site request`)
    }
    assert.equal(consulted.length, 3, 'every route asked the fence')

    // An admitted request still reaches the handler's own rules — the fence replaces
    // neither the method check nor the containment rule.
    const wrongVerb = await send(CLEANUP_ROUTE, 'PUT', CLEANUP_ROUTE, {})
    assert.equal(wrongVerb.status, 405, 'the fence admits, the method check still refuses')
    const outsideRoot = await send(OPEN_ROUTE, 'POST',
      `${OPEN_ROUTE}?path=${encodeURIComponent(fixtureRoot)}`, {})
    assert.equal(outsideRoot.status, 400, 'a path outside the scan roots is still refused')
  })

  it('lets a settings change reach both routes without a restart', async () => {
    const openFolder = box(false)
    const sensitive = box(false)
    const { ctx, routes } = webContext()
    const revealed = []
    apply(ctx, {
      dshHome,
      reportDir,
      allowOpenFolder: openFolder.field,
      allowOpenFolderSensitive: sensitive.field
    }, { reveal: (target) => revealed.push(target) })
    const report = routes.get(REPORT_ROUTE)
    const open = routes.get(OPEN_ROUTE)
    assert.ok(report !== undefined && open !== undefined, 'both routes register')

    // Off by default: the panel must draw no usable button and the host must refuse.
    assert.deepEqual((await call(report, { method: 'GET' })).body.capabilities,
      { openFolder: false, openFolderSensitive: false, cleanup: false })
    const refused = await call(open, { method: 'POST', path: safeDir })
    assert.equal(refused.status, 403)
    assert.equal(refused.body.error, 'disabled')
    assert.deepEqual(revealed, [], 'a refused request opens nothing at all')

    // The host writes into the same reference — nothing is re-registered here.
    openFolder.state.value = true
    assert.deepEqual((await call(report, { method: 'GET' })).body.capabilities,
      { openFolder: true, openFolderSensitive: false, cleanup: false },
      'the panel learns about the change on its next fetch')
    const allowed = await call(open, { method: 'POST', path: safeDir })
    assert.equal(allowed.status, 200)
    assert.deepEqual(allowed.body, { opened: true, safety: 'safe' })
    assert.deepEqual(revealed, [safeDir], 'and the folder that opens is the one that was asked for')

    // The second switch is separate: a care-level location still needs it.
    const stillRefused = await call(open, { method: 'POST', path: dshHome })
    assert.equal(stillRefused.status, 400)
    assert.equal(stillRefused.body.error, 'sensitive')
    assert.deepEqual(revealed, [safeDir])

    sensitive.state.value = true
    const nowAllowed = await call(open, { method: 'POST', path: dshHome })
    assert.equal(nowAllowed.status, 200)
    assert.equal(nowAllowed.body.safety, 'care')
    assert.deepEqual(revealed, [safeDir, dshHome])

    // …and turning the master switch back off closes the door again.
    openFolder.state.value = false
    const closed = await call(open, { method: 'POST', path: safeDir })
    assert.equal(closed.status, 403)
    assert.deepEqual((await call(report, { method: 'GET' })).body.capabilities,
      { openFolder: false, openFolderSensitive: true, cleanup: false })
    assert.deepEqual(revealed, [safeDir, dshHome], 'and nothing more is opened')
  })

  it('re-reads the fields a scan depends on, too', async () => {
    const { ctx, routes } = webContext()
    const excluded = box([])
    apply(ctx, { dshHome, reportDir, excludeGlobs: excluded.field })
    const report = routes.get(REPORT_ROUTE)

    const included = (await call(report, { method: 'GET' })).body
    assert.ok(included.categories.find((category) => category.id === 'sessions').bytes > 0)

    // `excludeGlobs` is volatile as well, so a new pattern applies to the next scan.
    excluded.state.value = [path.join(dshHome, 'sessions')]
    const filtered = (await call(report, { method: 'GET' })).body
    assert.equal(filtered.categories.find((category) => category.id === 'sessions').bytes, 0)
  })

  it('serves the cleanup preview as a read-only dry run, and gates the move behind a switch', async () => {
    const { ctx, routes } = webContext()
    const allowCleanup = box(false)
    apply(ctx, { dshHome, reportDir, allowCleanup: allowCleanup.field })
    const cleanup = routes.get(CLEANUP_ROUTE)
    const report = routes.get(REPORT_ROUTE)
    assert.ok(cleanup !== undefined, 'the cleanup route registers alongside the others')

    const read = await call(cleanup, { method: 'GET' })
    assert.equal(read.status, 200)
    assert.equal(read.body.dryRun, true, 'it announces itself as a dry run')
    assert.ok(Array.isArray(read.body.items))
    assert.ok(read.body.eligible.includes('profile-logs'))
    // Nothing outside the green tier can appear in a plan, whatever the caller does.
    for (const item of read.body.items) {
      assert.ok(read.body.eligible.includes(item.categoryId), `${item.categoryId} is not cleanable`)
    }
    assert.ok(read.body.refused.some((entry) => entry.id === 'profile-deps' && entry.safety === 'care'))
    assert.ok(read.body.warnings.some((warning) => warning.includes('预演')))
    // The fixture's spill directory was written moments ago, so the plan leaves it alone
    // and says so — a live temporary directory is not cleanup material.
    assert.deepEqual(read.body.items, [])
    assert.ok(read.body.skipped.length > 0)
    assert.ok(read.body.warnings.some((warning) => warning.includes('还在改动')))
    assert.ok(read.body.destination.startsWith(path.join(dshHome, 'disk-doctor', 'quarantine')))
    assert.deepEqual(read.body.batches, [], 'and it reports the quarantine as empty')
    assert.equal(fs.existsSync(path.join(dshHome, 'disk-doctor')), false,
      'and running it created nothing at all')

    // A read stays a read: no other verb, and no action, is accepted here.
    for (const method of ['PUT', 'DELETE']) {
      const refused = await call(cleanup, { method })
      assert.equal(refused.status, 405, `${method} must not be accepted`)
    }

    // The switch is off, so both actions are refused — before anything is inspected.
    assert.deepEqual((await call(report, { method: 'GET' })).body.capabilities.cleanup, false,
      'the panel is told the button cannot work')
    const blocked = await call(cleanup, { method: 'POST', action: 'move' })
    assert.equal(blocked.status, 403)
    assert.equal(blocked.body.error, 'disabled')
    assert.equal(fs.existsSync(path.join(dshHome, 'disk-doctor')), false, 'and nothing was created')

    // Flip the live switch: the same route now performs the move, with no restart.
    allowCleanup.state.value = true
    assert.equal((await call(report, { method: 'GET' })).body.capabilities.cleanup, true)
    const moved = await call(cleanup, { method: 'POST', action: 'move' })
    assert.equal(moved.status, 200)
    assert.equal(moved.body.status, 'nothing-to-move', 'the fixture has nothing old enough to move')
    assert.equal(moved.body.manifestPath, null)
    assert.deepEqual(moved.body.items, [])
    assert.equal(fs.existsSync(path.join(dshHome, 'disk-doctor')), false, 'so not even a batch folder appeared')

    // An unknown action is refused rather than guessed at.
    const unknown = await call(cleanup, { method: 'POST', action: 'delete-everything' })
    assert.equal(unknown.status, 400)
    assert.equal(unknown.body.error, 'unknown-action')
    const noId = await call(cleanup, { method: 'POST', action: 'undo' })
    assert.equal(noId.status, 400, 'an undo without a batch is refused')
  })
})

describe('the three areas in the tool result', () => {
  const installDir = path.join(fixtureRoot, 'install')
  const chromiumDir = path.join(fixtureRoot, 'appdata', '@deepseek-ai', 'dsh-desktop')
  const localAppData = path.join(fixtureRoot, 'localappdata')
  const storeDir = path.join(localAppData, 'pnpm')
  let savedLocalAppData

  before(() => {
    fs.mkdirSync(path.join(installDir, 'resources'), { recursive: true })
    fs.writeFileSync(path.join(installDir, 'resources', 'app.asar'), Buffer.alloc(4096, 0x71))
    fs.mkdirSync(path.join(storeDir, 'v11'), { recursive: true })
    fs.writeFileSync(path.join(storeDir, 'v11', 'package.bin'), Buffer.alloc(1024, 0x72))
    fs.mkdirSync(chromiumDir, { recursive: true })
    fs.writeFileSync(path.join(chromiumDir, 'Local State'), Buffer.alloc(512, 0x73))
    savedLocalAppData = process.env.LOCALAPPDATA
    process.env.LOCALAPPDATA = localAppData
  })

  after(() => {
    if (savedLocalAppData === undefined) delete process.env.LOCALAPPDATA
    else process.env.LOCALAPPDATA = savedLocalAppData
  })

  it('reports the install folder, the caches and the data area as separate figures', async () => {
    const { ctx, registered } = fakeContext()
    apply(ctx, { dshHome, reportDir, appDir: installDir })
    const value = await registered[0].execute({ write: false }, {})

    assert.deepEqual(value.areas.map((area) => area.id), ['data', 'app', 'cache'])
    assert.equal(value.areas.find((area) => area.id === 'app').bytes, 4096)
    assert.equal(value.areas.find((area) => area.id === 'cache').bytes, 1024 + 512)
    assert.equal(value.totals.bytes, value.areas.find((area) => area.id === 'data').bytes,
      'the headline figure is the data area, not a sum of the three')
    assert.match(value.areas.find((area) => area.id === 'app').notes.join('\n'), /来自设置/)
    assert.match(value.areas.find((area) => area.id === 'cache').notes.join('\n'), /不能相加/)

    // The panel groups rows by area, so every category has to name one.
    assert.ok(value.categories.every((category) => ['data', 'app', 'cache'].includes(category.area)))
    assert.deepEqual(value.linkInstalls, [])
    for (const category of value.categories) assert.ok(Number.isInteger(category.overlapBytes))
  })

  it('states in the rendered documents which figure is which', async () => {
    const { ctx, registered } = fakeContext()
    apply(ctx, { dshHome, reportDir, appDir: installDir })
    const value = await registered[0].execute({ write: false }, {})
    assert.ok(value.markdown.includes('**DSH 程序'))
    assert.ok(value.markdown.includes('**系统缓存'))
    assert.ok(value.markdown.includes('DSH 数据'), 'the data area is named too')
    assert.ok(!value.markdown.includes('总计'), 'there is no grand total to misread')
  })
})

describe('reveal in file manager', () => {
  // The endpoint launches the OS file manager, so its containment rule is the whole
  // security story. These cases are the reason the rule is a separate function.
  const root = path.join(fixtureRoot, 'reveal-root')
  const inside = path.join(root, 'sessions')
  const outside = path.join(fixtureRoot, 'elsewhere')
  const settings = { allowOpenFolder: true, allowOpenFolderSensitive: false, dshHome: root }
  /** The roots a real scan would report, with their safety levels. */
  const roots = [
    { path: root, safety: 'care', categoryId: 'other', area: 'data' },
    { path: inside, safety: 'safe', categoryId: 'temp-spill', area: 'data' },
    { path: path.join(fixtureRoot, 'install'), safety: 'keep', categoryId: 'app-install', area: 'app' }
  ]

  before(() => {
    fs.mkdirSync(inside, { recursive: true })
    fs.mkdirSync(outside, { recursive: true })
    fs.mkdirSync(path.join(fixtureRoot, 'install'), { recursive: true })
    fs.writeFileSync(path.join(inside, 'session.jsonl.zstd'), 'x')
  })

  it('opens nothing at all while the setting is off', () => {
    const verdict = resolveOpenTarget(inside, { allowOpenFolder: false, dshHome: root })
    assert.deepEqual(verdict, { ok: false, reason: 'disabled' })
  })

  it('refuses anything outside the scan root, however it is spelled', () => {
    const attempts = [
      outside,
      path.join(root, '..', 'elsewhere'),
      path.join(inside, '..', '..', '..', 'Windows'),
      'C:\\Windows',
      '',
      null,
      undefined,
      42
    ]
    for (const attempt of attempts) {
      const verdict = resolveOpenTarget(attempt, settings, { roots })
      assert.equal(verdict.ok, false, `${String(attempt)} must be refused, got ${JSON.stringify(verdict)}`)
    }
  })

  it('accepts a green row once the setting is on', () => {
    const verdict = resolveOpenTarget(inside, settings, { roots })
    assert.deepEqual(verdict, { ok: true, target: inside, safety: 'safe' })
  })

  it('refuses amber and grey rows until the second switch is on', () => {
    // Opening the folder beside someone's conversations, or their application files,
    // is a bigger favour than opening a temp folder — so it needs its own consent.
    const amber = resolveOpenTarget(root, settings, { roots })
    assert.deepEqual(amber, { ok: false, reason: 'sensitive' })

    const grey = resolveOpenTarget(path.join(fixtureRoot, 'install'), settings, { roots })
    assert.deepEqual(grey, { ok: false, reason: 'sensitive' })

    const allowed = { ...settings, allowOpenFolderSensitive: true }
    assert.deepEqual(resolveOpenTarget(root, allowed, { roots }),
      { ok: true, target: root, safety: 'care' })
    assert.deepEqual(resolveOpenTarget(path.join(fixtureRoot, 'install'), allowed, { roots }),
      { ok: true, target: path.join(fixtureRoot, 'install'), safety: 'keep' })
  })

  it('judges a path by the most specific root that covers it', () => {
    // `sessions/` is inside the data folder too; the row's own category wins, so a
    // green row is not dragged down to amber by its parent.
    const verdict = resolveOpenTarget(path.join(inside, 'session.jsonl.zstd'), settings, { roots })
    assert.deepEqual(verdict, { ok: true, target: inside, safety: 'safe' })
  })

  it('reveals the containing folder of a file, never the file itself', () => {
    // Handing a document to the file manager would launch whatever opens it.
    const file = path.join(inside, 'session.jsonl.zstd')
    const verdict = resolveOpenTarget(file, settings, { roots })
    assert.deepEqual(verdict.target, inside)
  })

  it('refuses a path that does not exist', () => {
    const verdict = resolveOpenTarget(path.join(root, 'never-created'), settings, { roots })
    assert.deepEqual(verdict, { ok: false, reason: 'missing' })
  })

  it('falls back to the data folder alone when no roots are supplied', () => {
    // A caller that does not know the target table still gets containment, and still
    // has to opt in to amber rows.
    assert.deepEqual(resolveOpenTarget(inside, settings), { ok: false, reason: 'sensitive' })
    assert.deepEqual(resolveOpenTarget(inside, { ...settings, allowOpenFolderSensitive: true }),
      { ok: true, target: inside, safety: 'care' })
  })

  it('derives the root list from the same target table as the report', () => {
    const listed = openRoots(normalizeConfig({ dshHome, reportDir }, {
      env: {},
      home: fixtureRoot,
      execPath: path.join(fixtureRoot, 'install', 'DeepSeek Harness.exe'),
      resourcesPath: undefined,
      isFile: (target) => path.resolve(target) === path.resolve(path.join(fixtureRoot, 'install', 'resources', 'app.asar')),
      isDirectory: () => false
    }))
    assert.ok(listed.length > 0)
    assert.ok(listed.every((entry) => typeof entry.path === 'string' && typeof entry.safety === 'string'))
    assert.ok(listed.some((entry) => entry.categoryId === 'sessions' && entry.safety === 'keep'))
  })

  it('exposes the rule on a POST-only route', () => {
    let registration
    registerOpenRoute({
      inject: (_names, callback) => callback({
        effect: (fn) => fn(),
        webServer: { register: (value) => { registration = value; return () => {} } }
      })
    }, { allowOpenFolder: false, dshHome: root })
    assert.equal(registration.kind, 'exact')
    assert.equal(registration.path, OPEN_ROUTE)
    assert.equal(OPEN_ROUTE.endsWith('/open'), true)
  })
})