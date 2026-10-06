/**
 * v0.1 acceptance tests.
 *
 * The central test is accuracy: the scanner's total must equal an independent
 * recursive sum of the same fixture, so the report cannot silently double count or
 * drop bytes. The boundary fixtures required by the design — a symlink, an
 * unreadable directory, and an empty directory — are built here too.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'

import { cleanableCategories, listQuarantine, performCleanup, planCleanup, PREVIEW_ITEM_LIMIT, quarantineDirectory, quarantineRoot, readManifest, RECENT_USE_MS, undoCleanup } from '../lib/cleanup.js'
import { formatBytes, redactHome, renderMarkdownFile, renderSummary, timestampSlug, toJsonReport } from '../lib/report.js'
import { globToRegExp, scan } from '../lib/scan.js'
import { CATEGORY_DEFS, isUnder, pathKey, projectKey, readableProjectKey, resolveTargets } from '../lib/targets.js'

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-disk-doctor-test-'))
const dshHome = path.join(fixtureRoot, '.dsh')
const tempDir = path.join(fixtureRoot, 'temp')
const lockedDir = path.join(dshHome, 'misc', 'locked')
const lockedFile = path.join(lockedDir, 'secret.bin')

/** Write a file of `size` bytes, creating parents. Returns the resolved path. */
function writeFile (relative, size, content) {
  const abs = path.join(dshHome, relative)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content ?? Buffer.alloc(size, 0x41))
  return abs
}

/** Recursive byte/file total that skips symlinks — the independent oracle. */
function oracleSum (dir) {
  let bytes = 0
  let files = 0
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return { bytes: 0, files: 0 }
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const nested = oracleSum(abs)
      bytes += nested.bytes
      files += nested.files
    } else if (entry.isFile()) {
      bytes += fs.statSync(abs).size
      files += 1
    }
  }
  return { bytes, files }
}

/** Run `icacls` quietly; the ACL tests need a real permission denial. */
function icacls (args) {
  return spawnSync('icacls', args, { stdio: 'ignore' }).status === 0
}

let denied = false
let fileLinkCreated = false
let dirLinkCreated = false
/** Oracle measured before any permission is denied, so it stays readable. */
let oracle = { bytes: 0, files: 0 }
let spillBytes = 0

before(() => {
  writeFile(path.join('sessions', '--E-demo--', 'session-abc', 'session.jsonl.zstd'), 1000)
  writeFile(path.join('sessions', '--E-demo--', 'session-abc', 'session.v4.jsonl.zstd'), 500)
  writeFile(path.join('storages', 'session_projcache', 'sessions', 'session-abc.json'), 200)
  // A sibling of `sessions/` inside the projection cache: dropping it would be
  // invisible elsewhere, because this whole subtree is a covered root.
  writeFile(path.join('storages', 'session_projcache', 'index.json'), 150)
  writeFile(path.join('storages', 'workspace.json'), 0, JSON.stringify({
    tables: { workspaces: { w1: { path: 'E:\\demo', title: 'demo', sessionIds: ['session-abc'] } } }
  }))
  writeFile(path.join('profiles', 'desktop', 'node_modules', 'dsh-pet', 'index.js'), 3000)
  writeFile(path.join('profiles', 'desktop', '.plugin-manager', 'logs', 'operation-1', 'pnpm.log'), 400)
  writeFile(path.join('profiles', 'desktop', '.dsh-market', 'state.json'), 100)
  writeFile(path.join('dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'node', 'bin', 'node.exe'), 2048)
  // Lives beside `dependencies/`, not inside it: a runtime keeps its own files there,
  // and nothing else can account for them because this subtree is a covered root.
  writeFile(path.join('dsh-runtimes', 'dsh-primary-runtime', 'runtime.json'), 300)
  writeFile(path.join('plugin-packages', 'foo.tgz'), 256)
  writeFile(path.join('misc', 'plain.bin'), 123)
  writeFile(path.join('misc', 'locked', 'secret.bin'), 700)
  fs.mkdirSync(path.join(dshHome, 'misc', 'empty'), { recursive: true })

  fs.mkdirSync(path.join(tempDir, 'dsh-spill-aaa'), { recursive: true })
  fs.writeFileSync(path.join(tempDir, 'dsh-spill-aaa', 'x.bin'), Buffer.alloc(333, 0x42))
  fs.mkdirSync(path.join(tempDir, 'dsh-abc'), { recursive: true })
  fs.writeFileSync(path.join(tempDir, 'dsh-abc', 'y.bin'), Buffer.alloc(111, 0x42))
  fs.writeFileSync(path.join(tempDir, 'unrelated.txt'), Buffer.alloc(999, 0x42))

  // A junction needs no privilege on Windows; a file symlink may, so it is optional.
  try {
    fs.symlinkSync(path.resolve(dshHome, 'sessions'), path.join(dshHome, 'misc', 'link-to-sessions'), 'junction')
    dirLinkCreated = true
  } catch { /* junction unsupported here */ }
  try {
    fs.symlinkSync(path.join(dshHome, 'misc', 'plain.bin'), path.join(dshHome, 'misc', 'link-file.bin'), 'file')
    fileLinkCreated = true
  } catch { /* file symlinks need Developer Mode on Windows */ }

  oracle = oracleSum(dshHome)
  spillBytes = oracleSum(path.join(tempDir, 'dsh-spill-aaa')).bytes + oracleSum(path.join(tempDir, 'dsh-abc')).bytes
})

after(() => {
  if (denied) icacls([lockedDir, '/remove:d', process.env.USERNAME ?? ''])
  try {
    fs.rmSync(fixtureRoot, { recursive: true, force: true })
  } catch { /* best effort */ }
})

const baseOptions = () => ({ dshHome, tempDir, topN: 5 })

describe('targets', () => {
  it('reproduces the host projectKey algorithm byte for byte', () => {
    assert.equal(projectKey('E:\\disk-doctor'), '--E-disk-doctor--')
    assert.equal(projectKey('E:\\deepseek harness test'), '--E-deepseek~0020harness~0020test--')
    assert.equal(projectKey('C:\\'), '--C---')
  })

  it('decodes the readable form without inventing separators', () => {
    assert.equal(readableProjectKey('--E-deepseek~0020harness~0020test--'), 'E-deepseek harness test')
    assert.equal(readableProjectKey('--root--'), 'root')
  })

  it('reports a missing category path instead of dropping it silently', () => {
    const resolved = resolveTargets({ dshHome, tempDir })
    const pluginCache = resolved.categories.find((category) => category.id === 'plugin-cache')
    assert.equal(pluginCache.roots.length, 1)
    const warnings = resolveTargets({ dshHome: path.join(fixtureRoot, 'nope'), tempDir })
    // Worded for a reader, and named by label: an internal id such as
    // `plugin-cache` must never reach the panel.
    const missing = warnings.warnings.find((warning) => warning.includes('还没建'))
    assert.ok(missing !== undefined, 'a missing root is reported, not dropped silently')
    assert.ok(!/[a-z]+-[a-z]+：/.test(missing), `the warning must not lead with an internal id: ${missing}`)
  })
})

describe('glob matching', () => {
  it('keeps a single star inside one path segment', () => {
    const re = globToRegExp('C:/x/big-*')
    assert.ok(re.test('C:/x/big-1'))
    assert.ok(!re.test('C:/x/big-1/nested'))
  })

  it('lets a double star cross segments', () => {
    const re = globToRegExp('C:/x/**/node_modules/**')
    assert.ok(re.test('C:/x/a/b/node_modules/c/d'))
  })
})

describe('scan accuracy', () => {
  it('totals exactly the bytes an independent walk finds', async () => {
    const result = await scan(baseOptions())
    assert.equal(result.totals.bytes, oracle.bytes + spillBytes)
    assert.equal(result.totals.files, oracle.files + 2)
    assert.equal(result.truncated, false)
    // The `unrelated.txt` decoy in temp must not be counted.
    assert.ok(!JSON.stringify(result).includes('unrelated.txt'))
  })

  it('counts each category exactly once, so the parts equal the whole', async () => {
    const result = await scan(baseOptions())
    const summed = result.categories.reduce((sum, category) => sum + category.bytes, 0)
    assert.equal(summed, result.totals.bytes)
  })

  it('classifies every planted category correctly', async () => {
    const result = await scan(baseOptions())
    const byId = Object.fromEntries(result.categories.map((category) => [category.id, category.bytes]))
    assert.equal(byId.sessions, 1500)
    assert.equal(byId['profile-deps'], 3000)
    assert.equal(byId['profile-logs'], 400)
    assert.equal(byId['profile-market'], 100)
    assert.equal(byId.runtimes, 2048 + 300)
    assert.equal(byId['plugin-cache'], 256)
    assert.equal(byId['temp-spill'], 444)
    assert.ok(byId.other >= 823)
  })

  it('accounts for files sitting beside a runtime dependencies directory', async () => {
    const result = await scan(baseOptions())
    const runtimes = result.categories.find((category) => category.id === 'runtimes')
    const labels = runtimes.topItems.map((item) => item.path)
    assert.ok(labels.some((entry) => entry.endsWith('runtime.json')),
      'a runtime file beside dependencies/ must be listed')
    assert.ok(labels.some((entry) => entry.endsWith('node')),
      'the dependency component must still be listed')
    // Nothing is counted twice: the parts still equal the category total.
    const summed = runtimes.topItems.reduce((sum, item) => sum + item.bytes, 0)
    assert.equal(summed, runtimes.bytes)
  })

  it('labels a session with its real workspace title and date', async () => {
    const result = await scan(baseOptions())
    const sessions = result.categories.find((category) => category.id === 'sessions')
    assert.equal(sessions.topItems.length, 1)
    assert.equal(sessions.topItems[0].bytes, 1500)
    assert.match(sessions.topItems[0].note, /^\d{4}-\d{2}-\d{2} · demo$/)
  })

  it('counts an empty directory as zero bytes and zero files', async () => {
    const emptyOnly = path.join(fixtureRoot, 'empty-fixture')
    fs.mkdirSync(path.join(emptyOnly, 'nothing-here'), { recursive: true })
    const result = await scan({ dshHome: emptyOnly, tempDir: path.join(fixtureRoot, 'no-temp'), topN: 5 })
    assert.equal(result.totals.bytes, 0)
    assert.equal(result.totals.files, 0)
    assert.equal(result.totals.dirs, 1)
    const other = result.categories.find((category) => category.id === 'other')
    assert.equal(other.topItems[0].bytes, 0)
    assert.equal(other.topItems[0].files, 0)
  })
})

describe('symlinks', () => {
  it('does not follow links by default and says so', async () => {
    const result = await scan(baseOptions())
    if (!dirLinkCreated && !fileLinkCreated) return
    assert.ok(result.symlinks >= 1)
    assert.ok(result.warnings.some((warning) => warning.includes('符号链接')))
    // The junction points at sessions; following it would double count 1500 bytes.
    assert.equal(result.totals.bytes, oracle.bytes + spillBytes)
  })

  it('follows links to real directories once when asked', async () => {
    if (!dirLinkCreated) return
    const result = await scan({ ...baseOptions(), followSymlinks: true })
    // A followed junction adds no new bytes: every target is already counted once.
    assert.equal(result.totals.bytes, oracle.bytes + spillBytes)
  })
})

describe('category partitioning', () => {
  /** Every file under `dir` that the scanner's policy reaches. */
  function filesUnder (dir, pruned) {
    const out = new Set()
    const walk = (current) => {
      let entries
      try {
        entries = fs.readdirSync(current, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue
        const abs = path.join(current, entry.name)
        if (entry.isDirectory()) {
          if (!pruned.has(pathKey(abs))) walk(abs)
        } else if (entry.isFile()) {
          out.add(pathKey(abs))
        }
      }
    }
    walk(dir)
    return out
  }

  // Guards the whole class of bug this suite already hit twice: a category that
  // "expands" a subdirectory must still partition its root, and a file dropped
  // here is dropped by every category, because the catch-all prunes covered roots.
  it('accounts for every file under each root exactly once', async () => {
    const { categories, covered } = resolveTargets({ dshHome, tempDir })
    assert.ok(categories.length > 0)
    for (const category of categories) {
      for (const root of category.roots) {
        if (root.whole === true) continue
        const reachable = filesUnder(root.path, covered)
        const byItems = new Set()
        for (const item of await category.enumerate(root)) {
          if (item.isSymlink === true) continue
          // Mirrors the production filter for the catch-all.
          if (category.id === 'other' && covered.has(pathKey(item.path))) continue
          const under = item.isDir === true
            ? filesUnder(item.path, covered)
            : new Set([pathKey(item.path)])
          for (const file of under) {
            assert.ok(!byItems.has(file), `${category.id}: ${file} is counted by two items`)
            byItems.add(file)
          }
        }
        const missing = [...reachable].filter((file) => !byItems.has(file))
        assert.deepEqual(missing, [], `${category.id} leaves files unaccounted for`)
        const extra = [...byItems].filter((file) => !reachable.has(file))
        assert.deepEqual(extra, [], `${category.id} counts files outside its root`)
      }
    }
  })
})

describe('guard rails', () => {
  it('stops at the file ceiling and flags the result as truncated', async () => {
    const result = await scan({ ...baseOptions(), limits: { maxFiles: 3, maxDurationMs: 30_000 } })
    assert.equal(result.truncated, true)
    assert.ok(result.warnings.some((warning) => warning.includes('上限')))
    assert.ok(result.totals.files <= 4)
  })

  it('honours excludeGlobs', async () => {
    const result = await scan({
      ...baseOptions(),
      excludeGlobs: [path.join(dshHome, 'dsh-runtimes')]
    })
    const runtimes = result.categories.find((category) => category.id === 'runtimes')
    assert.equal(runtimes.bytes, 0)
  })

  it('returns zeros and warnings for a scan root that does not exist', async () => {
    const result = await scan({
      dshHome: path.join(fixtureRoot, 'no-such-home'),
      tempDir: path.join(fixtureRoot, 'no-such-temp'),
      topN: 5
    })
    assert.equal(result.totals.bytes, 0)
    assert.equal(result.totals.files, 0)
    assert.equal(result.truncated, false)
    assert.ok(result.warnings.length > 0, 'a missing root must be reported, not silently empty')
    assert.ok(renderSummary(result).includes('DSH 数据 0 B'))
  })

  it('scans only the requested categories, with totals to match', async () => {
    const result = await scan({ ...baseOptions(), only: ['sessions'] })
    assert.deepEqual(result.categories.map((category) => category.id), ['sessions'])
    assert.equal(result.totals.bytes, 1500)
  })

  it('skips an unreadable directory and keeps counting the rest', async () => {
    if (process.platform !== 'win32' || (process.env.USERNAME ?? '') === '') return
    denied = icacls([lockedDir, '/deny', `${process.env.USERNAME}:(RX)`])
    if (!denied) return
    try {
      const result = await scan(baseOptions())
      assert.ok(result.unreadable >= 1)
      assert.ok(result.warnings.some((warning) => warning.includes('无法读取')))
      // Everything except the denied file is still accounted for.
      assert.equal(result.totals.bytes, oracle.bytes + spillBytes - fs.statSync(lockedFile).size)
    } finally {
      denied = !icacls([lockedDir, '/remove:d', process.env.USERNAME ?? ''])
    }
  })
})

describe('report rendering', () => {
  it('renders a summary whose headline numbers match the scan', async () => {
    const result = await scan(baseOptions())
    const markdown = renderSummary(result, { reportPath: 'X:/report.md' })
    assert.match(markdown, /### DSH 空间体检 — DSH 数据 /)
    assert.ok(markdown.includes('可以安全清理'), 'the cleanable total is spelled out')
    assert.ok(markdown.includes('三部分相加就是总数'), 'the reader is told the parts add up to one total')
    assert.ok(markdown.includes('需要正确操作才能省下'), 'the middle bucket is explained, not just counted')
    assert.ok(markdown.includes('来自'), 'the cleanable total names where it lives')
    assert.ok(markdown.includes('报告已写入 `X:/report.md`'))
    assert.ok(markdown.includes('会话日志'))
  })

  it('renders the full document with a top-N table per category', async () => {
    const generatedAt = new Date('2026-10-06T12:30:00.000Z')
    const result = await scan(baseOptions())
    const markdown = renderMarkdownFile(result, { dshHome, generatedAt })
    assert.ok(markdown.startsWith('# DSH 空间体检报告'))
    assert.ok(markdown.includes('| 大小 | 文件数 | 路径 | 备注 |'))
    assert.ok(markdown.includes('只读扫描，未删除或修改任何文件'))
  })

  it('emits the documented JSON contract with integer byte counts', async () => {
    const generatedAt = new Date('2026-10-06T12:30:00.000Z')
    const result = await scan(baseOptions())
    const json = toJsonReport(result, { dshHome, generatedAt })
    assert.equal(json.schema, 'dsh-disk-doctor/report@1')
    assert.equal(json.generatedAt, '2026-10-06T12:30:00.000Z')
    assert.equal(json.dshHome, redactHome(dshHome), 'the document redacts the account name')
    assert.ok(!JSON.stringify(json).includes(os.homedir()), 'no account name survives anywhere in the document')
    assert.ok(Number.isInteger(json.totals.bytes))
    assert.ok(Number.isInteger(json.totals.files))
    assert.equal(typeof json.platform.os, 'string')
    for (const category of json.categories) {
      assert.ok(Number.isInteger(category.bytes))
      assert.ok(Array.isArray(category.roots))
      for (const item of category.topItems) {
        assert.ok(Number.isInteger(item.bytes))
        assert.ok(Number.isInteger(item.files))
        assert.equal(typeof item.path, 'string')
      }
    }
    // The whole document must survive a round trip, as it is written to disk.
    assert.deepEqual(JSON.parse(JSON.stringify(json)), json)
  })

  it('formats sizes and timestamps deterministically', () => {
    assert.equal(formatBytes(0), '0 B')
    assert.equal(formatBytes(1024), '1.00 KB')
    assert.equal(formatBytes(5 * 1024 ** 3), '5.00 GB')
    assert.equal(timestampSlug(new Date(2026, 9, 6, 20, 30, 0)), '20261006-203000')
  })
})
describe('safety levels', () => {
  it('labels every category with a level the tool schema allows', async () => {
    const result = await scan(baseOptions())
    const allowed = new Set(['safe', 'care', 'keep'])
    assert.ok(result.categories.length > 0)
    for (const category of result.categories) {
      assert.ok(allowed.has(category.safety), `${category.id} has safety "${category.safety}"`)
    }
  })

  it('keeps the three buckets adding up to the data-area total', async () => {
    const result = await scan(baseOptions())
    const data = result.categories.filter((category) => category.area === 'data')
    const sum = (level) => data
      .filter((category) => category.safety === level)
      .reduce((total, category) => total + category.bytes, 0)
    assert.equal(sum('safe') + sum('care') + sum('keep'), result.totals.bytes,
      'every byte of the data area belongs to exactly one safety level')
  })

  it('claims the Electron runtime as the application, not as uncategorised junk', () => {
    // The regression that made "other" the biggest group on a real machine:
    // ~/.dsh/electron was reported as leftovers, which told a reader nothing.
    assert.ok(CATEGORY_DEFS.some((def) => def.id === 'runtime-app'))
    const app = CATEGORY_DEFS.find((def) => def.id === 'runtime-app')
    assert.equal(app.safety, 'keep', 'the program itself is never offered up for removal')
  })
})

describe('the three areas', () => {
  const appRoot = path.join(fixtureRoot, 'install')
  const chromiumDir = path.join(fixtureRoot, 'chromium')
  const pnpmStore = path.join(fixtureRoot, 'pnpm')
  const npmDsh = path.join(fixtureRoot, 'npm-global', '@deepseek-ai', 'dsh')
  const appBytes = 4096 + 1024
  const chromiumBytes = 777
  const storeBytes = 3000
  /** The npm install's own bytes: its manifest plus one dependency file. */
  const npmManifest = JSON.stringify({ name: '@deepseek-ai/dsh' })
  const npmBytes = Buffer.byteLength(npmManifest) + 5120
  let hardLinkCreated = false
  let npmLinkCreated = false

  before(() => {
    fs.mkdirSync(path.join(appRoot, 'resources'), { recursive: true })
    fs.writeFileSync(path.join(appRoot, 'resources', 'app.asar'), Buffer.alloc(4096, 0x51))
    fs.writeFileSync(path.join(appRoot, 'DeepSeek Harness.exe'), Buffer.alloc(1024, 0x52))
    fs.mkdirSync(chromiumDir, { recursive: true })
    fs.writeFileSync(path.join(chromiumDir, 'Local State'), Buffer.alloc(chromiumBytes, 0x53))
    fs.mkdirSync(path.join(pnpmStore, 'v11'), { recursive: true })
    // The store holds the real file; a plugin's node_modules hard-links to it. That is
    // one physical file with two paths — the case a naive sum gets wrong.
    try {
      fs.linkSync(
        path.join(dshHome, 'profiles', 'desktop', 'node_modules', 'dsh-pet', 'index.js'),
        path.join(pnpmStore, 'v11', 'index.js')
      )
      hardLinkCreated = true
    } catch { /* no hard links on this filesystem */ }

    // A second DSH installation, the way npm installs one, plus the junction a profile
    // uses to reach it — the arrangement that used to hide a quarter of a gigabyte.
    fs.mkdirSync(path.join(npmDsh, 'node_modules', 'dep'), { recursive: true })
    fs.writeFileSync(path.join(npmDsh, 'package.json'), npmManifest)
    fs.writeFileSync(path.join(npmDsh, 'node_modules', 'dep', 'index.js'), Buffer.alloc(5120, 0x54))
    try {
      fs.symlinkSync(
        path.join(npmDsh, 'node_modules', 'dep'),
        path.join(dshHome, 'profiles', 'desktop', 'node_modules', 'dsh-from-npm'),
        'junction'
      )
      npmLinkCreated = true
    } catch { /* junction unsupported here */ }
  })

  const areaOptions = () => ({
    ...baseOptions(),
    appRoot,
    appRootSource: 'execPath',
    npmGlobalDsh: npmDsh,
    chromiumDir,
    pnpmStore
  })

  it('reports each area with its own total, and keeps the headline on the data area', async () => {
    const result = await scan(areaOptions())
    assert.deepEqual(result.areas.map((area) => area.id), ['data', 'app', 'cache'])
    const data = result.areas.find((area) => area.id === 'data')
    assert.equal(data.totals.bytes, result.totals.bytes, 'the headline number is the data area')
    // The application area is both installations: the packed app and npm's global copy.
    assert.equal(result.areas.find((area) => area.id === 'app').totals.bytes, appBytes + npmBytes)
    assert.equal(result.areas.find((area) => area.id === 'cache').totals.bytes, chromiumBytes + storeBytes)
    // The data area is exactly its own categories — never plus the other two.
    assert.equal(data.totals.bytes, result.categories
      .filter((category) => category.area === 'data')
      .reduce((sum, category) => sum + category.bytes, 0))
  })

  it('names a second DSH installation as part of the application area', async () => {
    const result = await scan(areaOptions())
    const npm = result.categories.find((category) => category.id === 'npm-global-dsh')
    assert.equal(npm.area, 'app')
    assert.equal(npm.bytes, npmBytes)
    assert.equal(npm.safety, 'keep', 'a second installation is never offered up for removal')
    assert.ok(npm.roots.some((root) => pathKey(root) === pathKey(npmDsh)))
    assert.match(result.areas.find((area) => area.id === 'app').notes.join('\n'), /npm 全局安装/)

    const withoutNpm = await scan({ ...areaOptions(), npmGlobalDsh: null })
    assert.equal(withoutNpm.categories.find((category) => category.id === 'npm-global-dsh').bytes, 0)
    assert.match(withoutNpm.areas.find((area) => area.id === 'app').notes.join('\n'), /安装位置/)
  })

  it('does not list a link whose target a scanned root already counts', async () => {
    if (!npmLinkCreated) return
    const result = await scan(areaOptions())
    // The link's bytes are counted under the application area, so an entry claiming
    // they are "not in any figure" would be false — but staying silent is not an
    // option either, so the count is reported in words.
    assert.equal(result.linkInstalls.some((link) => link.path.endsWith('dsh-from-npm')), false)
    assert.ok(result.warnings.some((warning) => warning.includes('目标本身就在扫描范围内')))
    // The user's own plugin, whose target is outside every root, is still listed.
    assert.ok(result.linkInstalls.every((link) => !link.target.startsWith(path.join(fixtureRoot, 'npm-global'))))
  })

  it('tags every category with the area it belongs to', async () => {
    const result = await scan(areaOptions())
    for (const category of result.categories) {
      assert.ok(['data', 'app', 'cache'].includes(category.area), `${category.id} names its area`)
    }
    assert.equal(result.categories.find((category) => category.id === 'app-install').area, 'app')
    assert.equal(result.categories.find((category) => category.id === 'pnpm-store').area, 'cache')
    // The catch-all stays inside the data folder: it must never swallow the machine.
    assert.equal(result.categories.find((category) => category.id === 'other').area, 'data')
  })

  it('says where each area lives, and what it could not find', async () => {
    const found = await scan(areaOptions())
    assert.match(found.areas.find((area) => area.id === 'app').notes.join('\n'), /自动找到/)
    assert.match(found.areas.find((area) => area.id === 'cache').notes.join('\n'), /不能相加/)

    const missing = await scan(baseOptions())
    const app = missing.areas.find((area) => area.id === 'app')
    assert.equal(app.totals.bytes, 0)
    assert.match(app.notes.join('\n'), /没能自动找到程序安装位置/)
    assert.match(missing.areas.find((area) => area.id === 'cache').notes.join('\n'), /没有找到/)
  })

  it('credits a manual appDir override as such', async () => {
    const result = await scan({ ...areaOptions(), appRootSource: 'config' })
    assert.match(result.areas.find((area) => area.id === 'app').notes.join('\n'), /来自设置/)
  })

  it('measures how much of the pnpm store is the same physical file as node_modules', async () => {
    const result = await scan(areaOptions())
    const store = result.categories.find((category) => category.id === 'pnpm-store')
    if (!hardLinkCreated) {
      assert.equal(store.overlapBytes, 0, 'without hard links there is nothing shared')
      return
    }
    assert.equal(store.overlapBytes, storeBytes, 'the shared file is recognised by inode, not by path')
    // The overlap is disclosed, never subtracted: the store still reports what it holds.
    assert.equal(store.bytes, storeBytes)
    assert.match(result.areas.find((area) => area.id === 'cache').notes.join('\n'), /同一批物理文件/)
  })

  it('scans only the requested categories, and only their area', async () => {
    const result = await scan({ ...areaOptions(), only: ['pnpm-store'] })
    assert.deepEqual(result.areas.map((area) => area.id), ['cache'])
    assert.equal(result.totals.bytes, 0, 'the headline stays the data area, which was not scanned')
  })

  it('renders one block per area in both documents', async () => {
    const result = await scan(areaOptions())
    const summary = renderSummary(result)
    // The data area's figure is the headline; the other two get their own block.
    assert.ok(summary.includes('### DSH 空间体检 — DSH 数据'))
    assert.ok(summary.includes('**DSH 程序 — '))
    assert.ok(summary.includes('**系统缓存 — '))
    const file = renderMarkdownFile(result, { dshHome, generatedAt: new Date('2026-10-06T12:30:00.000Z') })
    assert.ok(file.includes('## DSH 数据'))
    assert.ok(file.includes('## DSH 程序'))
    assert.ok(file.includes('## 系统缓存'))
    assert.ok(file.includes('不能相加'))
  })

  it('carries the areas into the JSON document without merging them', async () => {
    const result = await scan(areaOptions())
    const json = toJsonReport(result, {
      dshHome,
      generatedAt: new Date('2026-10-06T12:30:00.000Z'),
      capabilities: { openFolder: true, openFolderSensitive: false }
    })
    assert.deepEqual(json.areas.map((area) => area.id), ['data', 'app', 'cache'])
    assert.equal(json.areas.find((area) => area.id === 'app').bytes, appBytes + npmBytes)
    assert.deepEqual(json.capabilities, { openFolder: true, openFolderSensitive: false, cleanup: false })
    for (const area of json.areas) assert.ok(Array.isArray(area.notes) && area.notes.length > 0)
    for (const category of json.categories) assert.ok(Number.isInteger(category.overlapBytes))
  })
})

describe('linked installations', () => {
  let linkTarget = 0

  before(() => {
    const target = path.join(fixtureRoot, 'linked-plugin')
    try {
      fs.mkdirSync(target, { recursive: true })
      fs.writeFileSync(path.join(target, 'index.js'), Buffer.alloc(2048, 0x61))
      linkTarget = 2048
      fs.symlinkSync(
        target,
        path.join(dshHome, 'profiles', 'desktop', 'node_modules', 'dsh-linked'),
        'junction'
      )
    } catch {
      // Junction creation can be refused; the assertions below then have nothing to say.
      linkTarget = 0
    }
  })

  it('lists a junction-installed plugin with its real size, and keeps it out of the totals', async () => {
    if (linkTarget === 0) return
    const result = await scan(baseOptions())
    const entry = result.linkInstalls.find((link) => link.path.endsWith('dsh-linked'))
    assert.ok(entry !== undefined, 'a linked plugin is listed instead of vanishing')
    assert.equal(entry.bytes, linkTarget)
    assert.equal(pathKey(entry.target), pathKey(path.join(fixtureRoot, 'linked-plugin')))
    assert.equal(entry.categoryId, 'profile-deps')
    assert.equal(entry.truncated, false)
    // Listing it must not move a single byte into the totals.
    assert.equal(result.totals.bytes, oracle.bytes + spillBytes)
    assert.ok(result.warnings.some((warning) => warning.includes('链接安装')))
    const pluginDeps = result.categories.find((category) => category.id === 'profile-deps')
    assert.equal(pluginDeps.linkedItems >= 1, true, 'the category still reports that it skipped a link')
  })

  it('renders the list as information, not as part of the total', async () => {
    if (linkTarget === 0) return
    const result = await scan(baseOptions())
    const summary = renderSummary(result)
    assert.ok(summary.includes('链接安装（真实文件在扫描范围之外，不计入上面的数字）'))
    assert.ok(summary.includes('linked-plugin'))
  })

  it('does not let a farm of junctions crowd out the profile\'s own plugins', async () => {
    if (linkTarget === 0) return
    // A shared `profiles/node_modules` is a farm of links into the global npm tree, and
    // it can hold hundreds of them. The plugin the *user* installed as a link lives in
    // the profile's own `node_modules`, and must still be the one that gets measured.
    const farmRoot = path.join(dshHome, 'profiles', 'node_modules')
    const farmTargets = []
    try {
      for (let index = 0; index < 9; index++) {
        const target = path.join(fixtureRoot, `farm-${index}`)
        fs.mkdirSync(target, { recursive: true })
        fs.writeFileSync(path.join(target, 'index.js'), Buffer.alloc(64, 0x62))
        farmTargets.push(target)
        fs.symlinkSync(target, path.join(farmRoot, `farm-${index}`), 'junction')
      }
    } catch {
      return
    }
    const result = await scan(baseOptions())
    const own = result.linkInstalls.find((link) => link.path.endsWith('dsh-linked'))
    assert.ok(own !== undefined, 'the profile\'s own linked plugin is still measured')
    const farm = result.linkInstalls.filter((link) => /farm-\d$/.test(link.path))
    assert.ok(farm.length <= 6, `one root contributes at most its share, got ${farm.length}`)
    assert.equal(result.totals.bytes, oracle.bytes + spillBytes, 'and no figure moved')
  })
})

describe('cleanup preview', () => {
  /** Every path under `roots`, with size and mtime: the fingerprint of "nothing moved". */
  function fingerprint (roots) {
    const seen = []
    const walk = (dir) => {
      let entries
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        const abs = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          seen.push(`dir ${abs}`)
          walk(abs)
        } else {
          const stat = fs.statSync(abs)
          seen.push(`file ${abs} ${stat.size} ${stat.mtimeMs}`)
        }
      }
    }
    for (const root of roots) {
      seen.push(`root ${root}`)
      walk(root)
    }
    return seen.sort()
  }

  const previewOptions = () => ({ dshHome, tempDir })
  /**
   * A clock two hours ahead of the fixtures.
   *
   * The preview refuses to plan anything touched in the last hour, which is exactly what
   * the freshly written fixture is. Rather than reaching into the fixture's mtimes, the
   * tests that are about *eligibility* simply look at it from later on; the test below
   * uses the real clock to pin the rule itself.
   */
  const aged = () => new Date(Date.now() + 2 * RECENT_USE_MS)

  it('enumerates only the safe categories, and refuses the other two tiers by name', async () => {
    const plan = await planCleanup({ ...previewOptions(), now: aged() })
    const eligible = cleanableCategories()
    assert.deepEqual(plan.eligible, eligible.ids)
    assert.ok(eligible.ids.length > 0)
    for (const id of eligible.ids) {
      const def = CATEGORY_DEFS.find((entry) => entry.id === id)
      assert.equal(def.safety, 'safe', `${id} is a green category`)
    }
    assert.ok(plan.items.length > 0, 'the fixture has safely cleanable content')
    for (const item of plan.items) {
      assert.ok(eligible.ids.includes(item.categoryId), `${item.categoryId} may take part`)
      assert.equal(typeof item.path, 'string')
      assert.ok(Number.isFinite(item.bytes))
    }
    // The tiers that must never take part are stated, not merely absent.
    const refused = plan.refused.map((entry) => entry.id)
    assert.ok(refused.includes('profile-deps'), 'the plugins tier is refused on the record')
    assert.ok(refused.includes('sessions'), 'and so are the conversations')
    for (const entry of plan.refused) assert.notEqual(entry.safety, 'safe')

    // What it plans is exactly what the safe categories hold — no more, no less.
    const scanOfSafe = await scan({ ...previewOptions(), only: eligible.ids, topN: 50 })
    assert.equal(plan.totalBytes, scanOfSafe.categories.reduce((sum, category) => sum + category.bytes, 0))
    assert.ok(plan.items.some((item) => item.path.endsWith(path.join('plugin-packages', 'foo.tgz'))),
      'a downloaded package is on the list')
    assert.ok(plan.destination.startsWith(path.join(dshHome, 'disk-doctor', 'quarantine')))
    assert.equal(plan.dryRun, true)
  })

  it('leaves anything touched in the last hour out of the plan', async () => {
    // The fixture was written moments ago, which is what a live spill directory looks
    // like. Moving one out from under a running process is not a cleanup.
    const plan = await planCleanup(previewOptions())
    assert.equal(plan.totalBytes, 0, 'nothing fresh is planned')
    assert.deepEqual(plan.items, [])
    assert.ok(plan.skipped.length > 0, 'but it is reported instead of vanishing')
    assert.ok(plan.skipped.every((entry) => entry.reason === 'recent'))
    assert.ok(plan.skippedBytes > 0)
    assert.ok(plan.warnings.some((warning) => warning.includes('最近 1 小时内')))
    assert.ok(plan.warnings.some((warning) => warning.includes('还在改动')))
  })

  it('moves nothing, creates nothing and rewrites nothing', async () => {
    const before = fingerprint([dshHome, tempDir])
    const plan = await planCleanup(previewOptions())
    await planCleanup({ ...previewOptions(), now: aged() })
    const after = fingerprint([dshHome, tempDir])
    assert.deepEqual(after, before, 'the preview left the filesystem byte-for-byte identical')
    assert.equal(fs.existsSync(path.join(dshHome, 'disk-doctor')), false,
      'not even the quarantine folder was created')
    assert.ok(plan.dryRun, 'and it still had something to say')
  })

  it('says in words that this is a preview, what it refuses to touch, and why the number is small', async () => {
    const plan = await planCleanup({ ...previewOptions(), now: aged() })
    const joined = plan.warnings.join('\n')
    assert.match(joined, /预演/)
    assert.match(joined, /没有移动|不会移动/)
    assert.match(joined, /一律不参与/)
    assert.match(joined, /插件本体/, 'the tiers holding the gigabytes are named as out of scope')
    assert.match(joined, /重新生成/)
  })

  it('is honestly empty when there is nothing safely cleanable', async () => {
    const emptyHome = path.join(fixtureRoot, 'empty-home')
    const emptyTemp = path.join(fixtureRoot, 'empty-temp')
    fs.mkdirSync(emptyHome, { recursive: true })
    fs.mkdirSync(emptyTemp, { recursive: true })
    const plan = await planCleanup({ dshHome: emptyHome, tempDir: emptyTemp })
    assert.equal(plan.totalBytes, 0)
    assert.deepEqual(plan.items, [])
    assert.ok(plan.warnings.some((warning) => warning.includes('没有')))
  })

  it('names the folder it would use, and never reuses a timestamp', () => {
    const first = quarantineDirectory(dshHome, new Date('2026-10-07T10:20:30'))
    assert.equal(first, path.join(dshHome, 'disk-doctor', 'quarantine', '20261007-102030'))
    const second = quarantineDirectory(dshHome, new Date('2026-10-07T10:20:31'))
    assert.notEqual(first, second, 'each run would get its own folder')
  })

  it('admits when a category has more items than the preview lists', async () => {
    const crowded = path.join(fixtureRoot, 'crowded-home')
    fs.mkdirSync(path.join(crowded, 'plugin-packages'), { recursive: true })
    for (let index = 0; index <= PREVIEW_ITEM_LIMIT; index++) {
      fs.writeFileSync(path.join(crowded, 'plugin-packages', `pkg-${index}.tgz`), '')
    }
    const plan = await planCleanup({
      dshHome: crowded,
      tempDir: path.join(fixtureRoot, 'empty-temp'),
      now: aged()
    })
    assert.equal(plan.truncated, true, 'the ceiling is reported rather than silently applied')
    assert.equal(plan.items.length, PREVIEW_ITEM_LIMIT)
    assert.ok(plan.warnings.some((warning) => warning.includes('没有列全')))
  })
})

describe('cleanup: the move and the undo', () => {
  /**
   * A throwaway data folder with one cleanable item in each green category, plus one item
   * in each refused tier. Every test builds its own, so a test that moves files cannot
   * affect the next one, and a failure here can never be blamed on test order.
   */
  function makeFixture () {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-disk-doctor-move-'))
    const home = path.join(root, '.dsh')
    const temp = path.join(root, 'temp')
    const put = (base, relative, size) => {
      const abs = path.join(base, relative)
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.writeFileSync(abs, Buffer.alloc(size, 0x41))
      return abs
    }
    put(home, path.join('plugin-packages', 'foo.tgz'), 2000)
    put(home, path.join('profiles', 'desktop', '.dsh-market', 'state.json'), 400)
    put(home, path.join('profiles', 'desktop', '.plugin-manager', 'logs', 'operation-1', 'pnpm.log'), 100)
    put(temp, path.join('dsh-spill-aaa', 'x.bin'), 300)
    const session = put(home, path.join('sessions', '--E-demo--', 'session-a', 'session.jsonl.zstd'), 500)
    const plugin = put(home, path.join('profiles', 'desktop', 'node_modules', 'dsh-pet', 'index.js'), 700)
    return { root, home, temp, session, plugin }
  }

  /** Every path under `roots`, ignoring the plugin's own folder (where the quarantine lives). */
  function fingerprint (roots, ignore) {
    const lines = []
    const walk = (dir) => {
      let entries
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        const abs = path.join(dir, entry.name)
        if (ignore !== undefined && isUnder(abs, ignore)) continue
        if (entry.isDirectory()) {
          lines.push(`dir ${abs}`)
          walk(abs)
        } else {
          const stat = fs.statSync(abs)
          lines.push(`file ${abs} ${stat.size} ${stat.mtimeMs}`)
        }
      }
    }
    for (const root of roots) {
      if (ignore !== undefined && isUnder(root, ignore)) continue
      lines.push(`root ${root}`)
      walk(root)
    }
    return lines.sort()
  }

  /** Two hours on, so the freshly written fixture is eligible rather than "in use". */
  const aged = () => new Date(Date.now() + 2 * RECENT_USE_MS)
  const optionsFor = (fixture, now = aged()) => ({ dshHome: fixture.home, tempDir: fixture.temp, now })
  /** The plugin's own folder, which the quarantine lives inside. */
  const pluginFolder = (fixture) => path.join(fixture.home, 'disk-doctor')

  /** Run one case against its own fixture and clean the whole thing up afterwards. */
  async function withFixture (body) {
    const fixture = makeFixture()
    try {
      return await body(fixture)
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true })
    }
  }

  it('moves exactly what the preview listed, and records every move in a manifest', async () => {
    await withFixture(async (fixture) => {
      const before = fingerprint([fixture.home, fixture.temp], pluginFolder(fixture))
      const plan = await planCleanup(optionsFor(fixture))
      assert.equal(plan.items.length, 4, 'one item per green category')

      const batch = await performCleanup(optionsFor(fixture))
      assert.deepEqual(batch.failures, [])
      assert.deepEqual(batch.items.map((item) => item.original).sort(),
        plan.items.map((item) => item.path).sort(), 'every planned item moved, and only those')
      assert.equal(batch.bytes, plan.totalBytes)

      for (const item of batch.items) {
        assert.equal(fs.existsSync(item.original), false, `${item.original} is no longer in place`)
        assert.equal(fs.existsSync(item.target), true, `${item.target} holds it instead`)
        assert.ok(isUnder(item.target, path.join(quarantineRoot(fixture.home), batch.id)),
          'the copy lives inside the batch')
        assert.ok(item.target.includes(path.join(batch.id, item.categoryId)),
          'kept under its category, with the original layout below that')
      }
      const byCategory = Object.fromEntries(batch.items.map((item) => [item.categoryId, item.target]))
      const endsWith = (value, tail) => value.toLowerCase().endsWith(path.join(...tail).toLowerCase())
      assert.ok(endsWith(byCategory['plugin-cache'], ['plugin-cache', 'foo.tgz']),
        'a file keeps its name and its place in the category')
      assert.ok(endsWith(byCategory['profile-market'], ['profile-market', '.dsh-market']),
        'a whole-folder item lands under its own name')

      const manifest = readManifest(fixture.home, batch.id)
      assert.equal(manifest.status, 'moved')
      assert.deepEqual(manifest.items.map((item) => item.original).sort(),
        batch.items.map((item) => item.original).sort())
      assert.ok(fs.existsSync(batch.manifestPath), 'the manifest is on disk beside the data')

      // Nothing else may have budged: the removals are exactly the moved items, and
      // nothing at all appeared outside the plugin's own folder.
      const after = fingerprint([fixture.home, fixture.temp], pluginFolder(fixture))
      assert.deepEqual(after.filter((line) => !before.includes(line)), [], 'nothing appeared outside')
      const removed = before.filter((line) => !after.includes(line))
      assert.ok(removed.length > 0, 'and something really did move')
      for (const line of removed) {
        // `file <path> <size> <mtime>` — the mtime can be fractional, so trim both numbers.
        const target = line.replace(/^(dir|file|root) /, '').replace(/ \d+ [\d.]+$/, '')
        assert.ok(batch.items.some((item) => pathKey(item.original) === pathKey(target) ||
          isUnder(target, item.original)), `only moved items disappeared: ${line}`)
      }
      assert.equal(fs.existsSync(fixture.session), true, 'conversations stay put')
      assert.equal(fs.existsSync(fixture.plugin), true, 'and so do the plugins')
    })
  })

  it('never touches the tiers that are refused', async () => {
    await withFixture(async (fixture) => {
      assert.equal(fs.existsSync(fixture.session), true)
      assert.equal(fs.existsSync(fixture.plugin), true)
      const batch = await performCleanup(optionsFor(fixture))
      assert.ok(batch.items.length > 0, 'something was eligible, so the move did happen')
      assert.equal(fs.existsSync(fixture.session), true, 'conversations stay put')
      assert.equal(fs.existsSync(fixture.plugin), true, 'and so do the plugins')
    })
  })

  it('moves nothing at all when every candidate is too fresh', async () => {
    await withFixture(async (fixture) => {
      const before = fingerprint([fixture.home, fixture.temp], pluginFolder(fixture))
      // The real clock: this fixture was written moments ago, which is what a live spill
      // directory looks like. The preview refuses it, and the move must follow the preview.
      const batch = await performCleanup({ dshHome: fixture.home, tempDir: fixture.temp })
      assert.deepEqual(batch.items, [])
      assert.ok(batch.skippedRecent.length > 0)
      assert.equal(fs.existsSync(quarantineRoot(fixture.home)), false, 'not even a batch folder is created')
      assert.deepEqual(fingerprint([fixture.home, fixture.temp], pluginFolder(fixture)), before)
    })
  })

  it('lists its batches newest first', async () => {
    await withFixture(async (fixture) => {
      const first = await performCleanup(optionsFor(fixture))
      // Something new to clean, so the second run has a batch of its own.
      fs.writeFileSync(path.join(fixture.home, 'plugin-packages', 'second.tgz'), Buffer.alloc(50, 0x42))
      const second = await performCleanup({ ...optionsFor(fixture), now: new Date(Date.now() + 3 * RECENT_USE_MS) })
      assert.notEqual(first.id, second.id, 'each run gets its own folder')
      assert.equal(second.items.length, 1)
      const batches = listQuarantine(fixture.home)
      assert.deepEqual(batches.map((entry) => entry.id), [second.id, first.id], 'newest first')
      assert.equal(batches[0].itemCount, second.items.length)
      assert.equal(batches[0].bytes, second.bytes)
      assert.equal(batches[0].status, 'moved')
    })
  })

  it('gives two runs in the same second their own batch, so no move goes unrecorded', async () => {
    await withFixture(async (fixture) => {
      const sameInstant = aged()
      const first = await performCleanup(optionsFor(fixture, sameInstant))
      assert.ok(first.items.length > 0)
      // Fresh content for the second run, and the *same* clock: without a distinct folder
      // the second manifest would overwrite the first, stranding the first run's files.
      fs.writeFileSync(path.join(fixture.home, 'plugin-packages', 'again.tgz'), Buffer.alloc(60, 0x43))
      const second = await performCleanup(optionsFor(fixture, sameInstant))
      assert.notEqual(second.id, first.id)
      assert.match(second.id, /^\d{8}-\d{6}-\d+$/, 'the second one is a suffixed variant')
      assert.equal(second.items.length, 1)

      // Both records survive, so both runs can be undone.
      const ids = listQuarantine(fixture.home).map((entry) => entry.id).sort()
      assert.deepEqual(ids, [first.id, second.id].sort())
      assert.equal(readManifest(fixture.home, first.id).items.length, first.items.length)
      assert.equal(readManifest(fixture.home, second.id).items.length, 1)
      for (const id of ids) {
        const undo = undoCleanup({ dshHome: fixture.home, tempDir: fixture.temp, id })
        assert.equal(undo.ok, true, `batch ${id} can be undone`)
      }
      assert.equal(fs.existsSync(path.join(fixture.home, 'plugin-packages', 'again.tgz')), true)
    })
  })

  it('undone: everything goes back exactly where it came from', async () => {
    await withFixture(async (fixture) => {
      const before = fingerprint([fixture.home, fixture.temp], pluginFolder(fixture))
      const batch = await performCleanup(optionsFor(fixture))
      assert.equal(batch.items.length, 4, 'the whole plan moved')

      const undo = undoCleanup({ dshHome: fixture.home, tempDir: fixture.temp, id: batch.id })
      assert.equal(undo.ok, true)
      assert.deepEqual(undo.failures, [])
      assert.equal(undo.restored.length, batch.items.length)
      assert.equal(undo.restoredBytes, batch.bytes)
      assert.deepEqual(fingerprint([fixture.home, fixture.temp], pluginFolder(fixture)), before,
        'the world outside the plugin folder is identical again')
      assert.equal(readManifest(fixture.home, batch.id).status, 'undone')

      const again = undoCleanup({ dshHome: fixture.home, tempDir: fixture.temp, id: batch.id })
      assert.equal(again.ok, false)
      assert.equal(again.reason, 'already-undone', 'a second undo is refused, not repeated')
    })
  })

  it('refuses to put something back on top of a file that has since appeared', async () => {
    await withFixture(async (fixture) => {
      const batch = await performCleanup(optionsFor(fixture))
      const victim = batch.items[0]
      fs.mkdirSync(path.dirname(victim.original), { recursive: true })
      fs.writeFileSync(victim.original, 'new occupant')

      const undo = undoCleanup({ dshHome: fixture.home, tempDir: fixture.temp, id: batch.id })
      assert.equal(undo.ok, false)
      assert.ok(undo.failures.some((entry) => entry.reason === 'occupied'))
      assert.equal(fs.readFileSync(victim.original, 'utf8'), 'new occupant', 'nothing was overwritten')
      assert.equal(fs.existsSync(victim.target), true, 'and the quarantined copy is still there')
      assert.equal(undo.restored.length, batch.items.length - 1, 'the rest went back')
    })
  })

  it('cannot be talked into moving anything outside the quarantine or the safe roots', async () => {
    await withFixture(async (fixture) => {
      const batch = await performCleanup(optionsFor(fixture))
      const batchDir = path.join(quarantineRoot(fixture.home), batch.id)
      // A hand-edited manifest: one row aims outside the batch, one aims outside every root.
      const outside = path.join(fixture.root, 'not-mine.txt')
      fs.writeFileSync(outside, 'keep me')
      const insideBatch = path.join(batchDir, 'plugin-cache', 'x.tgz')
      fs.mkdirSync(path.dirname(insideBatch), { recursive: true })
      fs.writeFileSync(insideBatch, 'x')
      fs.writeFileSync(path.join(batchDir, 'manifest.json'), JSON.stringify({
        schema: 'dsh-disk-doctor/quarantine@1',
        id: batch.id,
        createdAt: new Date().toISOString(),
        status: 'moved',
        bytes: 0,
        files: 0,
        items: [
          { categoryId: 'plugin-cache', original: path.join(fixture.home, 'plugin-packages', 'x.tgz'), target: outside, bytes: 1, files: 1 },
          { categoryId: 'plugin-cache', original: path.join(fixture.root, 'elsewhere.txt'), target: insideBatch, bytes: 1, files: 1 }
        ],
        skippedRecent: [],
        failures: []
      }))

      const undo = undoCleanup({ dshHome: fixture.home, tempDir: fixture.temp, id: batch.id })
      assert.equal(undo.ok, false)
      assert.deepEqual(undo.restored, [])
      const reasons = undo.failures.map((entry) => entry.reason)
      assert.ok(reasons.includes('target-outside-batch'), 'a target outside the batch is refused')
      assert.ok(reasons.includes('original-outside-roots'), 'so is an original outside every root')
      assert.equal(fs.readFileSync(outside, 'utf8'), 'keep me', 'the file outside was never touched')
    })
  })

  it('ignores a batch id that is not a timestamp, and folders that are not batches', async () => {
    await withFixture(async (fixture) => {
      fs.mkdirSync(path.join(quarantineRoot(fixture.home), 'not-a-batch'), { recursive: true })
      assert.equal(readManifest(fixture.home, '../../etc'), null, 'a traversing id reads nothing')
      assert.equal(readManifest(fixture.home, 'not-a-batch'), null)
      assert.equal(undoCleanup({ dshHome: fixture.home, tempDir: fixture.temp, id: 'not-a-batch' }).reason, 'no-manifest')
      const batch = await performCleanup(optionsFor(fixture))
      assert.deepEqual(listQuarantine(fixture.home).map((entry) => entry.id), [batch.id],
        'only timestamp folders count as batches')
    })
  })
})