/**
 * Location rules: the data folder, the application install folder, and the two
 * system caches. Every filesystem probe is injected, so these tests describe the
 * rules rather than the machine they run on.
 */

import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'

import {
  detectAppRoot,
  detectChromiumDataDir,
  detectNpmGlobalDsh,
  detectPnpmStore,
  expandHome,
  looksLikeAppRoot,
  resolveDshHome
} from '../lib/locate.js'

/** A world where only the listed paths exist. */
function world ({ files = [], dirs = [] } = {}) {
  const fileSet = new Set(files.map((p) => path.resolve(p)))
  const dirSet = new Set(dirs.map((p) => path.resolve(p)))
  return {
    isFile: (p) => fileSet.has(path.resolve(p)),
    isDirectory: (p) => dirSet.has(path.resolve(p))
  }
}

describe('the DSH data folder', () => {
  it('prefers $DSH_HOME over the home directory', () => {
    assert.equal(resolveDshHome({ DSH_HOME: 'D:\\data\\dsh' }, 'C:\\Users\\me'), 'D:\\data\\dsh')
  })

  it('falls back to ~/.dsh when $DSH_HOME is unset, empty or blank', () => {
    for (const env of [{}, { DSH_HOME: '' }, { DSH_HOME: '   ' }, { DSH_HOME: 7 }]) {
      assert.equal(resolveDshHome(env, 'C:\\Users\\me'), path.join('C:\\Users\\me', '.dsh'))
    }
  })

  it('expands a tilde exactly the way DSH documents', () => {
    assert.equal(resolveDshHome({ DSH_HOME: '~' }, 'C:\\Users\\me'), 'C:\\Users\\me')
    assert.equal(resolveDshHome({ DSH_HOME: '~/dsh' }, 'C:\\Users\\me'), path.join('C:\\Users\\me', 'dsh'))
    assert.equal(resolveDshHome({ DSH_HOME: '~\\dsh' }, 'C:\\Users\\me'), path.join('C:\\Users\\me', 'dsh'))
    // Only the current user's home can be resolved, so `~name` stays verbatim.
    assert.equal(expandHome('~alice/dsh', 'C:\\Users\\me'), '~alice/dsh')
  })

  it('tolerates a missing environment object', () => {
    assert.equal(resolveDshHome(null, 'C:\\Users\\me'), path.join('C:\\Users\\me', '.dsh'))
  })
})

describe('the application install folder', () => {
  const root = path.join('E:', 'dsh1')
  const markers = { isFile: (p) => path.resolve(p) === path.resolve(path.join(root, 'resources', 'app.asar')) }

  it('accepts only a folder that really holds the packed application', () => {
    assert.equal(looksLikeAppRoot(root, markers), true)
    assert.equal(looksLikeAppRoot(path.join('C:', 'random'), markers), false)
    assert.equal(looksLikeAppRoot('', markers), false)
    // With no injected probe the rule reads the real filesystem, and this machine
    // has no packed application at that made-up path.
    assert.equal(looksLikeAppRoot(path.join('C:', 'no-such-app-46c1'), {}), false)
  })

  it('finds the folder from the running executable', () => {
    const found = detectAppRoot({
      env: {},
      execPath: path.join(root, 'DeepSeek Harness.exe'),
      resourcesPath: undefined,
      ...markers
    })
    assert.deepEqual(found, { path: root, source: 'execPath' })
  })

  it('falls back from resourcesPath to the executable', () => {
    const viaResources = detectAppRoot({
      env: {},
      execPath: path.join('C:', 'elsewhere', 'node.exe'),
      resourcesPath: path.join(root, 'resources'),
      ...markers
    })
    assert.deepEqual(viaResources, { path: root, source: 'resourcesPath' })
  })

  it('returns null for a headless deployment running a plain node', () => {
    assert.equal(detectAppRoot({
      env: { DSH_DESKTOP_NODE_EXECUTABLE: path.join('C:', 'nodejs', 'node.exe') },
      execPath: path.join('C:', 'nodejs', 'node.exe'),
      resourcesPath: undefined,
      ...markers
    }), null)
  })

  it('resolves a macOS bundle to the .app folder', () => {
    const bundle = path.join('/', 'Applications', 'DeepSeek Harness.app')
    const probe = { isFile: (p) => path.resolve(p) === path.resolve(path.join(bundle, 'Contents', 'Resources', 'app.asar')) }
    assert.deepEqual(detectAppRoot({
      env: {},
      execPath: path.join(bundle, 'Contents', 'MacOS', 'DeepSeek Harness'),
      resourcesPath: undefined,
      ...probe
    }), { path: bundle, source: 'execPath' })
  })

  it('takes the launcher-exported executable path into account', () => {
    assert.deepEqual(detectAppRoot({
      env: { DSH_DESKTOP_NODE_EXECUTABLE: path.join(root, 'DeepSeek Harness.exe') },
      execPath: path.join('C:', 'nodejs', 'node.exe'),
      resourcesPath: undefined,
      ...markers
    }), { path: root, source: 'DSH_DESKTOP_NODE_EXECUTABLE' })
  })
})

describe('the system caches', () => {
  it('finds the Chromium profile under APPDATA', () => {
    const appData = path.join('C:', 'Users', 'me', 'AppData', 'Roaming')
    const target = path.join(appData, '@deepseek-ai', 'dsh-desktop')
    assert.equal(detectChromiumDataDir({
      env: { APPDATA: appData },
      home: path.join('C:', 'Users', 'me'),
      ...world({ dirs: [target] })
    }), target)
  })

  it('finds the Chromium profile on Linux and macOS too', () => {
    const home = path.join('/', 'home', 'me')
    const linux = path.join(home, '.config', '@deepseek-ai', 'dsh-desktop')
    assert.equal(detectChromiumDataDir({ env: {}, home, ...world({ dirs: [linux] }) }), linux)
    const mac = path.join(home, 'Library', 'Application Support', '@deepseek-ai', 'dsh-desktop')
    assert.equal(detectChromiumDataDir({ env: {}, home, ...world({ dirs: [mac] }) }), mac)
  })

  it('reports no Chromium profile when none exists', () => {
    assert.equal(detectChromiumDataDir({ env: {}, home: path.join('C:', 'Users', 'me'), ...world() }), null)
  })

  it('prefers the environment-declared pnpm store', () => {
    const declared = path.join('D:', 'pnpm-home')
    assert.equal(detectPnpmStore({
      env: { PNPM_HOME: declared, LOCALAPPDATA: path.join('C:', 'Users', 'me', 'AppData', 'Local') },
      home: path.join('C:', 'Users', 'me'),
      ...world({ dirs: [declared] })
    }), declared)
  })

  it('falls back to the platform default pnpm store, then to none', () => {
    const local = path.join('C:', 'Users', 'me', 'AppData', 'Local', 'pnpm')
    assert.equal(detectPnpmStore({
      env: { LOCALAPPDATA: path.join('C:', 'Users', 'me', 'AppData', 'Local') },
      home: path.join('C:', 'Users', 'me'),
      ...world({ dirs: [local] })
    }), local)
    assert.equal(detectPnpmStore({ env: {}, home: os.homedir(), ...world() }), null)
  })
})

describe('the second DSH installation', () => {
  const npmRoot = path.join('C:', 'Users', 'me', 'AppData', 'Roaming', 'npm', 'node_modules')
  const pkg = path.join(npmRoot, '@deepseek-ai', 'dsh')
  const probes = world({ dirs: [pkg], files: [path.join(pkg, 'package.json')] })

  it('finds the npm global install, which the desktop app does not own', () => {
    assert.equal(detectNpmGlobalDsh({
      env: { APPDATA: path.join('C:', 'Users', 'me', 'AppData', 'Roaming') },
      home: path.join('C:', 'Users', 'me'),
      ...probes
    }), pkg)
  })

  it('honours an npm prefix and the usual unix locations', () => {
    const prefix = path.join('D:', 'npm-prefix')
    const viaPrefix = path.join(prefix, 'lib', 'node_modules', '@deepseek-ai', 'dsh')
    assert.equal(detectNpmGlobalDsh({
      env: { npm_config_prefix: prefix },
      home: path.join('C:', 'Users', 'me'),
      ...world({ dirs: [viaPrefix], files: [path.join(viaPrefix, 'package.json')] })
    }), viaPrefix)

    const unix = path.join('/', 'usr', 'local', 'lib', 'node_modules', '@deepseek-ai', 'dsh')
    assert.equal(detectNpmGlobalDsh({
      env: {},
      home: path.join('/', 'home', 'me'),
      ...world({ dirs: [unix], files: [path.join(unix, 'package.json')] })
    }), unix)
  })

  it('requires the package folder to be a real package', () => {
    // A bare directory named `dsh` is not an installation, and must not be scanned.
    assert.equal(detectNpmGlobalDsh({
      env: { APPDATA: path.join('C:', 'Users', 'me', 'AppData', 'Roaming') },
      home: path.join('C:', 'Users', 'me'),
      ...world({ dirs: [pkg] })
    }), null)
    assert.equal(detectNpmGlobalDsh({ env: {}, home: path.join('C:', 'Users', 'me'), ...world() }), null)
  })
})
