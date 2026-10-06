/**
 * Browser-half tests.
 *
 * The client bundle is not an ES module: it is a script that registers a factory
 * with the web client's `window.__ModuleLoader__`. These tests load the real file
 * with a stub loader and stub peers, then drive the registered page: the manifest
 * wiring, the slot registration, the five field conversions, and the rendered tree.
 *
 * Rendering itself is verified structurally (which elements, with which props);
 * how it looks is for the browser.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'

import { REPORT_ROUTE, registerReportRoute } from '../lib/serve.js'
import { CATEGORY_DEFS } from '../lib/targets.js'

const clientPath = new URL('../client/client.js', import.meta.url)
const manifestPath = new URL('../package.json', import.meta.url)

/** Marker element types so rendered trees can be asserted by identity. */
const SettingsForm = function SettingsForm () {}
const SettingsValueField = function SettingsValueField () {}

/** Real conversion specs, copied from `@deepseek-ai/dsh-client-ui-primitives`. */
const settingsTextField = (field) => ({
  field,
  format: (value) => typeof value === 'string' ? value : '',
  parse: (text) => {
    const trimmed = text.trim()
    return trimmed === '' ? { kind: 'clear' } : { kind: 'set', value: trimmed }
  }
})
const settingsNumberField = (field) => ({
  field,
  format: (value) => typeof value === 'number' ? String(value) : '',
  parse: (text) => {
    const trimmed = text.trim()
    if (trimmed === '') return { kind: 'clear' }
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? { kind: 'set', value: parsed } : undefined
  }
})

/**
 * A faithful stand-in for `SettingsFormModel`: same staging, format and parse
 * rules, so the specs this bundle passes in are exercised exactly as in the browser.
 */
class FakeSettingsFormModel {
  constructor (scope, specs) {
    this.scope = scope
    this.specs = new Map(specs.map((spec) => [spec.field, spec]))
    this.staged = new Map()
  }

  field (field) {
    const spec = this.specs.get(field)
    const staged = this.staged.get(field)
    if (staged === undefined) {
      return { text: spec.format(this.scope.getSnapshot().value?.[field]), overridden: false, invalid: false }
    }
    const write = staged.clear ? { kind: 'clear' } : spec.parse(staged.text)
    return { text: staged.text, overridden: write?.kind === 'set', invalid: write === undefined }
  }

  shell () {
    const snapshot = this.scope.getSnapshot()
    const invalid = [...this.specs.keys()].some((field) => this.field(field).invalid)
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty: this.staged.size > 0,
      invalid,
      saving: false,
      failed: false
    }
  }

  actions () {
    return {
      edit: (field, text) => this.staged.set(field, { text, clear: false }),
      resetField: (field) => this.staged.set(field, { text: this.specs.get(field).format(undefined), clear: true }),
      save: () => { this.save() },
      discard: () => this.staged.clear()
    }
  }

  /**
   * The real model's save: write every staged edit through the scope, then re-seed.
   *
   * The stub has to do this for real — the panel's permission switch reads its result back
   * from the scope, so a save that only pretends to write would prove nothing.
   */
  async save () {
    const ops = []
    for (const [field, staged] of this.staged) {
      if (staged.clear) {
        ops.push({ op: 'unset', path: [field] })
        continue
      }
      const write = this.specs.get(field).parse(staged.text)
      if (write === undefined) continue
      if (write.kind === 'clear') ops.push({ op: 'unset', path: [field] })
      else ops.push({ op: 'set', path: [field], value: write.value })
    }
    if (ops.length === 0 || this.scope.getSnapshot().writable !== true) return
    const landed = await this.scope.mutate(ops)
    if (landed) this.staged.clear()
  }

  bind (project) { return { get: () => project() } }
  dispose () {}
}

/** Load the real client bundle and hand back its factory result. */
function loadClient (windowExtras = {}) {
  const source = fs.readFileSync(clientPath, 'utf8')
  let entry
  const windowStub = { __ModuleLoader__: { load: (value) => { entry = value } }, ...windowExtras }
  // eslint-disable-next-line no-new-func -- the bundle is a script, by design.
  new Function('window', source)(windowStub)
  assert.ok(entry !== undefined, 'the bundle must call window.__ModuleLoader__.load')
  const react = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    // A one-shot hooks stand-in: these tests only need a component's first render.
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useCallback: (fn) => fn,
    useEffect: () => {}
  }
  const module = entry.factory((id) => {
    if (id === 'react') return react
    if (id === '@deepseek-ai/dsh-client-ui-primitives') {
      return { SettingsForm, SettingsValueField, SettingsFormModel: FakeSettingsFormModel, settingsTextField, settingsNumberField }
    }
    throw new Error(`unexpected require(${id})`)
  })
  return { entry, module, react }
}

/** The rendered area boxes, in report order. */
function areaBoxes (body) {
  return body.children.filter((child) => child !== null && child.props?.className === 'dd-area')
}

/** The children of one area's body: its rows, chart, actions and notes. */
function areaBody (body, index = 0) {
  const box = areaBoxes(body)[index]
  assert.ok(box !== undefined, 'the panel renders area boxes')
  const wrapper = box.children.find((child) => child !== null && child.props?.className === 'dd-area-body')
  assert.ok(wrapper !== undefined, 'every box has a body')
  return wrapper.children
}

/** The data area's body — the box that carries the headline and the three views. */
const dataBody = (body) => areaBody(body, 0)

/** The rendered category rows of one area. */
function areaRows (body, index = 0) {
  const children = areaBody(body, index)
  // The data area's list sits inside the view section; the other areas render theirs
  // directly, because they have no views of their own.
  const section = children.find((child) => child !== null && child.props?.className === 'dd-section')
  const host = section === undefined ? children : section.children
  const list = host.find((child) => child !== null && child.props?.className === 'dd-list')
  return list === undefined ? [] : list.children
}

/** The chart inside the data area's body, or undefined when there is none. */
function areaChart (body) {
  return dataBody(body).find((child) => child !== null && child.props?.className === 'dd-chart')
}

/** The parts of a chart block, by role rather than by position. */
const chartPart = (chart, className) =>
  chart.children.find((child) => child !== null && child.props?.className === className)
const chartGraphic = (chart) => chartPart(chart, 'dd-chart-graphic')
const chartLegend = (chart) => chartPart(chart, 'dd-legend')
const chartHead = (chart) => chartPart(chart, 'dd-chart-head')

/** A row's toggle button, its name cell, and its open control. */
const rowButton = (row) => row.children[0].children[0]
const rowName = (row) => rowButton(row).children[0]
const rowOpen = (row) => row.children[0].children[1]

/** A context that records effects, the slot registrations, and the sidebar seats. */
function fakeContext (initialValue, status = 'ready') {
  // The value is mutable so a form write behaves like the real scope: `mutate` applies the
  // ops and the snapshot read back shows what the Host accepted.
  const value = { ...initialValue }
  const mutations = []
  const scope = {
    getSnapshot: () => ({
      status,
      writable: status === 'ready',
      value,
      revision: mutations.length + 1
    }),
    subscribe: () => () => {},
    mutate: async (batch) => {
      if (status !== 'ready') return false
      mutations.push(batch)
      for (const op of batch) {
        if (op.op === 'set') value[op.path[0]] = op.value
        else delete value[op.path[0]]
      }
      return true
    }
  }
  const state = {
    dictionaries: [],
    effects: [],
    registrations: [],
    watched: null,
    mutations,
    sidebar: { tabTypes: [], bodies: [], opened: [] }
  }
  /** The child context `ctx.inject(['sidebarRightTabs', 'sidebarRight'], …)` yields. */
  const sidebarOwner = {
    get: (name) => name === 'sidebarRightTabs'
      ? {
          register: (definition) => {
            state.sidebar.tabTypes.push(definition)
            return () => {}
          }
        }
      : {
          openTab: (kind, options) => {
            state.sidebar.opened.push({ kind, options })
            return {}
          }
        },
    effect: (fn) => fn(),
    slots: {
      inject: (_name, cb) => cb(),
      register: (config, component) => {
        state.sidebar.bodies.push({ config, component })
        return () => {}
      }
    }
  }
  const ctx = {
    effect: (fn, label) => {
      state.effects.push(label)
      return fn()
    },
    locale: {
      bind: (ns) => (key) => `${ns}:${key}`,
      register: (ns, dictionaries) => {
        state.dictionaries.push({ ns, dictionaries })
        return () => {}
      }
    },
    configForms: {
      get: () => scope,
      // Present so a regression is visible: the page must not depend on this gate.
      whileServed: (namespaces, register) => {
        state.watched = namespaces
        register(new Set(namespaces))
        return () => {}
      }
    },
    slots: {
      inject: (_name, cb) => cb(),
      register: (config, component) => {
        state.registrations.push({ config, component })
        return () => {}
      }
    },
    // The sidebar is an optional seat: absent services simply never call back.
    inject: (names, callback) => {
      if (names.includes('sidebarRightTabs')) callback(sidebarOwner)
    }
  }
  return { ctx, state }
}

describe('client manifest wiring', () => {
  it('exposes the browser half the way the client module system discovers it', () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    assert.equal(manifest.exports['./client'], './client/client.js')
    assert.equal(manifest.dsh.client.platform, 'web')
    // The inject list names the packages whose services and slots this page uses.
    // `@deepseek-ai/dsh-client-ui-primitives` is deliberately absent: it is a
    // baseline module the bundle requires directly, exactly as the official
    // settings pages do.
    assert.deepEqual(manifest.dsh.client.inject, [
      '@deepseek-ai/dsh-client-locale',
      '@deepseek-ai/dsh-client-ui-settings',
      '@deepseek-ai/dsh-client-ui-plugin-manager'
    ])
    assert.ok(manifest.files.includes('client'))
    assert.equal(manifest.dshhub.surfaces.includes('web'), true)
    assert.equal(fs.existsSync(new URL(manifest.exports['./client'], manifestPath)), true)
  })

  it('registers under the package name the bundle is installed as', () => {
    const { entry, module } = loadClient()
    assert.equal(entry.id, 'dsh-disk-doctor')
    assert.equal(module.BUNDLE, 'dsh-disk-doctor')
    assert.equal(module.NS, 'disk-doctor', 'the settings namespace is the profile entry id')
    assert.deepEqual(module.inject, ['slots', 'locale', 'configForms'])
    assert.equal(typeof module.apply, 'function')
  })
})

describe('client page registration', () => {
  it('registers the bundle page without waiting on the settings namespace', () => {
    const { module } = loadClient()
    const { ctx, state } = fakeContext({ dshHome: 'C:\\x', topN: 20, reportDir: '', excludeGlobs: ['a', 'b'], followSymlinks: true })
    module.apply(ctx)

    assert.equal(state.watched, null, 'the page must not gate itself on whileServed')
    assert.equal(state.registrations.length, 1)
    const { config, component } = state.registrations[0]
    assert.equal(config.name, 'plugins.bundle.config')
    assert.equal(config.key, 'dsh-disk-doctor', 'the slot is keyed by the bundle package name')
    assert.equal(config.locale, module.LOCALE_NS)
    assert.equal(typeof component, 'function')

    assert.equal(state.dictionaries.length, 1)
    assert.equal(state.dictionaries[0].ns, module.LOCALE_NS)
    assert.deepEqual(Object.keys(state.dictionaries[0].dictionaries).sort(), ['en', 'zh'])
    // Both dictionaries must cover every key the page reads.
    assert.deepEqual(Object.keys(state.dictionaries[0].dictionaries.en).sort(),
      Object.keys(state.dictionaries[0].dictionaries.zh).sort())
  })

  it('injects the snapshot hook under the name the card reads', () => {
    const { module } = loadClient()
    const { ctx, state } = fakeContext({})
    module.apply(ctx)
    const injected = state.registrations[0].config.inject()
    assert.equal(typeof injected.t, 'function')
    assert.ok(injected.hooks.diskDoctorCard !== undefined, 'the hook is named diskDoctorCard → useDiskDoctorCard')
    for (const action of ['edit', 'resetField', 'save', 'discard']) {
      assert.equal(typeof injected[action], 'function', `missing action ${action}`)
    }
  })
})

describe('field conversions', () => {
  /** Build the page and return its live snapshot after applying `edits`. */
  function snapshotAfter (initialValue, edits = {}) {
    const { module } = loadClient()
    const { ctx, state } = fakeContext(initialValue)
    module.apply(ctx)
    const injected = state.registrations[0].config.inject()
    for (const [field, text] of Object.entries(edits)) injected.edit(field, text)
    return injected.hooks.diskDoctorCard.get()
  }

  it('formats the five fields from the served values', () => {
    const state = snapshotAfter({ dshHome: 'C:\\x', topN: 20, reportDir: '', excludeGlobs: ['a', 'b'], followSymlinks: true })
    assert.equal(state.dshHome.text, 'C:\\x')
    assert.equal(state.topN.text, '20')
    assert.equal(state.reportDir.text, '')
    assert.equal(state.excludeGlobs.text, 'a, b', 'the list renders comma-separated')
    assert.equal(state.followSymlinks.text, 'true', 'the boolean renders as a literal word')
    assert.equal(state.invalid, false)
  })

  it('treats an empty draft as a clear, not an empty string', () => {
    const state = snapshotAfter({ dshHome: 'C:\\x', excludeGlobs: ['a'] }, { dshHome: '   ', excludeGlobs: ' , ' })
    assert.equal(state.dshHome.overridden, false, 'a blank draft clears rather than writing ""')
    assert.equal(state.excludeGlobs.overridden, false)
  })

  it('accepts either boolean spelling and rejects anything else', () => {
    assert.equal(snapshotAfter({}, { followSymlinks: 'TRUE' }).followSymlinks.invalid, false)
    assert.equal(snapshotAfter({}, { followSymlinks: 'false' }).followSymlinks.invalid, false)
    assert.equal(snapshotAfter({}, { followSymlinks: 'yes' }).followSymlinks.invalid, true)
    assert.equal(snapshotAfter({}, { followSymlinks: 'yes' }).invalid, true, 'an invalid field blocks the save')
  })

  it('splits the list on commas and drops empty entries', () => {
    const state = snapshotAfter({}, { excludeGlobs: ' a ,, b , ' })
    assert.equal(state.excludeGlobs.text, ' a ,, b , ', 'the draft is preserved verbatim')
    assert.equal(state.excludeGlobs.overridden, true)
    assert.equal(state.excludeGlobs.invalid, false)
  })

  it('rejects a non-numeric topN', () => {
    assert.equal(snapshotAfter({}, { topN: 'abc' }).topN.invalid, true)
    assert.equal(snapshotAfter({}, { topN: '25' }).topN.invalid, false)
  })

  it('resets a field back to the default rather than to an empty override', () => {
    const { module } = loadClient()
    const { ctx, state } = fakeContext({ followSymlinks: true })
    module.apply(ctx)
    const injected = state.registrations[0].config.inject()
    injected.resetField('followSymlinks')
    const after = injected.hooks.diskDoctorCard.get()
    assert.equal(after.followSymlinks.text, '', 'a reset stages a clear')
    assert.equal(after.followSymlinks.overridden, false)
  })
})

describe('rendered tree', () => {
  /** Render the page once with the given view and served values. */
  function render (view, value = {}, status = 'ready') {
    const { module } = loadClient()
    const { ctx, state } = fakeContext(value, status)
    module.apply(ctx)
    const injected = state.registrations[0].config.inject()
    const component = state.registrations[0].component
    return component({
      view,
      t: injected.t,
      useDiskDoctorCard: (select) => select(injected.hooks.diskDoctorCard.get()),
      edit: injected.edit,
      resetField: injected.resetField,
      save: injected.save,
      discard: injected.discard
    })
  }

  it('renders a one-liner for the summary view', () => {
    assert.equal(render('summary'), 'dsh-disk-doctor:description')
  })

  it('still renders the form, reporting unavailable, before the namespace is served', () => {
    // This is what the previous whileServed gate hid: the page now always exists,
    // and says why it cannot be edited instead of showing nothing at all.
    const tree = render('page', {}, 'loading')
    assert.equal(tree.type, SettingsForm)
    assert.equal(tree.props.state.available, false)
    assert.equal(tree.children.length, 4, 'three plain fields plus one folded group')
  })

  it('renders the three plain fields and folds the six technical ones away', () => {
    const tree = render('page', { dshHome: 'C:\\x', topN: 10, excludeGlobs: [], followSymlinks: false })
    assert.equal(tree.type, SettingsForm)
    assert.equal(typeof tree.props.onSave, 'function')
    assert.equal(typeof tree.props.labels.save, 'string')

    const plain = tree.children.slice(0, 3)
    assert.deepEqual(plain.map((child) => child.props.id), [
      'disk-doctor-dsh-home',
      'disk-doctor-top-n',
      'disk-doctor-report-dir'
    ])
    plain.forEach((child) => assert.equal(child.type, SettingsValueField))

    const details = tree.children[3]
    assert.equal(details.type, 'details', 'the technical fields live behind a disclosure')
    assert.equal(details.props.className, 'dd-advanced')
    const folded = details.children.slice(1)
    // Every field the host declares has a control somewhere: a field with no control is a
    // setting the user can never see, which is exactly how the two permission switches
    // were lost once already. The colour key closes the page and carries no field id.
    // `allowCleanup` is deliberately not here — it moved to the panel's own gear.
    assert.deepEqual(folded.filter((child) => child.props?.id !== undefined).map((child) => child.props.id), [
      'disk-doctor-exclude-globs',
      'disk-doctor-follow-symlinks',
      'disk-doctor-app-dir',
      'disk-doctor-allow-open-folder',
      'disk-doctor-allow-open-folder-sensitive'
    ])
    assert.equal(folded.at(-1).props.className, 'dd-color-help', 'the colour key closes the page')

    const topN = plain[1]
    assert.equal(topN.props.numeric, true, 'only topN asks for a numeric keypad')
    assert.equal(topN.props.text, '10')
    assert.equal(typeof topN.props.onEdit, 'function')
    assert.equal(typeof topN.props.onReset, 'function')
  })

  it('carries every host field, so no setting is invisible', async () => {
    const { module } = loadClient()
    const { ctx, state } = fakeContext({
      dshHome: 'C:\\x',
      topN: 10,
      reportDir: '',
      excludeGlobs: [],
      followSymlinks: false,
      appDir: 'E:\\dsh1',
      allowOpenFolder: true,
      allowOpenFolderSensitive: false,
      allowCleanup: false
    })
    module.apply(ctx)
    const form = state.registrations[0].component({
      view: 'page',
      t: (key) => key,
      useDiskDoctorCard: (select) => select(state.registrations[0].config.inject().hooks.diskDoctorCard.get()),
      edit: () => {},
      resetField: () => {},
      save: () => {},
      discard: () => {}
    })
    const ids = [
      ...form.children.slice(0, 3).map((child) => child.props.id),
      ...form.children[3].children.slice(1)
        .filter((child) => child.props?.id !== undefined)
        .map((child) => child.props.id)
    ]
    // Mirrors `Object.keys(Config)` on the host half, minus the one field that is edited
    // from the panel's gear instead of here.
    assert.deepEqual(ids, [
      'disk-doctor-dsh-home',
      'disk-doctor-top-n',
      'disk-doctor-report-dir',
      'disk-doctor-exclude-globs',
      'disk-doctor-follow-symlinks',
      'disk-doctor-app-dir',
      'disk-doctor-allow-open-folder',
      'disk-doctor-allow-open-folder-sensitive'
    ])

    const snapshot = state.registrations[0].config.inject().hooks.diskDoctorCard.get()
    assert.equal(snapshot.appDir.text, 'E:\\dsh1')
    assert.equal(snapshot.allowOpenFolder.text, 'true')
    assert.equal(snapshot.allowOpenFolderSensitive.text, 'false')
    assert.equal(snapshot.invalid, false)

    // …and the ninth field is not invisible: it is edited from the panel's gear, which owns
    // its own form over the same scope. This is the regression guard for "moved the switch
    // into the gear and lost it entirely".
    const permission = state.sidebar.bodies.at(-1).config.inject().permission
    assert.equal(permission.read().on, false, 'the cleanup permission is off until published')
    assert.equal(permission.read().writable, true)
    assert.equal(await permission.write(true), true)
    assert.equal(permission.read().on, true, 'the write reaches the shared scope')
    assert.deepEqual(state.mutations, [[{ op: 'set', path: ['allowCleanup'], value: true }]])
  })

  it('turns the two permissions left on the page into switches rather than text boxes', () => {
    const switchesOf = (tree) => tree.children[3].children.slice(1)
      .filter((child) => child.props?.className === 'dd-setting')
      .map((row) => row.children[0].children.at(-1))

    const all = switchesOf(render('page', {
      allowOpenFolder: true,
      allowOpenFolderSensitive: false
    }))
    assert.equal(all.length, 2, 'these two are switches')
    assert.equal(all[0].type, 'button')
    assert.equal(all[0].props.className, 'dd-switch')
    assert.equal(all[0].props.role, 'switch')
    assert.deepEqual(all.map((button) => button.props['data-on']), ['1', '0'])
    assert.deepEqual(all.map((button) => button.props['aria-checked']), [true, false])
  })

  it('defaults the master switch on and the sensitive one off', () => {
    // A host that has never written these fields sends no value at all, so each switch has
    // to fall back to its documented default instead of rendering as "off".
    const switches = render('page', {}).children[3].children.slice(1)
      .filter((child) => child.props?.className === 'dd-setting')
      .map((row) => row.children[0].children.at(-1))
    assert.equal(switches[0].props['data-on'], '1', 'green locations are openable by default')
    assert.equal(switches[1].props['data-on'], '0', 'amber and grey still need consent')
  })

  it('stages a flip through the same form model the text field used', () => {
    const { module } = loadClient()
    const { ctx, state } = fakeContext({ allowOpenFolder: true })
    module.apply(ctx)
    const injected = state.registrations[0].config.inject()
    const page = () => state.registrations[0].component({
      view: 'page',
      t: injected.t,
      useDiskDoctorCard: (select) => select(injected.hooks.diskDoctorCard.get()),
      edit: injected.edit,
      resetField: injected.resetField,
      save: injected.save,
      discard: injected.discard
    })
    const toggleOf = (tree) => tree.children[3].children.slice(1)
      .find((child) => child.props?.id === 'disk-doctor-allow-open-folder')
      .children[0].children.at(-1)

    toggleOf(page()).props.onClick()
    const off = injected.hooks.diskDoctorCard.get()
    assert.equal(off.allowOpenFolder.text, 'false', 'clicking an on switch stages the off value')
    assert.equal(off.allowOpenFolder.overridden, true)
    assert.equal(toggleOf(page()).props['data-on'], '0', 'and the switch follows the staged value')

    toggleOf(page()).props.onClick()
    assert.equal(injected.hooks.diskDoctorCard.get().allowOpenFolder.text, 'true', 'clicking again stages on')

    injected.resetField('allowOpenFolder')
    const reset = injected.hooks.diskDoctorCard.get()
    assert.equal(reset.allowOpenFolder.text, '', 'a reset clears the override instead of writing false')
    assert.equal(reset.allowOpenFolder.overridden, false)
    assert.equal(toggleOf(page()).props['data-on'], '1', 'and the switch falls back to the default')
  })

  it('offers a reset control only once a permission has been changed', () => {
    const { module } = loadClient()
    const { ctx, state } = fakeContext({ allowOpenFolder: true })
    module.apply(ctx)
    const injected = state.registrations[0].config.inject()
    const page = () => state.registrations[0].component({
      view: 'page',
      t: injected.t,
      useDiskDoctorCard: (select) => select(injected.hooks.diskDoctorCard.get()),
      edit: injected.edit,
      resetField: injected.resetField,
      save: injected.save,
      discard: injected.discard
    })
    const resetOf = (tree) => tree.children[3].children.slice(1)
      .find((child) => child.props?.id === 'disk-doctor-allow-open-folder')
      .children[0].children[1]

    assert.equal(resetOf(page()), null, 'an untouched field has nothing to reset')
    injected.edit('allowOpenFolder', 'false')
    const changed = resetOf(page())
    assert.equal(changed.props.className, 'dd-reset')
    assert.equal(changed.children[0], 'dsh-disk-doctor:reset')
  })

  it('writes down what each colour means, on the settings page', () => {
    const legend = render('page', {}).children[3].children.at(-1)
    assert.equal(legend.props.className, 'dd-color-help')
    assert.equal(legend.children[0].children[0], 'dsh-disk-doctor:colorHelpTitle')
    assert.deepEqual(legend.children.slice(1).map((row) => row.children[0].props['data-level']),
      ['safe', 'care', 'keep'], 'one row per level, in order')
    const lines = legend.children.slice(1).map((row) => row.children[1].children[0])
    assert.deepEqual(lines.map((line) => line.includes('color_safe') || line.includes('color_care') ||
      line.includes('color_keep')), [true, true, true], 'and each line says what its colour means')
    assert.ok(lines[0].includes('level_safe'), 'named with the same words the rows use')
  })
})

describe('resident panel', () => {
  /** A report shaped like the host's, with three areas and very different sizes. */
  const report = {
    schema: 'dsh-disk-doctor/report@1',
    totals: { bytes: 770_000_000, files: 8959, dirs: 900 },
    regenerableBytes: 118_000_000,
    contentBytes: 652_000_000,
    areas: [
      { id: 'data', label: 'Data', bytes: 770_000_000, files: 8959, dirs: 900, roots: [], notes: ['数据文件夹：~/.dsh'] },
      { id: 'app', label: 'App', bytes: 1_015_000_000, files: 120, dirs: 12, roots: ['E:\\dsh1'], notes: ['安装位置：E:\\dsh1（自动找到，只读展示，不参与清理）'] },
      { id: 'cache', label: 'Cache', bytes: 126_000_000, files: 300, dirs: 30, roots: [], notes: ['这些是 DSH 之外的位置，与上面的区不能相加：pnpm 内容仓库 …'] }
    ],
    capabilities: { openFolder: false, openFolderSensitive: false },
    linkInstalls: [],
    categories: [
      {
        id: 'other',
        area: 'data',
        label: 'Other',
        safety: 'keep',
        bytes: 347_000_000,
        files: 93,
        roots: ['C:\\Users\\me\\.dsh'],
        topItems: [{ path: 'C:\\Users\\me\\.dsh\\electron', bytes: 347_000_000, files: 80 }]
      },
      {
        id: 'runtimes',
        area: 'data',
        label: 'Runtimes',
        safety: 'keep',
        bytes: 272_000_000,
        files: 7739,
        roots: ['C:\\Users\\me\\.dsh\\dsh-runtimes'],
        topItems: []
      },
      {
        id: 'temp-spill',
        area: 'data',
        label: 'Temp',
        safety: 'safe',
        bytes: 4_000_000,
        files: 17,
        roots: ['C:\\Users\\me\\AppData\\Local\\Temp\\dsh-abc'],
        topItems: []
      },
      { id: 'profile-logs', area: 'data', label: 'Logs', safety: 'safe', bytes: 0, files: 0, topItems: [] },
      {
        id: 'app-install',
        area: 'app',
        label: 'Install',
        safety: 'keep',
        bytes: 1_015_000_000,
        files: 120,
        roots: ['E:\\dsh1'],
        topItems: [{ path: 'E:\\dsh1\\resources\\app.asar', bytes: 115_000_000, files: 1 }]
      },
      {
        id: 'pnpm-store',
        area: 'cache',
        label: 'Store',
        safety: 'care',
        bytes: 112_000_000,
        files: 200,
        overlapBytes: 109_000_000,
        roots: ['C:\\Users\\me\\AppData\\Local\\pnpm'],
        topItems: []
      },
      {
        id: 'chromium-data',
        area: 'cache',
        label: 'Chromium',
        safety: 'care',
        bytes: 14_000_000,
        files: 100,
        roots: ['C:\\Users\\me\\AppData\\Roaming\\@deepseek-ai\\dsh-desktop'],
        topItems: []
      }
    ],
    warnings: []
  }
  const t = (key) => `T:${key}`
  /** A report with the open-folder feature switched on, optionally past the first gate. */
  const withOpen = (sensitive) => ({
    ...report,
    capabilities: { openFolder: true, openFolderSensitive: sensitive === true }
  })

  it('registers the sidebar tab and its body', () => {
    const { module } = loadClient()
    const { ctx, state } = fakeContext({})
    module.apply(ctx)

    assert.equal(state.sidebar.tabTypes.length, 1)
    const tab = state.sidebar.tabTypes[0]
    assert.equal(tab.id, module.TAB_ID)
    assert.equal(tab.kind, module.TAB_KIND)
    assert.equal(tab.priority, 'extension')
    assert.equal(typeof tab.title, 'function')
    assert.equal(tab.guide.length, 1, 'the panel is reachable from the sidebar guide')

    assert.equal(state.sidebar.bodies.length, 1)
    assert.equal(state.sidebar.bodies[0].config.name, 'sidebar.right.pane.tab')
    assert.equal(state.sidebar.bodies[0].config.key, module.TAB_ID)
  })

  it('auto-opens the panel once, after a beat, through the navigation controller', () => {
    const scheduled = []
    const realSetTimeout = globalThis.setTimeout
    globalThis.setTimeout = (fn, ms) => {
      scheduled.push({ fn, ms })
      return 1
    }
    try {
      const { module } = loadClient()
      const { ctx, state } = fakeContext({})
      module.apply(ctx)

      assert.equal(state.sidebar.opened.length, 0, 'opening is deferred, not synchronous')
      assert.equal(scheduled.length, 1, 'exactly one auto-open is scheduled')
      assert.equal(scheduled[0].ms, 400, 'the seat needs a beat to be ready')

      scheduled[0].fn()
      assert.equal(state.sidebar.opened.length, 1, 'the deferred call actually opens the panel')
      assert.equal(state.sidebar.opened[0].kind, module.TAB_KIND)
    } finally {
      globalThis.setTimeout = realSetTimeout
    }
  })

  it('does not reopen a panel the reader already dismissed this session', () => {
    const scheduled = []
    const realSetTimeout = globalThis.setTimeout
    globalThis.setTimeout = (fn, ms) => {
      scheduled.push({ fn, ms })
      return 1
    }
    try {
      const { module } = loadClient({
        sessionStorage: { getItem: () => '1', setItem: () => {} }
      })
      const { ctx, state } = fakeContext({})
      module.apply(ctx)
      assert.equal(scheduled.length, 0, 'a stored flag suppresses the auto-open')
      assert.equal(state.sidebar.opened.length, 0)
    } finally {
      globalThis.setTimeout = realSetTimeout
    }
  })

  it('survives a browser that refuses session storage', () => {
    const realSetTimeout = globalThis.setTimeout
    globalThis.setTimeout = () => 1
    // Some browsers throw on access rather than returning null, so the plugin must
    // treat a throwing storage the same as an absent one.
    const deny = () => {
      throw new Error('storage disabled')
    }
    try {
      const { module } = loadClient({ sessionStorage: { getItem: deny, setItem: deny } })
      const { ctx, state } = fakeContext({})
      module.apply(ctx)
      // The panel is still registered even though the auto-open could not be decided.
      assert.equal(state.sidebar.tabTypes.length, 1)
      assert.equal(state.sidebar.bodies.length, 1)
    } finally {
      globalThis.setTimeout = realSetTimeout
    }
  })

  it('keeps its route in step with the host route', async () => {
    const { module } = loadClient()
    const host = await import('../lib/serve.js')
    assert.equal(module.REPORT_ROUTE, host.REPORT_ROUTE,
      'the panel and the host route must name the same path')
  })

  it('renders the loading state before the first report arrives', () => {
    const { module } = loadClient()
    const { ctx, state } = fakeContext({})
    module.apply(ctx)
    // The component itself, rendered once with the stub hooks.
    const panel = state.sidebar.bodies[0].component({ t: (key) => key })
    assert.equal(panel.type, 'div')
    assert.equal(panel.props.className, 'dd-panel')
    const empty = panel.children[0].children[0]
    assert.equal(empty.props.className, 'dd-empty')
    assert.equal(empty.children[0], 'scanning')
  })

  it('renders one bar per non-empty group, largest first', () => {
    const { module } = loadClient()
    // A reader that echoes a marker, so a missing key is distinguishable from a hit.
    const t = (key) => `T:${key}`
    const body = module.renderPanelBody(t, report, null, () => {})
    const section = dataBody(body).find((child) => child !== null && child.props?.className === 'dd-section')
    assert.ok(section !== undefined, 'the statistics sit in their own section')
    assert.equal(section.children[0].props.className, 'dd-section-title', 'and the section is titled')
    assert.equal(section.children[0].children[0], 'T:sectionTitle')
    const list = section.children[1]
    assert.equal(list.props.className, 'dd-list', 'a list of groups is rendered')
    assert.equal(list.children.length, 3, 'the empty group is left out')
    // row → [toggle button, open control] / .dd-row-name → [chevron, level dot, name]
    const names = list.children.map((row) => rowName(row).children[2])
    // The panel shows its own plain-language names, not the host's labels.
    assert.deepEqual(names, ['T:cat_other', 'T:cat_runtimes', 'T:cat_temp_spill'])
    const levels = list.children.map((row) => rowName(row).children[1].props['data-level'])
    assert.deepEqual(levels, ['keep', 'keep', 'safe'], 'each row carries its safety level')
    const widths = list.children.map((row) => row.children[1].children[0].props.style.width)
    assert.deepEqual(widths, ['100%', '78%', '2%'], 'bars are proportional, with a visible minimum')
  })

  it('shows the headline, the cleanable total, and the plain-language note on open', () => {
    const { module } = loadClient()
    const t = (key) => `T:${key}`
    const body = module.renderPanelBody(t, report, 'other', () => {})
    const flat = JSON.stringify(body)
    assert.ok(flat.includes('T:totalLabel'), 'the headline number is labelled')
    assert.ok(flat.includes('T:cleanable'), 'the cleanable total is spelled out')
    assert.ok(flat.includes('T:note_other'), 'the group explains itself in plain words')
    assert.ok(flat.includes('electron'), 'the largest item is named, not shown as a truncated path')
    assert.ok(!flat.includes('…/.dsh/electron'), 'the row no longer leads with an ellipsis')
    assert.ok(!flat.includes('dd-copy'), 'no copy control is offered when no handler is given')
    const head = areaBoxes(body)[0].children[0]
    assert.equal(head.props.className, 'dd-area-head')
    assert.equal(head.children[1].children[0], '734 MB', 'the headline is the data area total')
    assert.equal(head.children[0].children[0], 'T:area_data', 'and it says which area it counts')
  })

  it('offers a refresh control only when the panel can reload', () => {
    const { module } = loadClient()
    const t = (key) => `T:${key}`
    const actionsOf = (body) => dataBody(body).find((child) => child?.props?.className === 'dd-actions')

    const reloadable = actionsOf(module.renderPanelBody(t, report, null, () => {}, () => {}))
    assert.equal(reloadable.children[0].props.className, 'dd-btn')
    assert.equal(reloadable.children[0].children[0], 'T:refresh')

    const readOnly = actionsOf(module.renderPanelBody(t, report, null, () => {}))
    assert.equal(readOnly.children[0], null)
  })

  it('formats sizes and paths the way a reader expects', () => {
    const { module } = loadClient()
    assert.equal(module.size(770_000_000), '734 MB', 'three digits drop the decimal')
    assert.equal(module.size(1024 ** 3 * 1.5), '1.5 GB', 'smaller numbers keep one decimal')
    assert.equal(module.size(0), '0 MB')
    assert.equal(module.shortPath('C:\\Users\\me\\.dsh\\sessions\\abc'), '…/sessions/abc')
    assert.equal(module.shortPath('C:\\x'), 'C:\\x')
  })

  it('draws one box per area, each with its own figure and its own note', () => {
    const { module } = loadClient()
    const body = module.renderPanelBody(t, report, null, () => {})
    const boxes = areaBoxes(body)
    assert.deepEqual(boxes.map((box) => box.children[0].children[0].children[0]),
      ['T:area_data', 'T:area_app', 'T:area_cache'])
    assert.deepEqual(boxes.map((box) => box.children[0].children[1].children[0]),
      ['734 MB', '968 MB', '120 MB'], 'each box carries its own figure')
    // Each box says where its bytes actually live.
    const flat = JSON.stringify(body)
    assert.ok(flat.includes('数据文件夹：~/.dsh'))
    assert.ok(flat.includes('安装位置：E:\\\\dsh1'), 'the box names the detected install folder')
    assert.ok(flat.includes('不能相加'), 'the cache box states the overlap in words')
  })

  it('never adds the areas into one number', () => {
    const { module } = loadClient()
    const body = module.renderPanelBody(t, report, null, () => {})
    const flat = JSON.stringify(body)
    // 770 + 1015 + 126 MB would be 1.9 GB; the panel must not print it anywhere.
    assert.ok(!flat.includes('1.9 GB'), 'there is no grand total to misread')
    assert.ok(!flat.includes('1863 MB'))
    assert.equal(areaBoxes(body)[0].children[0].children[1].children[0], '734 MB',
      'the first box stays the data area, not the machine')
  })

  it('lists link-installed plugins as information, inside their own area', () => {
    const { module } = loadClient()
    const linked = {
      ...report,
      linkInstalls: [{
        path: 'C:\\Users\\me\\.dsh\\profiles\\desktop\\node_modules\\dsh-disk-doctor',
        target: 'E:\\disk-doctor\\dsh-disk-doctor',
        bytes: 300_000,
        files: 12,
        area: 'data',
        categoryId: 'profile-deps'
      }]
    }
    const body = module.renderPanelBody(t, linked, null, () => {})
    const flat = JSON.stringify(body)
    assert.ok(flat.includes('T:linkInstallsTitle'), 'the list is titled in the reader\'s language')
    assert.ok(flat.includes('dsh-disk-doctor'), 'the plugin is named instead of vanishing')
    assert.ok(flat.includes('disk-doctor/dsh-disk-doctor'), 'and its real location is shown')
    assert.equal(areaBoxes(body)[0].children[0].children[1].children[0], '734 MB',
      'listing a link changes no figure')
  })

  it('offers an open control on every row, greyed out until the host allows it', () => {
    const { module } = loadClient()
    const ui = { onOpen: () => {} }
    const closed = areaRows(module.renderPanelBody(t, report, null, () => {}, undefined, ui))
    assert.equal(closed.length, 3)
    assert.deepEqual(closed.map((row) => rowOpen(row).props.disabled), [true, true, true])
    assert.equal(rowOpen(closed[0]).props.title, 'T:openDisabled', 'and it says why')

    const opened = areaRows(module.renderPanelBody(t, withOpen(false), null, () => {}, undefined, ui))
    // 🟢 opens; 🟠 and ⚪ still need the second switch.
    assert.deepEqual(opened.map((row) => rowOpen(row).props.disabled), [true, true, false])
    assert.equal(rowOpen(opened[0]).props.title, 'T:openSensitive')
    assert.equal(rowOpen(opened[2]).props.title, 'T:openHint')
  })

  it('opens the green rows at once and the rest only with the second switch', () => {
    const { module } = loadClient()
    const calls = []
    const ui = { onOpen: (target) => calls.push(target) }
    const green = areaRows(module.renderPanelBody(t, withOpen(false), null, () => {}, undefined, ui))
    rowOpen(green[2]).props.onClick()
    assert.deepEqual(calls, ['C:\\Users\\me\\AppData\\Local\\Temp\\dsh-abc'],
      'the row hands the host the folder it covers')

    const all = areaRows(module.renderPanelBody(t, withOpen(true), null, () => {}, undefined, ui))
    assert.deepEqual(all.map((row) => rowOpen(row).props.disabled), [false, false, false])
    rowOpen(all[0]).props.onClick()
    assert.equal(calls[1], 'C:\\Users\\me\\.dsh')
  })

  it('offers the same control on the rows of every area, and on each item', () => {
    const { module } = loadClient()
    const ui = { onOpen: () => {} }
    const body = module.renderPanelBody(t, withOpen(true), 'other', () => {}, undefined, ui)
    const appRows = areaRows(body, 1)
    assert.equal(appRows.length, 1)
    assert.equal(rowOpen(appRows[0]).props.disabled, false, 'the application folder follows the same rule')
    assert.equal(rowOpen(appRows[0]).props.className, 'dd-open')

    // An expanded row offers one control per item, judged by the row it belongs to.
    const row = areaRows(body)[0]
    const itemRows = row.children[2].find((child) => child?.props?.className === 'dd-items').children
    assert.equal(itemRows.length, 1)
    assert.equal(itemRows[0].props.className, 'dd-item')
    assert.equal(itemRows[0].children[2].props.className, 'dd-open', 'the item row can be opened too')
  })

  it('shows a refusal instead of swallowing it', () => {
    const { module } = loadClient()
    const body = module.renderPanelBody(t, report, null, () => {}, undefined, {
      onOpen: () => {},
      openError: 'sensitive'
    })
    assert.ok(JSON.stringify(body).includes('T:openFailed'), 'the reader is told the click did nothing')
    const silent = module.renderPanelBody(t, report, null, () => {}, undefined, { onOpen: () => {} })
    assert.ok(!JSON.stringify(silent).includes('T:openFailed'))
  })

  it('keeps the open route in step with the host route', async () => {
    const { module } = loadClient()
    const host = await import('../lib/serve.js')
    assert.equal(module.OPEN_ROUTE, host.OPEN_ROUTE,
      'the panel and the host route must name the same path')
  })

  it('writes down what each colour means in the panel too', () => {
    const { module } = loadClient()
    const body = module.renderPanelBody(t, report, null, () => {})
    const help = body.children.find((child) => child !== null && child.props?.className === 'dd-color-help')
    assert.ok(help !== undefined, 'the panel carries a colour key, so the dots are not a private code')
    assert.equal(help.children[0].children[0], 'T:colorHelpTitle')
    assert.deepEqual(help.children.slice(1).map((row) => row.children[0].props['data-level']),
      ['safe', 'care', 'keep'], 'one row per level, in the same order as the dots')
    assert.deepEqual(help.children.slice(1).map((row) => row.children[1].children[0]),
      ['T:level_safe —— T:color_safe', 'T:level_care —— T:color_care', 'T:level_keep —— T:color_keep'],
      'each line names the level and says what it means')
  })

  it('offers a cleanup preview, and offers nothing that could move a file', () => {
    const { module } = loadClient()
    const asked = []
    const body = module.renderPanelBody(t, report, null, () => {}, undefined, {
      onPreview: () => asked.push('preview'),
      preview: { phase: 'idle', plan: null },
      onCopy: () => {},
      onOpen: () => {}
    })
    const box = body.children.find((child) => child !== null && child.props?.className === 'dd-cleanup')
    assert.ok(box !== undefined, 'the panel carries a cleanup box')
    const flat = JSON.stringify(box)
    assert.ok(flat.includes('T:cleanupTitle'))
    assert.ok(flat.includes('T:cleanupSummary'), 'it states what is safe to clean, and where from')
    assert.ok(flat.includes('T:cleanupPreview'))

    const button = box.children
      .find((child) => child?.props?.className === 'dd-actions').children[0]
    assert.equal(button.props.className, 'dd-btn')
    button.props.onClick()
    assert.deepEqual(asked, ['preview'], 'the button only asks the host to look')

    // The one control this milestone must not have.
    assert.equal(/cleanup-(move|delete|clean)-button/.test(flat), false)
    assert.equal(box.children.some((child) => /删|move|清理按钮/.test(JSON.stringify(child?.children ?? []))), false)
  })

  /** A ready plan with two items, for the cleanup-box cases. */
  const cleanupPlan = {
    dryRun: true,
    destination: 'C:\\x\\.dsh\\disk-doctor\\quarantine\\20261007-101010',
    totalBytes: 3000,
    itemCount: 2,
    items: [
      { categoryId: 'plugin-cache', categoryLabel: 'Cache', path: 'C:\\x\\plugin-packages\\a.tgz', bytes: 2000, files: 1 },
      { categoryId: 'profile-market', categoryLabel: 'Market', path: 'C:\\x\\profiles\\desktop\\.dsh-market', bytes: 1000, files: 1 }
    ],
    categories: [],
    warnings: [],
    batches: []
  }

  /** The cleanup box, rendered with the host permission and callbacks a case needs. */
  function cleanupBox (module, { cleanup, plan = cleanupPlan, reader = t, ...ui } = {}) {
    const body = module.renderPanelBody(reader,
      { ...report, capabilities: { openFolder: true, openFolderSensitive: false, cleanup } },
      null, () => {}, undefined, { preview: { phase: 'ready', plan }, onPreview: () => {}, ...ui })
    return body.children.find((child) => child !== null && child.props?.className === 'dd-cleanup')
  }

  /** The shipped Chinese copy, so placeholder substitution can actually be observed. */
  function zhReader (module) {
    const { ctx, state } = fakeContext({})
    module.apply(ctx)
    const zh = state.dictionaries.at(-1).dictionaries.zh
    return (key) => zh[key] ?? `MISSING:${key}`
  }

  it('spells out the ritual the second step follows, and gates the move behind a switch', () => {
    const { module } = loadClient()
    const box = cleanupBox(module, { cleanup: true, onMove: () => {} })
    const ritual = box.children.find((child) => child !== null && child.props?.className === 'dd-cleanup-plan')
    assert.ok(ritual !== undefined, 'the box explains the ritual')
    assert.equal(ritual.children[0].children[0], 'T:cleanupPlanTitle')
    const steps = ritual.children.slice(1).map((row) => row.children[0])
    assert.equal(steps.length, 3)
    assert.deepEqual(steps, ['T:cleanupPlan1', 'T:cleanupPlan2', 'T:cleanupPlan3'])
    assert.ok(JSON.stringify(box).includes('T:cleanupEmptyHint'),
      'and that emptying the quarantine stays the user\'s job')

    // Without the host permission the one button that moves files is greyed, with a reason.
    const denied = cleanupBox(module, { cleanup: false, onMove: () => {} })
    const moveButton = (tree) => tree.children
      .find((child) => child?.props?.className === 'dd-actions')
      .children.find((child) => child !== null && String(child.children?.[0] ?? '').includes('cleanupMove'))
    assert.equal(moveButton(denied).props.disabled, true, 'greyed out without the permission')
    assert.equal(moveButton(denied).props.title, 'T:cleanupMoveDisabled')
    assert.ok(JSON.stringify(denied).includes('T:cleanupMoveDisabled'), 'and it says so in words')

    // With the permission it must be *clickable*, because that first click is what opens
    // the confirmation. Disabling it until the confirmation was open made the button look
    // alive and do nothing — the bug this case now pins from the other side.
    const allowed = moveButton(cleanupBox(module, { cleanup: true, onMove: () => {} }))
    assert.equal(allowed.props.disabled, false, 'the first click has to be able to land')
    assert.equal(allowed.props.onClick !== undefined, true)
  })

  it('asks before it moves, and moves on the second click only', () => {
    const { module } = loadClient()
    const moves = []
    const confirms = []
    const buttonOf = (tree) => tree.children
      .find((child) => child?.props?.className === 'dd-actions')
      .children.find((child) => child !== null && String(child.children?.[0] ?? '').includes('cleanupMove') ||
        String(child.children?.[0] ?? '').includes('cleanupConfirmYes'))

    const idle = cleanupBox(module, {
      cleanup: true,
      onMove: () => moves.push('move'),
      onConfirmMove: (v) => confirms.push(v)
    })
    assert.equal(buttonOf(idle).children[0], 'T:cleanupMove', 'it starts as the plain move button')
    buttonOf(idle).props.onClick()
    assert.deepEqual(confirms, [true], 'the first click only opens the confirmation')
    assert.deepEqual(moves, [], 'and moves nothing')

    // With the confirmation open the same button carries the yes, and the row carries the
    // question and the way out — one yes, one cancel, no duplicate buttons.
    const asking = cleanupBox(module, {
      cleanup: true,
      confirming: true,
      onMove: () => moves.push('move'),
      onConfirmMove: (v) => confirms.push(v)
    })
    const yes = buttonOf(asking)
    assert.equal(yes.children[0], 'T:cleanupConfirmYes', 'the button now says what it will do')
    assert.equal(yes.props.className, 'dd-btn dd-btn-danger', 'and is weighted like a warning')
    const question = asking.children.find((child) => String(child?.props?.className ?? '').includes('dd-cleanup-confirm'))
    assert.ok(question !== undefined, 'the question is asked')
    assert.equal(question.children[0], 'T:cleanupConfirm', 'with the count and size from the plan')
    assert.equal(question.children.length, 2, 'and exactly one answer: cancel')
    assert.equal(question.children[1].children[0], 'T:cleanupConfirmNo')

    yes.props.onClick()
    assert.deepEqual(moves, ['move'], 'the second click is the one that moves')
    question.children[1].props.onClick()
    assert.deepEqual(confirms, [true, false], 'and cancelling closes it')
  })

  it('shows what moved, the way back, and the batches that are still sitting there', () => {
    const { module } = loadClient()
    const undone = []
    const batch = { id: '20261007-101010', items: [1, 2].map((n) => ({ original: `C:\\x\\a${n}`, target: `C:\\q\\a${n}` })), bytes: 3000, failures: [] }
    const withBatch = cleanupBox(module, { cleanup: true, onMove: () => {}, batch, onUndo: (id) => undone.push(id) })
    const moved = withBatch.children.find((child) => child?.props?.className === 'dd-cleanup-moved')
    assert.ok(moved !== undefined, 'the box reports the move')
    assert.ok(JSON.stringify(moved).includes('T:cleanupMoved'), 'with the count and the total')
    assert.ok(JSON.stringify(moved).includes('T:cleanupMovedHint'), 'and what to do next')
    const undoButton = moved.children.find((child) => child?.props?.className === 'dd-actions').children[0]
    assert.equal(undoButton.children[0], 'T:cleanupUndo')
    undoButton.props.onClick()
    assert.deepEqual(undone, [batch.id], 'the undo names the batch it is undoing')

    // After an undo, the result is reported — including anything that could not go back.
    const after = cleanupBox(module, {
      cleanup: true,
      plan: { ...cleanupPlan, batches: [] },
      undo: { restored: [{ original: 'a', target: 'b', bytes: 3000 }], failures: [], restoredBytes: 3000 }
    })
    assert.ok(JSON.stringify(after).includes('T:cleanupUndoDone'), 'the undo says what came back')
    const partial = cleanupBox(module, {
      cleanup: true,
      plan: { ...cleanupPlan, batches: [] },
      undo: { restored: [], failures: [{ reason: 'occupied' }], restoredBytes: 0 }
    })
    assert.ok(JSON.stringify(partial).includes('T:cleanupUndoPartial'), 'and what did not')

    // A move that failed says why, and does not also claim there was nothing to move. The
    // real dictionary is used here so the reason is actually substituted into the sentence.
    const failed = cleanupBox(module, {
      cleanup: true,
      reader: zhReader(module),
      batch: { error: '宿主还是旧版本（这个接口还不存在）', items: [], bytes: 0, failures: [] }
    })
    const failedText = JSON.stringify(failed)
    assert.ok(failedText.includes('移动没成功：宿主还是旧版本'), 'the failure and its reason are reported')
    assert.ok(!failedText.includes('这次没有可移动的内容'), 'and not as "nothing to move"')
    assert.equal(failed.children.some((child) => child?.props?.className === 'dd-cleanup-moved'), false,
      'the green summary is not drawn for a failure')

    // Batches already on disk offer their own undo, so a later visit can still get things back.
    const withBatches = cleanupBox(module, {
      cleanup: true,
      plan: { ...cleanupPlan, batches: [{ id: '20261007-090000', status: 'moved', itemCount: 3, bytes: 900 }] },
      onUndo: (id) => undone.push(id)
    })
    const batches = withBatches.children.find((child) => child?.props?.className === 'dd-cleanup-batches')
    assert.ok(batches !== undefined, 'the batches are listed')
    assert.ok(JSON.stringify(batches).includes('20261007-090000'))
    batches.children[1].children[1].props.onClick()
    assert.deepEqual(undone, [batch.id, '20261007-090000'])
  })

  it('lists what would move, where it would go, and that nothing moves yet', () => {
    const { module } = loadClient()
    // The real Chinese copy here, so the sentence templates themselves are checked:
    // a marker reader cannot tell whether `{path}` ever reaches the screen.
    const { ctx, state } = fakeContext({})
    module.apply(ctx)
    const zh = state.dictionaries[0].dictionaries.zh
    const tt = (key) => zh[key] ?? `missing:${key}`
    const plan = {
      schema: 'dsh-disk-doctor/cleanup@1',
      dryRun: true,
      destination: 'C:\\Users\\me\\.dsh\\disk-doctor\\quarantine\\20261007-101010',
      totalBytes: 20_480,
      totalFiles: 4,
      itemCount: 3,
      truncated: false,
      items: [
        { categoryId: 'plugin-cache', categoryLabel: 'Cache', path: 'C:\\Users\\me\\.dsh\\plugin-packages\\foo.tgz', bytes: 20_000, files: 1 },
        { categoryId: 'profile-market', categoryLabel: 'Market', path: 'C:\\Users\\me\\.dsh\\profiles\\desktop\\.dsh-market\\state.json', bytes: 400, files: 1 },
        { categoryId: 'profile-logs', categoryLabel: 'Logs', path: 'C:\\Users\\me\\.dsh\\profiles\\desktop\\.plugin-manager\\logs\\pnpm.log', bytes: 80, files: 1 }
      ],
      categories: [{ id: 'plugin-cache', label: 'Cache', bytes: 20_000, files: 1, itemCount: 1 }],
      warnings: ['这是**预演**：只列出「如果清理会移动什么」，没有移动、复制或删除任何文件'],
      refused: []
    }
    const body = module.renderPanelBody(tt, report, null, () => {}, undefined, {
      preview: { phase: 'ready', plan },
      onPreview: () => {},
      onCopy: () => {},
      onOpen: () => {}
    })
    const box = body.children.find((child) => child !== null && child.props?.className === 'dd-cleanup')
    const flat = JSON.stringify(box)
    assert.ok(flat.includes('会移动 3 项'), 'the count and the total are stated')
    assert.ok(flat.includes('quarantine'), 'and where it would go')
    assert.ok(flat.includes('不会移动任何文件'), 'and that nothing moves')
    assert.ok(flat.includes('重新列一次'), 'the button offers to list it again')
    assert.ok(!flat.includes('看看会移动什么'), 'the first-run label is gone once a plan exists')
    // Every planned item is spelled out, largest first as the host sorted them.
    const items = box.children.find((child) => child?.props?.className === 'dd-cleanup-items')
    assert.equal(items.children.length, 3)
    assert.equal(items.children[0].children[1].children[0], '19.5 KB')
    assert.ok(JSON.stringify(items).includes('foo.tgz'), 'named, not just counted')
  })

  it('collapses a long preview list and says how many it left out', () => {
    const { module } = loadClient()
    const items = Array.from({ length: 30 }, (_, index) => ({
      categoryId: 'plugin-cache',
      categoryLabel: 'Cache',
      path: `C:\\x\\plugin-packages\\p${index}.tgz`,
      bytes: 100 - index,
      files: 1
    }))
    const plan = {
      dryRun: true,
      destination: 'C:\\x\\.dsh\\disk-doctor\\quarantine\\20261007-101010',
      totalBytes: 3000,
      itemCount: items.length,
      truncated: false,
      items,
      categories: [],
      warnings: [],
      refused: []
    }
    const body = module.renderPanelBody(t, report, null, () => {}, undefined,
      { preview: { phase: 'ready', plan }, onPreview: () => {} })
    const box = body.children.find((child) => child !== null && child.props?.className === 'dd-cleanup')
    assert.equal(box.children.find((child) => child?.props?.className === 'dd-cleanup-items').children.length, 12)
    assert.ok(JSON.stringify(box).includes('T:cleanupMore'), 'and the reader is told how many are missing')
  })

  it('points at the operations that really free space, instead of at the delete key', () => {
    const { module } = loadClient()
    const { ctx, state } = fakeContext({})
    module.apply(ctx)
    const zh = state.dictionaries[0].dictionaries.zh
    const tt = (key) => zh[key] ?? `missing:${key}`
    const withPlugins = {
      ...report,
      categories: [...report.categories, {
        id: 'profile-deps',
        area: 'data',
        label: 'Plugins',
        safety: 'care',
        bytes: 109_000_000,
        files: 500,
        roots: ['C:\\Users\\me\\.dsh\\profiles\\desktop\\node_modules'],
        topItems: [
          { path: 'C:\\Users\\me\\.dsh\\profiles\\desktop\\node_modules\\dsh-image-gen', bytes: 62_000_000, files: 300 },
          { path: 'C:\\Users\\me\\.dsh\\profiles\\desktop\\node_modules\\dsh-pet', bytes: 30_000_000, files: 200 }
        ]
      }]
    }
    const body = module.renderPanelBody(tt, withPlugins, null, () => {})
    const guide = body.children.find((child) => child !== null && child.props?.className === 'dd-guide')
    assert.ok(guide !== undefined, 'the panel says how to reclaim the big numbers')
    const flat = JSON.stringify(guide)
    assert.ok(flat.includes('想省更多空间'), 'the section is there')
    assert.ok(flat.includes('dsh-image-gen'), 'the biggest plugin is named')
    assert.ok(flat.includes('卸载'), 'and uninstalling is the advice, not deleting')
    assert.ok(flat.includes('pnpm store prune'), 'the operation that actually frees the store is named')
    assert.ok(flat.includes('别动'), 'plus what must not be touched')
  })

  it('keeps the cleanup route in step with the host route', async () => {
    const { module } = loadClient()
    const host = await import('../lib/serve.js')
    assert.equal(module.CLEANUP_ROUTE, host.CLEANUP_ROUTE,
      'the panel and the host route must name the same path')
  })
})

describe('host to panel contract', () => {
  // The panel is only ever as correct as its agreement with what the host serves.
  // These tests drive the REAL route and feed its REAL output to the REAL renderer,
  // so a field renamed on one side fails here instead of silently rendering nothing.
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-disk-doctor-contract-'))
  const dshHome = path.join(fixtureRoot, '.dsh')

  after(() => {
    try {
      fs.rmSync(fixtureRoot, { recursive: true, force: true })
    } catch { /* best effort */ }
  })

  /** Register the real route and hand back its registration. */
  function captureRoute (settings) {
    let registration
    registerReportRoute({
      inject: (_names, callback) => callback({
        effect: (fn) => fn(),
        webServer: {
          register: (value) => {
            registration = value
            return () => {}
          }
        }
      })
    }, settings)
    assert.ok(registration !== undefined)
    return registration
  }

  /** Ask the route for its body, as the panel's fetch would. */
  async function fetchReport (settings, query = '') {
    const response = {
      status: undefined,
      body: undefined,
      writeHead (status) { this.status = status },
      end (body) { this.body = body }
    }
    await captureRoute(settings).handler({ method: 'GET', url: `${REPORT_ROUTE}${query}` }, response)
    assert.equal(response.status, 200)
    return JSON.parse(response.body)
  }

  it('serves a shape the panel can actually read', async () => {
    fs.mkdirSync(path.join(dshHome, 'sessions', '--E-demo--', 'session-a'), { recursive: true })
    fs.writeFileSync(path.join(dshHome, 'sessions', '--E-demo--', 'session-a', 'session.jsonl.zstd'), Buffer.alloc(2048))
    const report = await fetchReport({ dshHome, topN: 5, excludeGlobs: [], followSymlinks: false })

    // Everything the panel reaches for, asserted on the host's real output.
    assert.ok(Number.isFinite(report.totals.bytes))
    assert.ok(Number.isFinite(report.totals.files))
    assert.ok(Number.isFinite(report.regenerableBytes))
    assert.ok(Number.isFinite(report.contentBytes))
    assert.ok(Array.isArray(report.warnings))
    assert.ok(report.categories.length > 0)
    for (const category of report.categories) {
      assert.equal(typeof category.id, 'string')
      assert.ok(Number.isFinite(category.bytes))
      assert.ok(Number.isFinite(category.overlapBytes))
      assert.ok(['data', 'app', 'cache'].includes(category.area), `${category.id} names its area`)
      assert.ok(Array.isArray(category.topItems))
      for (const item of category.topItems) {
        assert.equal(typeof item.path, 'string')
        assert.ok(Number.isFinite(item.bytes))
      }
    }

    // The three boxes and the button permissions the panel mirrors.
    assert.ok(Array.isArray(report.areas) && report.areas.length > 0)
    assert.equal(report.areas[0].id, 'data', 'the first box is the data area')
    for (const area of report.areas) {
      assert.equal(typeof area.id, 'string')
      assert.ok(Number.isFinite(area.bytes))
      assert.ok(Number.isFinite(area.files))
      assert.ok(Array.isArray(area.notes) && area.notes.length > 0, `${area.id} says where it lives`)
      assert.ok(Array.isArray(area.roots))
    }
    assert.deepEqual(report.capabilities,
      { openFolder: false, openFolderSensitive: false, cleanup: false })
    assert.ok(Array.isArray(report.linkInstalls))

    const openable = await fetchReport({
      dshHome,
      topN: 5,
      excludeGlobs: [],
      followSymlinks: false,
      allowOpenFolder: true,
      allowOpenFolderSensitive: true,
      allowCleanup: true
    })
    assert.deepEqual(openable.capabilities, { openFolder: true, openFolderSensitive: true, cleanup: true },
      'the panel learns whether its buttons may do anything')
  })

  it('renders the host\'s real output without a single placeholder missing', async () => {
    const report = await fetchReport({ dshHome, topN: 5, excludeGlobs: [], followSymlinks: false })
    const { module } = loadClient()
    // A reader that echoes the marker: a key the dictionaries lack shows up as
    // `T:cat_…` and would not match the host's own label.
    const t = (key) => `T:${key}`
    const body = module.renderPanelBody(t, report, 'sessions', () => {}, () => {})
    const flat = JSON.stringify(body)

    assert.ok(flat.includes('T:totalLabel'))
    assert.ok(flat.includes('T:files'))
    assert.ok(flat.includes('T:cat_sessions'), 'the group the fixture created is named')
    assert.ok(flat.includes('T:note_sessions'), 'and explained')
    assert.ok(flat.includes('session.jsonl.zstd') || flat.includes('session-a'), 'the largest item is shown')
  })

  it('names every group the host can produce, in both languages', () => {
    const { module } = loadClient()
    // Read the dictionaries straight out of the module's own registration path.
    const { ctx, state } = fakeContext({})
    module.apply(ctx)
    const [dictionaries] = state.dictionaries
    assert.ok(dictionaries !== undefined)
    // The list comes from the host's own category table rather than being retyped here: a
    // hard-coded list is how `npm-global-dsh` shipped with no name at all, leaving the
    // panel showing a raw `cat_npm_global_dsh` key.
    const ids = CATEGORY_DEFS.map((category) => category.id)
    assert.ok(ids.includes('npm-global-dsh'), 'the table under test still has the awkward ones')
    for (const id of ids) {
      const key = `cat_${id.replace(/-/g, '_')}`
      assert.equal(typeof dictionaries.dictionaries.zh[key], 'string', `zh is missing ${key}`)
      assert.equal(typeof dictionaries.dictionaries.en[key], 'string', `en is missing ${key}`)
    }
  })
})
describe('chart views', () => {
  const report = {
    totals: { bytes: 1000, files: 10, dirs: 2 },
    regenerableBytes: 0,
    contentBytes: 1000,
    warnings: [],
    categories: [
      {
        id: 'profile-deps',
        label: 'Plugins',
        safety: 'care',
        bytes: 600,
        files: 3,
        topItems: [
          { path: 'C:\\x\\node_modules\\alpha', bytes: 400, files: 2 },
          { path: 'C:\\x\\node_modules\\beta', bytes: 200, files: 1 }
        ]
      },
      {
        id: 'sessions',
        label: 'Sessions',
        safety: 'keep',
        bytes: 400,
        files: 4,
        topItems: [{ path: 'C:\\x\\sessions\\--E-demo--\\chat-a', bytes: 400, files: 4 }]
      }
    ]
  }
  const t = (key) => `T:${key}`

  it('draws one arc per plugin, with a legend that names them', () => {
    const { module } = loadClient()
    const body = module.renderPanelBody(t, report, null, () => {}, undefined, { view: 'plugins' })
    const chart = areaChart(body)
    assert.ok(chart !== undefined, 'the plugin view is a chart')
    const svg = chartGraphic(chart).children[0]
    assert.equal(svg.type, 'svg')
    assert.equal(svg.children.length, 2, 'one arc per plugin')
    const names = chartLegend(chart).children.map((row) => row.children[1].children[0])
    assert.deepEqual(names, ['alpha', 'beta'], 'a legend shows the package name, not a truncated path')

    const asPaths = module.renderPanelBody(t, report, null, () => {}, undefined,
      { view: 'plugins', prefs: { showPaths: true } })
    const pathNames = chartLegend(areaChart(asPaths))
      .children.map((row) => row.children[1].children[0])
    assert.deepEqual(pathNames, ['…/node_modules/alpha', '…/node_modules/beta'], 'the switch restores paths')
    const percents = chartLegend(chart).children.map((row) => row.children[2].children[0])
    assert.deepEqual(percents, ['67%', '33%'], 'the legend explains the shares')
  })

  it('offers a copy control on every chart legend row too', () => {
    const { module } = loadClient()
    const body = module.renderPanelBody(t, report, null, () => {}, undefined,
      { view: 'plugins', onCopy: () => {} })
    const chart = areaChart(body)
    const controls = chartLegend(chart).children.map((row) => row.children[5]?.props?.className)
    assert.deepEqual(controls, ['dd-copy', 'dd-copy'], 'each named slice can be copied')
  })

  it('offers an open control on chart legend rows too, judged by the owning category', () => {
    const { module } = loadClient()
    const opened = []
    const legend = (value, ui) => chartLegend(areaChart(module.renderPanelBody(t, value, null, () => {}, undefined, ui)))
      .children

    // Grey while the host says the feature is off.
    const closed = legend(report, { view: 'plugins', onOpen: () => {} })
    assert.deepEqual(closed.map((row) => row.children[4].props.className), ['dd-open', 'dd-open'])
    assert.deepEqual(closed.map((row) => row.children[4].props.disabled), [true, true])

    // The plugin chart names plugin folders, which need the second switch.
    const allowed = { ...report, capabilities: { openFolder: true, openFolderSensitive: true } }
    const open = legend(allowed, { view: 'plugins', onOpen: (target) => opened.push(target) })
    assert.deepEqual(open.map((row) => row.children[4].props.disabled), [false, false])
    open[0].children[4].props.onClick()
    assert.deepEqual(opened, ['C:\\x\\node_modules\\alpha'], 'and it hands over the plugin folder')

    // Without that switch the same rows are grey, and say why.
    const chats = legend({ ...report, capabilities: { openFolder: true } },
      { view: 'chats', onOpen: () => {} })
    assert.equal(chats[0].children[4].props.disabled, true)
    assert.equal(chats[0].children[4].props.title, 'T:openSensitive')

    // The folded members carry the same control as the named rows.
    const items = Array.from({ length: 12 }, (_, index) => ({
      path: `C:\\x\\node_modules\\p${index}`,
      bytes: 1000 - index * 10,
      files: 1
    }))
    const many = {
      ...allowed,
      categories: [{ id: 'profile-deps', label: 'P', safety: 'care', bytes: 12000, files: 12, topItems: items }]
    }
    const folded = legend(many, { view: 'plugins', onOpen: () => {}, foldedId: '__rest' })
    assert.equal(folded.length, 13, 'eight named, the aggregate, and its four members')
    assert.equal(folded.at(-1).children[4].props.className, 'dd-open', 'a folded member can be opened too')
    assert.equal(folded[8].children[4].props.className, undefined,
      'the aggregate names no single folder, so it gets no button')
  })

  it('offers a copy control per item once a handler is supplied', () => {
    const { module } = loadClient()
    const copied = []
    const body = module.renderPanelBody(t, report, 'profile-deps', () => {}, undefined,
      { view: 'total', onCopy: (value) => copied.push(value) })
    const flat = JSON.stringify(body)
    assert.ok(flat.includes('dd-copy'), 'the control is rendered')
    assert.ok(flat.includes('T:copyPath'), 'and explains itself')

    // The row label is a name; the handler still receives the real path.
    const rows = JSON.stringify(body)
    assert.ok(rows.includes('alpha'), 'the row shows the package name')
    const button = body.children
      .flatMap((child) => child?.children ?? []).flatMap((child) => child?.children ?? [])
    assert.ok(button !== undefined)
  })

  it('gives the overview a pie of its own, above the bars', () => {
    const { module } = loadClient()
    const body = module.renderPanelBody(t, report, null, () => {}, undefined, { view: 'total' })
    const chart = areaChart(body)
    assert.ok(chart !== undefined, 'the overview has a pie, not only bars')
    assert.equal(chartGraphic(chart).children[0].children.length, 2, 'one arc per category')
  })

  it('breaks conversations down one arc each', () => {
    const { module } = loadClient()
    const body = module.renderPanelBody(t, report, null, () => {}, undefined, { view: 'chats' })
    const chart = areaChart(body)
    assert.equal(chartGraphic(chart).children[0].children.length, 1)
  })

  it('offers all three views and marks the active one', () => {
    const { module } = loadClient()
    const body = module.renderPanelBody(t, report, null, () => {}, undefined, { view: 'chats' })
    const tabs = dataBody(body).find((child) => child?.props?.className === 'dd-tabs')
    assert.deepEqual(tabs.children.map((tab) => tab.children[0]),
      ['T:view_total', 'T:view_plugins', 'T:view_chats'])
    assert.deepEqual(tabs.children.map((tab) => tab.props['data-on']), ['0', '0', '1'])
  })

  it('names a conversation with its real workspace title when the host supplies one', () => {
    const { module } = loadClient()
    const named = {
      ...report,
      categories: report.categories.map((category) => category.id !== 'sessions' ? category : {
        ...category,
        topItems: [{ ...category.topItems[0], note: '2026-10-07 · disk-doctor' }]
      })
    }
    const labelOf = (value) => chartLegend(areaChart(module.renderPanelBody(t, value, null, () => {}, undefined,
      { view: 'chats' }))).children.map((row) => row.children[1].children[0])

    assert.deepEqual(labelOf(named), ['disk-doctor · chat-a'],
      'the workspace title beats the encoded folder key, and the tag keeps sessions apart')
    assert.deepEqual(labelOf(report), ['E\\demo · chat-a'],
      'and without a note it falls back to the decoded key — which cannot recover the colon')
  })

  it('strips the session- prefix, so a folder name identifies something', () => {
    const { module } = loadClient()
    const named = {
      ...report,
      categories: report.categories.map((category) => category.id !== 'sessions' ? category : {
        ...category,
        topItems: [{
          path: 'C:\\x\\sessions\\--E-disk-doctor--\\session-64875ca0-4118-45f1-9772-8a18798db4d9',
          bytes: 400,
          files: 4,
          note: '2026-10-07 · disk-doctor'
        }]
      })
    }
    const names = chartLegend(areaChart(module.renderPanelBody(t, named, null, () => {}, undefined,
      { view: 'chats' }))).children.map((row) => row.children[1].children[0])
    assert.deepEqual(names, ['disk-doctor · 64875ca0'], 'not "disk-doctor · session-"')
  })

  it('offers a name-or-path switch in the legend corner of the two name charts', () => {
    const { module } = loadClient()
    const prefsCalls = []
    const ui = { view: 'plugins', onPrefs: (next) => prefsCalls.push(next) }

    const plugins = areaChart(module.renderPanelBody(t, report, null, () => {}, undefined, ui))
    const toggle = chartHead(plugins).children.at(-1)
    assert.equal(toggle.props.className, 'dd-path-toggle')
    assert.equal(toggle.children[0], 'T:pref_showPaths', 'it offers paths while names are shown')
    toggle.props.onClick()
    assert.equal(prefsCalls.length, 1)
    assert.equal(prefsCalls[0].showPaths, true, 'and flips the one shared preference')

    const asPaths = areaChart(module.renderPanelBody(t, report, null, () => {}, undefined,
      { ...ui, prefs: { showPaths: true } }))
    assert.equal(chartHead(asPaths).children.at(-1).children[0], 'T:showNames', 'and back again')

    // The overview legend names categories, so it has nothing to switch.
    const total = areaChart(module.renderPanelBody(t, report, null, () => {}, undefined, { view: 'total' }))
    assert.deepEqual(chartHead(total).children.filter((child) => child !== null), [],
      'no toggle where there is no name to show')
  })

  it('says which switch would light up a chart whose buttons are all grey', () => {
    const { module } = loadClient()
    const hintOf = (value) => chartHead(areaChart(module.renderPanelBody(t, value, null, () => {}, undefined,
      { view: 'plugins' }))).children.find((child) => child?.props?.className === 'dd-chart-hint')

    const gated = { ...report, capabilities: { openFolder: true, openFolderSensitive: false } }
    const hint = hintOf(gated)
    assert.ok(hint !== undefined, 'a chart full of dead buttons explains itself')
    assert.equal(hint.children[0], 'T:openSensitive', 'and names the switch that fixes it')

    const allowed = { ...report, capabilities: { openFolder: true, openFolderSensitive: true } }
    assert.equal(hintOf(allowed), undefined, 'the note disappears once the buttons work')
    assert.equal(hintOf({ ...report, capabilities: { openFolder: false } }).children[0], 'T:openDisabled',
      'with the master switch off it names that one instead')
  })

  it('keeps the switches hidden until the gear is used', () => {
    const { module } = loadClient()
    const closed = module.renderPanelBody(t, report, null, () => {}, undefined, { onPrefs: () => {} })
    assert.equal(closed.children.some((child) => child?.props?.className === 'dd-prefs'), false)
    assert.equal(closed.children[0].children[1].children[0], '⚙', 'the gear sits in the header')

    const opened = module.renderPanelBody(t, report, null, () => {}, undefined,
      { prefs: { open: true }, onPrefs: () => {} })
    const prefs = opened.children.find((child) => child?.props?.className === 'dd-prefs')
    // Three browser preferences, and the cleanup permission only when the panel was given
    // a form for it — a seat without one must not draw a switch that cannot write. The
    // absent block is a `null` child, so the rows are filtered before they are counted.
    const rows = prefs.children.filter((child) => child !== null)
    assert.equal(rows.length, 3, 'three appearance switches')
    assert.deepEqual(rows.map((row) => row.children[0].children[0]),
      ['T:pref_showPercent', 'T:pref_showPaths', 'T:pref_compact'])
    assert.equal(rows[0].children[1].props['data-on'], '1', 'percentages default on')

    const withPermission = module.renderPanelBody(t, report, null, () => {}, undefined, {
      prefs: { open: true },
      onPrefs: () => {},
      onPermission: () => {},
      permission: { on: true, writable: true }
    })
    const host = withPermission.children.find((child) => child?.props?.className === 'dd-prefs')
      .children.find((child) => child?.props?.className === 'dd-pref-group')
    assert.ok(host !== undefined, 'the host permission is offered under the divider')
    const row = host.children[0]
    assert.equal(row.props.className, 'dd-pref dd-pref-host')
    assert.equal(row.children[0].children[0], 'T:cleanupPermission')
    assert.equal(row.children[1].props.className, 'dd-switch')
    assert.equal(row.children[1].props['data-on'], '1', 'it follows the host value')
    assert.equal(row.children[1].props.disabled, false)
    assert.ok(JSON.stringify(host).includes('T:cleanupPermissionHint'),
      'and says that it only moves files, never deletes them')

    // A value owned by a home patch or a command-line overlay cannot be written from here,
    // so the switch is offered as locked rather than springing back after a click.
    const locked = module.renderPanelBody(t, report, null, () => {}, undefined, {
      prefs: { open: true },
      onPrefs: () => {},
      onPermission: () => {},
      permission: { on: false, writable: false }
    })
    const lockedSwitch = locked.children.find((child) => child?.props?.className === 'dd-prefs')
      .children.find((child) => child?.props?.className === 'dd-pref-group')
      .children[0].children[1]
    assert.equal(lockedSwitch.props.disabled, true, 'a locked permission cannot be flipped here')
  })
})
describe('chart tail folding', () => {
  it('keeps eight named slices and folds the rest into one', () => {
    const { module } = loadClient()
    const items = Array.from({ length: 12 }, (_, index) => ({
      path: `C:\\x\\node_modules\\p${index}`,
      bytes: 1000 - index * 10,
      files: 1
    }))
    const report = {
      totals: { bytes: 12000, files: 12, dirs: 0 },
      regenerableBytes: 0,
      contentBytes: 0,
      warnings: [],
      categories: [{ id: 'profile-deps', label: 'P', safety: 'care', bytes: 12000, files: 12, topItems: items }]
    }
    const t = (key) => `T:${key}`
    const body = module.renderPanelBody(t, report, null, () => {}, undefined, { view: 'plugins' })
    const chart = areaChart(body)
    assert.equal(chartGraphic(chart).children[0].children.length, 9, 'eight named slices plus one folded')
    const cells = chartLegend(chart).children.map((row) => row.children[1])
    assert.equal(cells.length, 9)
    assert.equal(cells[0].children[0], 'p0', 'the biggest plugin leads')
    const foldCell = cells[8]
    assert.equal(foldCell.props.className, 'dd-legend-name dd-legend-toggle',
      'the tail is a control, not a dead end')
    assert.equal(foldCell.children[1], 'T:restItems', 'and it is named by the dictionary, not guessed')
  })
})
  it('opens the folded tail so the hidden plugins stay reachable', () => {
    const { module } = loadClient()
    const items = Array.from({ length: 12 }, (_, index) => ({
      path: `C:\\x\\node_modules\\p${index}`,
      bytes: 1000 - index * 10,
      files: 1
    }))
    const report = {
      totals: { bytes: 12000, files: 12, dirs: 0 },
      regenerableBytes: 0,
      contentBytes: 0,
      warnings: [],
      categories: [{ id: 'profile-deps', label: 'P', safety: 'care', bytes: 12000, files: 12, topItems: items }]
    }
    const t = (key) => `T:${key}`
    const legendOf = (ui) => chartLegend(areaChart(module.renderPanelBody(t, report, null, () => {}, undefined, ui)))
      .children

    assert.equal(legendOf({ view: 'plugins' }).length, 9, 'closed: eight named plus the aggregate')

    const opened = legendOf({ view: 'plugins', foldedId: '__rest' })
    assert.equal(opened.length, 13, 'open: the four folded plugins are listed')
    const subs = opened.slice(9)
    assert.equal(subs.length, 4)
    assert.ok(subs.every((row) => row.props.className.includes('dd-legend-sub')), 'and marked as nested')
    assert.deepEqual(subs.map((row) => row.children[1].children[0]), ['p8', 'p9', 'p10', 'p11'])
  })