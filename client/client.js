/**
 * `dsh-disk-doctor` — browser half.
 *
 * Contributes two things to the web client:
 *
 * 1. **A resident panel** in the right sidebar: how much disk DSH uses, shown as
 *    three side-by-side boxes — the data folder, the application install, and the
 *    system caches — each with its own figure, one bar per kind of content, and,
 *    when a bar is opened, the largest folders inside it. It reads the host's local
 *    `/dsh-disk-doctor/report` route, so nothing is scanned in the browser.
 * 2. **A settings page** on the bundle's own page under Plugins, over every field
 *    the host exposes for the `disk-doctor` entry.
 *
 * The copy is written for someone who wants to know why their disk filled up, not
 * for someone who knows what a projection cache is: every group gets a plain name
 * and a sentence saying whether it is safe to remove.
 *
 * The client bundle uses the web client's own module format rather than ESM, so
 * this file is plain `react.createElement` — no JSX, no build step.
 */
window.__ModuleLoader__.load({
  id: 'dsh-disk-doctor',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const react = require('react')
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')

    const { SettingsForm, SettingsValueField, SettingsFormModel, settingsTextField, settingsNumberField } = primitives
    const h = react.createElement

    /** The settings namespace this page edits: the plugin's profile entry id. */
    const NS = 'disk-doctor'
    /** Dictionary namespace owned by this plugin. */
    const LOCALE_NS = 'dsh-disk-doctor'
    /** The bundle's package name — the key `plugins.bundle.config` addresses. */
    const BUNDLE = 'dsh-disk-doctor'
    /** Sidebar tab identity; unique across every registration. */
    const TAB_ID = 'dsh-disk-doctor:space'
    /** Sidebar tab kind, used to open the panel. */
    const TAB_KIND = 'disk-doctor'
    /** The host's read-only report route. A test keeps this in step with `lib/serve.js`. */
    const REPORT_ROUTE = '/dsh-disk-doctor/report'
    /** The host's route that reveals one folder. A test keeps this in step too. */
    const OPEN_ROUTE = '/dsh-disk-doctor/open'
    /** The host's read-only cleanup preview route. */
    const CLEANUP_ROUTE = '/dsh-disk-doctor/cleanup'
    /** How many entries the panel asks for per group. */
    const PANEL_TOP = 15
    /** Auto-open the panel once per browser session, so closing it stays closed. */
    const OPENED_KEY = 'dsh-disk-doctor:panel-opened'
    /** The three safety levels, in the order the dots and the colour key list them. */
    const LEVELS = ['safe', 'care', 'keep']
    /** How many preview items the panel spells out before summarising the rest. */
    const PREVIEW_ROWS = 12

    const STYLE_ID = 'dsh-disk-doctor-styles'
    const CSS = `
.dd-panel { display: flex; flex-direction: column; height: 100%; min-height: 0; font-size: 13px; color: var(--dsw-alias-label-primary, inherit); }
.dd-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 14px 14px 18px; }
.dd-total-label { font-size: 12px; color: var(--dsw-alias-label-tertiary, #888); }
.dd-sub { margin-top: 3px; font-size: 12px; color: var(--dsw-alias-label-tertiary, #888); }
.dd-pill { display: inline-flex; align-items: center; margin-top: 10px; padding: 4px 9px; border-radius: 999px; font-size: 12px; background: var(--dsw-alias-state-success-tertiary, rgba(80,180,120,.14)); color: var(--dsw-alias-state-success-primary, #2f9e63); }
.dd-actions { display: flex; gap: 8px; margin: 14px 0 2px; }
.dd-btn { appearance: none; border: 0; border-radius: 8px; padding: 6px 12px; font: inherit; font-size: 12px; cursor: pointer; background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.14)); color: var(--dsw-alias-label-primary, inherit); }
.dd-btn:hover { background: var(--dsw-alias-interactive-bg-active, rgba(127,127,127,.24)); }
.dd-list { margin-top: 12px; display: flex; flex-direction: column; }
.dd-row { display: grid; grid-template-columns: 1fr auto; align-items: center; }
.dd-row-head { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 10px; width: 100%; padding: 8px; border: 0; background: none; font: inherit; color: inherit; text-align: left; cursor: pointer; border-radius: 8px; }
.dd-row-head:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12)); }
.dd-row-name { display: flex; align-items: center; gap: 4px; font-size: 13px; min-width: 0; }
.dd-chev { width: 12px; flex: 0 0 auto; color: var(--dsw-alias-label-caption, #999); font-size: 9px; transition: transform .12s ease; }
.dd-chev[data-open="1"] { transform: rotate(90deg); }
.dd-dot { width: 7px; height: 7px; flex: 0 0 auto; border-radius: 999px; margin-right: 5px; }
.dd-dot[data-level="safe"] { background: var(--dsw-alias-state-success-primary, #2f9e63); }
.dd-dot[data-level="care"] { background: var(--dsw-alias-state-warn-primary, #a9741a); }
.dd-dot[data-level="keep"] { background: var(--dsw-alias-label-caption, #999); }
.dd-from { margin-top: 6px; line-height: 1.5; }
.dd-scope { margin-top: 16px; font-size: 11px; line-height: 1.6; color: var(--dsw-alias-label-caption, #999); }
.dd-section { margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.18)); }
.dd-section-title { margin-bottom: 4px; font-size: 12px; font-weight: 600; letter-spacing: .01em; color: var(--dsw-alias-label-secondary, #666); }
.dd-summary { padding-bottom: 4px; }
.dd-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
.dd-top-title { font-size: 13px; font-weight: 600; }
.dd-gear { appearance: none; border: 0; background: none; cursor: pointer; color: var(--dsw-alias-label-secondary, #666); font-size: 15px; line-height: 1; padding: 2px 5px; border-radius: 6px; }
.dd-gear:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.14)); }
.dd-prefs { display: flex; flex-direction: column; gap: 9px; margin-bottom: 14px; padding: 10px 11px; border-radius: 8px; background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.08)); }
.dd-pref { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 12px; color: var(--dsw-alias-label-secondary, #666); }
.dd-pref-group { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; padding-top: 9px; border-top: 1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,.22)); }
.dd-pref-host span { color: var(--dsw-alias-label-primary, #333); }
.dd-pref-group .dd-setting-hint { margin: 0; }
.dd-switch { appearance: none; flex: 0 0 auto; width: 34px; height: 19px; padding: 0; border: 0; border-radius: 999px; cursor: pointer; position: relative; background: var(--dsw-alias-bg-layer-4, rgba(127,127,127,.32)); transition: background .15s ease; }
.dd-switch[data-on="1"] { background: var(--dsw-alias-brand-primary, #4a7cff); }
.dd-switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 15px; height: 15px; border-radius: 999px; background: var(--dsw-alias-switch-thumb, #fff); transition: transform .15s ease; }
.dd-switch[data-on="1"]::after { transform: translateX(15px); }
.dd-tabs { display: flex; flex-wrap: wrap; gap: 4px; margin: 20px 0 12px; padding-top: 14px; border-top: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.18)); }
.dd-overview { margin-bottom: 16px; }
.dd-tab { appearance: none; border: 0; background: none; cursor: pointer; font: inherit; font-size: 12px; padding: 4px 9px; border-radius: 999px; color: var(--dsw-alias-label-secondary, #666); }
.dd-tab:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12)); }
.dd-tab[data-on="1"] { background: var(--dsw-alias-interactive-bg-active, rgba(127,127,127,.24)); color: var(--dsw-alias-label-primary, inherit); font-weight: 500; }
.dd-chart { display: flex; flex-direction: column; align-items: center; gap: 14px; }
.dd-chart-head { display: flex; align-items: center; justify-content: flex-end; gap: 8px; width: 100%; }
.dd-chart-hint { flex: 1 1 auto; font-size: 11px; line-height: 1.5; color: var(--dsw-alias-state-warn-primary, #a9741a); }
.dd-path-toggle { appearance: none; border: 0; background: none; cursor: pointer; font: inherit; font-size: 11px; padding: 2px 7px; border-radius: 999px; color: var(--dsw-alias-label-secondary, #666); background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12)); }
.dd-path-toggle:hover { background: var(--dsw-alias-interactive-bg-active, rgba(127,127,127,.24)); }
.dd-donut { width: 132px; height: 132px; display: block; }
.dd-legend { width: 100%; display: flex; flex-direction: column; gap: 7px; }
.dd-legend-row { display: grid; grid-template-columns: 8px 1fr auto auto auto auto; gap: 8px; align-items: center; font-size: 12px; }
.dd-legend-dot { width: 8px; height: 8px; border-radius: 999px; }
.dd-legend-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-secondary, #666); }
.dd-legend-pct { color: var(--dsw-alias-label-caption, #999); font-variant-numeric: tabular-nums; }
.dd-legend-size { color: var(--dsw-alias-label-secondary, #666); font-variant-numeric: tabular-nums; }
.dd-legend-toggle { appearance: none; border: 0; background: none; cursor: pointer; font: inherit; font-size: 12px; padding: 0; text-align: left; color: var(--dsw-alias-label-secondary, #666); display: flex; align-items: center; gap: 2px; min-width: 0; }
.dd-legend-toggle:hover { color: var(--dsw-alias-label-primary, inherit); }
.dd-legend-sub { padding-left: 14px; opacity: .85; }
.dd-legend-sub .dd-legend-name { font-size: 11px; }
.dd-panel[data-compact="1"] .dd-row-head { padding: 5px 8px; }
.dd-panel[data-compact="1"] .dd-note, .dd-panel[data-compact="1"] .dd-scope, .dd-panel[data-compact="1"] .dd-area-note, .dd-panel[data-compact="1"] .dd-color-help { display: none; }
.dd-row-size { font-size: 12px; color: var(--dsw-alias-label-secondary, #666); font-variant-numeric: tabular-nums; }
.dd-bar { height: 6px; margin: 0 8px 6px; border-radius: 999px; background: var(--dsw-alias-bg-layer-3, rgba(127,127,127,.16)); overflow: hidden; }
.dd-bar > i { display: block; height: 100%; border-radius: 999px; background: var(--dsw-alias-brand-primary, #4a7cff); }
.dd-note { padding: 2px 8px 8px 24px; font-size: 12px; line-height: 1.55; color: var(--dsw-alias-label-tertiary, #888); }
.dd-items { margin: 0 8px 12px 26px; padding-left: 10px; border-left: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.2)); display: flex; flex-direction: column; gap: 7px; }
.dd-item { display: grid; grid-template-columns: 1fr auto auto auto; gap: 8px; align-items: baseline; }
.dd-copy { appearance: none; border: 0; background: none; cursor: pointer; font: inherit; font-size: 11px; padding: 0 4px; border-radius: 4px; color: var(--dsw-alias-link, #4a7cff); }
.dd-copy:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.14)); }
.dd-item-path { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-secondary, #666); }
.dd-item-size { font-size: 11px; color: var(--dsw-alias-label-caption, #999); font-variant-numeric: tabular-nums; }
.dd-empty { padding: 28px 10px; text-align: center; color: var(--dsw-alias-label-tertiary, #888); font-size: 12px; line-height: 1.7; }
.dd-warn { margin-top: 14px; padding: 8px 10px; border-radius: 8px; font-size: 12px; line-height: 1.5; background: var(--dsw-alias-state-warn-tertiary, rgba(220,160,60,.14)); color: var(--dsw-alias-state-warn-primary, #a9741a); }
.dd-advanced { margin-top: 6px; border-top: 0.5px solid var(--dsw-alias-border-l2, rgba(127,127,127,.2)); }
.dd-advanced > summary { padding: 12px 0; cursor: pointer; font-size: 12px; color: var(--dsw-alias-label-secondary, #666); list-style: none; }
.dd-advanced > summary::-webkit-details-marker { display: none; }
.dd-advanced > summary::before { content: '▸ '; }
.dd-advanced[open] > summary::before { content: '▾ '; }
.dd-area { margin-top: 18px; padding: 12px 10px 10px; border-radius: 12px; border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.18)); background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.06)); }
.dd-area-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; padding: 0 2px; }
.dd-area-title { font-size: 12px; font-weight: 600; letter-spacing: .02em; color: var(--dsw-alias-label-secondary, #666); }
.dd-area-size { font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
.dd-area[data-lead="1"] .dd-area-size { font-size: 26px; }
.dd-area-note { margin-top: 4px; font-size: 11px; line-height: 1.55; color: var(--dsw-alias-label-caption, #999); }
.dd-open { appearance: none; border: 0; background: none; cursor: pointer; font: inherit; font-size: 11px; padding: 0 4px; border-radius: 4px; color: var(--dsw-alias-link, #4a7cff); }
.dd-open:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.14)); }
.dd-open:disabled { color: var(--dsw-alias-label-caption, #999); opacity: .5; cursor: default; }
.dd-link-installs { margin-top: 8px; padding: 8px 9px; border-radius: 8px; font-size: 12px; line-height: 1.6; background: var(--dsw-alias-state-warn-tertiary, rgba(220,160,60,.12)); color: var(--dsw-alias-label-secondary, #666); }
.dd-color-help { margin-top: 18px; padding: 10px 11px; border-radius: 8px; background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.06)); }
.dd-cleanup { margin-top: 18px; padding: 10px 11px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.18)); }
.dd-cleanup-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.dd-cleanup-size { font-size: 18px; }
.dd-cleanup-line { margin-top: 6px; font-size: 11px; line-height: 1.55; color: var(--dsw-alias-label-secondary, #666); }
.dd-cleanup-target { color: var(--dsw-alias-label-caption, #999); word-break: break-all; }
.dd-cleanup-items { margin-top: 8px; display: flex; flex-direction: column; gap: 5px; }
.dd-cleanup-warn { color: var(--dsw-alias-state-warn-primary, #a9741a); }
.dd-cleanup-confirm { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 8px 9px; border-radius: 8px; background: var(--dsw-alias-state-warn-tertiary, rgba(220,160,60,.14)); color: var(--dsw-alias-state-warn-primary, #a9741a); }
.dd-cleanup-moved { margin-top: 10px; padding: 8px 9px; border-radius: 8px; background: var(--dsw-alias-state-success-tertiary, rgba(80,180,120,.12)); }
.dd-cleanup-batches { margin-top: 10px; padding: 8px 9px; border-radius: 8px; background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.08)); }
.dd-btn-danger { background: var(--dsw-alias-state-warn-primary, #a9741a); color: #fff; }
.dd-btn-danger:hover { background: var(--dsw-alias-state-warn-primary, #a9741a); opacity: .88; }
.dd-cleanup-plan { margin-top: 10px; padding: 8px 9px; border-radius: 8px; background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.08)); }
.dd-cleanup-plan-step { margin-top: 5px; font-size: 11px; line-height: 1.5; color: var(--dsw-alias-label-secondary, #666); }
.dd-guide { margin-top: 18px; padding: 10px 11px; border-radius: 8px; background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.06)); }
.dd-guide-line { margin-top: 6px; font-size: 11px; line-height: 1.55; color: var(--dsw-alias-label-secondary, #666); }
.dd-color-row { display: flex; align-items: flex-start; gap: 6px; margin-top: 6px; font-size: 11px; line-height: 1.5; color: var(--dsw-alias-label-secondary, #666); }
.dd-color-row .dd-dot { margin-top: 4px; }
.dd-setting { margin-top: 12px; }
.dd-setting-row { display: flex; align-items: center; gap: 10px; }
.dd-setting-label { flex: 1 1 auto; font-size: 13px; }
.dd-setting-hint { margin-top: 4px; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary, #888); }
.dd-reset { appearance: none; border: 0; background: none; cursor: pointer; font: inherit; font-size: 11px; padding: 0 5px; border-radius: 4px; color: var(--dsw-alias-link, #4a7cff); }
.dd-reset:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.14)); }
.dd-badge { font-size: 10px; padding: 1px 5px; border-radius: 999px; background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.16)); color: var(--dsw-alias-label-secondary, #666); }
`

    /** Install the panel's stylesheet once, however often the module reloads. */
    function installStyles () {
      if (typeof document === 'undefined' || document.getElementById(STYLE_ID) !== null) return
      const element = document.createElement('style')
      element.id = STYLE_ID
      // The web client tracks plugin-owned styles by these two attributes: without them a
      // reload leaves the stale sheet in place (the id lookup above matches it again), and
      // another plugin's claim can sweep this sheet away with its own.
      element.dataset.plugin = BUNDLE
      element.dataset.pluginCss = `${BUNDLE}/panel.css`
      element.textContent = CSS
      document.head.appendChild(element)
    }

    /** Simplified Chinese copy. Plain words only. */
    const zh = {
      title: '磁盘空间',
      panelTitle: '磁盘空间',
      description: '看看 DSH 占了多少磁盘、都占在哪，以及哪些可以安全清理。',
      totalLabel: 'DSH 的数据占了',
      scopeNote: '分成三个区看：DSH 自己的数据文件夹、DSH 程序的安装目录、以及 DSH 用到的系统缓存。' +
        '三个区各自独立，不能相加——「系统缓存」里的 pnpm 仓库和「DSH 数据」里的插件文件其实是同一批物理文件。',
      open: '打开',
      openHint: '在文件管理器里打开它所在的文件夹',
      openDisabled: '要打开文件夹，得先去设置里把「允许打开文件夹」打开',
      openSensitive: '这类位置要先在设置里打开「允许打开需谨慎处理的位置」',
      openCopyOnly: '这个位置打不开，可以复制路径自己去看',
      openFailed: '没能打开（{reason}）',
      linkInstallsTitle: '链接安装的插件（真实文件在别处，不计入上面的数字）',
      sectionTitle: '各类占用',
      settings: '外观设置',
      view_total: '总览',
      view_plugins: '按插件',
      view_chats: '按聊天记录',
      pref_showPercent: '显示百分比',
      pref_showPaths: '显示完整路径',
      showNames: '显示名称',
      pathToggleHint: '在这个图例里切换：显示名称，还是显示完整路径',
      chartGatedHint: '这一页的位置属于 🟠「要谨慎处理」或 ⚪「不要动」，' +
        '要在设置里打开「允许打开需谨慎处理的位置」才能点开',
      restItems: '其他 {count} 项',
      copy: '复制',
      copyPath: '复制完整路径到剪贴板',
      pref_compact: '紧凑模式',
      files: '{count} 个文件',
      scanning: '正在统计…',
      scanningHint: '第一次可能要几秒钟。',
      failed: '没能读取磁盘信息。',
      retry: '重试',
      refresh: '重新统计',
      cleanable: '其中 {size} 可以安全清理',
      cleanableHint: '这些是 DSH 能自己重新生成的临时文件，清理不影响使用。',
      keep: '剩下的 {size} 请不要动（里面是 DSH 程序本体、运行环境，还有你的对话）',
      careLine: '还有 {size} 需要正确操作才能省下——比如去卸载不用的插件，而不是手动删文件。',
      from: '（来自 {list}）',
      level_safe: '可以安全清理',
      level_care: '要谨慎处理',
      level_keep: '不要动',
      colorHelpTitle: '颜色说明',
      color_safe: 'DSH 自己能重新生成的，清理不影响使用',
      color_care: '能用正确方法省下的，比如去卸载不用的插件，而不是手动删文件',
      color_keep: 'DSH 运行需要的，以及你自己的对话和附件，删了会出问题',
      cleanupTitle: '清理',
      cleanupPreview: '看看会移动什么',
      cleanupPreviewAgain: '重新列一次',
      cleanupLoading: '正在列清单…',
      cleanupFailed: '没能列出清单。',
      cleanupNothing: '现在没有「可以安全清理」的内容，没东西可清。',
      cleanupSummary: '可以安全清理 {size}，来自 {list}',
      cleanupMoves: '会移动 {count} 项，共 {size}',
      cleanupTarget: '移动到：{path}',
      cleanupDryRun: '这一步只列清单，**不会移动任何文件**。',
      cleanupPlanTitle: '第二步会这样做',
      cleanupPlan1: '① 先移动到回收站文件夹，不是真删',
      cleanupPlan2: '② 你重启 DSH、用一会儿，确认一切正常',
      cleanupPlan3: '③ 有问题就一键撤销、按清单移回原处；确认无碍再自己清空那个文件夹',
      cleanupMore: '…另有 {count} 项未列出',
      cleanupMove: '移动到回收站',
      cleanupMoveDisabled: '要在上方的 ⚙ 里打开「允许清理」才能真的移动（现在只能列清单）',
      cleanupMoveFailed: '移动没成功：{reason}',
      cleanupStaleHost: '宿主还是旧版本（这个接口还不存在）——重启 DSH 之后再试一次',
      cleanupHostGone: '没能连上宿主，稍后再试一次',
      cleanupPermission: '允许清理（移动到回收站）',
      cleanupPermissionHint: '只移动、绝不删除，随时可一键撤销',
      cleanupPermissionLocked: '这个设置被上层配置锁定了，改不了',
      cleanupConfirm: '确定移动这 {count} 项（共 {size}）吗？',
      cleanupConfirmYes: '确定，移动',
      cleanupConfirmNo: '取消',
      cleanupMoved: '已移动到回收站：{count} 项，共 {size}',
      cleanupMovedHint: '接下来：重启 DSH、用一会儿。有问题就点「撤销」，它会按清单把东西移回原处。',
      cleanupMovedNothing: '这次没有可移动的内容。',
      cleanupUndo: '撤销',
      cleanupUndoDone: '已移回 {count} 项，共 {size}',
      cleanupUndoPartial: '有 {count} 项没能移回（原位置被占用或已不在回收站里），清单里写明了原因，剩下的已经回去了',
      cleanupUndoFailed: '撤销没能完成：{reason}',
      cleanupBatchesTitle: '回收站里的批次',
      cleanupBatchLine: '{id}：{count} 项，共 {size}',
      cleanupBatchUndone: '{id}：已全部移回',
      cleanupEmptyHint: '确认一切正常后，自己清空那个回收站文件夹就行——这个插件不会替你删任何东西。',
      guideTitle: '想省更多空间？这样做才对',
      guideUninstall: '最大的插件是 {name}（{size}）——去插件页卸载不用的插件，别手动删文件',
      guidePrune: 'pnpm 仓库 {size}，其中约 {overlap} 与插件是同一批物理文件；' +
        '要用 pnpm store prune 才能真省下来（删插件目录可能几乎没变化）',
      guideLeaveAlone: '下面这些别动：自带运行环境、Electron 运行文件、程序安装目录、你的对话与附件',
      empty: '这里空空的，DSH 还没占什么磁盘。',
      noItems: '没有可列出的项目',
      area_data: 'DSH 数据',
      area_app: 'DSH 程序',
      area_cache: '系统缓存',
      cat_sessions: '聊天记录',
      cat_storages: '聊天索引',
      cat_profile_deps: '安装的插件',
      cat_profile_logs: '插件安装日志',
      cat_profile_market: '插件市场缓存',
      cat_plugin_cache: '插件下载缓存',
      cat_runtimes: 'DSH 自带的运行环境',
      cat_runtime_app: 'Electron 运行文件',
      cat_temp_spill: '临时文件',
      cat_attachments: '附件',
      cat_other: '其他',
      cat_app_install: '程序安装目录',
      cat_chromium_data: '桌面端用户数据',
      cat_pnpm_store: 'pnpm 内容仓库',
      // The third DSH installation the scan found: an npm-global copy, not the desktop app.
      cat_npm_global_dsh: 'npm 全局安装的 DSH',
      note_sessions: '你和 DSH 的对话记录。删掉就找不回来了，要谨慎。',
      note_storages: '让聊天记录能快速打开的索引。删掉会变慢，但能重新生成。',
      note_profile_deps: '你装的插件本体。想省空间应该去卸载插件，而不是删这里的文件。',
      note_profile_logs: '安装插件时留下的日志，只在排查问题时有用。可以清理。',
      note_profile_market: '插件市场缓存的页面数据。可以清理。',
      note_plugin_cache: '下载过的插件安装包。可以清理，再装会重新下载。',
      note_runtimes: 'DSH 自带的一套运行环境。删掉要重新下载才能用。',
      note_runtime_app: 'DSH 运行所依赖的 Electron 程序文件，放在数据文件夹里。删了 DSH 就打不开了，绝对不要动。',
      note_temp_spill: '临时文件，随时可以清理，DSH 会按需重建。',
      note_attachments: '你发给 DSH 的图片、文档等附件。',
      note_other: '不属于上面任何一类的文件。',
      note_app_install: 'DSH 程序的安装位置，卸载程序才会用到。只读展示，这里不提供清理。',
      note_chromium_data: '桌面窗口的登录状态、界面缓存。删掉要重新登录，界面会变慢一阵。',
      note_pnpm_store: 'pnpm 把插件文件存在这里，再硬链接进插件目录。' +
        '删掉插件目录可能几乎不释放空间，因为文件还在这里；反之亦然。要省空间用 pnpm store prune。',
      dshHome: '要检查哪个文件夹',
      dshHomeHint: '默认就是 DSH 自己的文件夹，一般不用改。',
      topN: '每类最多列出几条',
      topNHint: '在面板里展开某一类时最多显示几项。默认 10。',
      reportDir: '详细报告保存在哪里',
      reportDirHint: '留空就存在 DSH 文件夹里，一般不用改。',
      advanced: '高级选项（一般不用改）',
      excludeGlobs: '不想统计的文件夹',
      excludeGlobsHint: '多个路径用英文逗号隔开。写了就不统计它们。',
      followSymlinks: '跟随快捷方式',
      followSymlinksHint: '填 true 或 false，默认 false。改成 true 会重复计算大小，建议保持默认。',
      appDir: 'DSH 程序装在哪里',
      appDirHint: '留空就自动探测（按运行中的程序位置判断），一般不用填。填了就以你填的为准。',
      allowOpenFolder: '允许打开文件夹',
      allowOpenFolderHint: '默认开着。「可以安全清理」的位置可以直接点开；关掉后，面板上所有「打开」按钮都会变灰。',
      allowOpenFolderSensitive: '允许打开需谨慎处理的位置',
      allowOpenFolderSensitiveHint: '默认关着。打开后，「要谨慎处理」和「不要动」两档的位置也能点开——' +
        '包括你的对话目录和程序安装目录。',
      allowCleanup: '允许清理（移动到回收站）',
      allowCleanupHint: '默认关着。打开后，清理框里才会出现可点的「移动到回收站」按钮：' +
        '只移动、绝不删除，随时可以一键撤销。',
      overridden: '已改过',
      reset: '恢复默认',
      readOnly: '当前安装不允许修改设置。',
      unavailable: '这个插件还没加载好，暂时不能改设置。',
      save: '保存',
      saving: '保存中…',
      saveFailed: '没保存成功，请看填的内容。',
      invalidNumber: '请填数字；留空表示用默认值。',
      invalidBoolean: '请填 true 或 false；留空表示用默认值。'
    }

    /** English copy. */
    const en = {
      title: 'Disk space',
      panelTitle: 'Disk space',
      description: 'See how much disk DSH uses, where it goes, and what is safe to clean up.',
      totalLabel: 'DSH data is using',
      scopeNote: 'Three areas, side by side: DSH\'s own data folder, the application install folder, ' +
        'and the system caches DSH feeds. They are never added together — the pnpm store in the caches ' +
        'and the plugin files in the data folder are the same physical files.',
      open: 'Open',
      openHint: 'Open its folder in the file manager',
      openDisabled: 'Opening folders needs "Allow opening folders" switched on in the settings',
      openSensitive: 'This kind of location needs "Allow sensitive locations" in the settings first',
      openCopyOnly: 'This location cannot be opened; copy the path to look at it yourself',
      openFailed: 'Could not open it ({reason})',
      linkInstallsTitle: 'Link-installed plugins (the real files are elsewhere and are not in the figures above)',
      sectionTitle: 'Where the space goes',
      settings: 'Appearance',
      view_total: 'Overview',
      view_plugins: 'By plugin',
      view_chats: 'By conversation',
      pref_showPercent: 'Show percentages',
      pref_showPaths: 'Show full paths',
      showNames: 'Show names',
      pathToggleHint: 'Switch this legend between names and full paths',
      chartGatedHint: 'These rows are 🟠 caution or ⚪ do-not-touch: turn on ' +
        '"Allow opening sensitive locations" in the settings to open them',
      restItems: '{count} more',
      copy: 'Copy',
      copyPath: 'Copy the full path to the clipboard',
      pref_compact: 'Compact mode',
      files: '{count} files',
      scanning: 'Measuring…',
      scanningHint: 'The first run can take a few seconds.',
      failed: 'Could not read the disk information.',
      retry: 'Try again',
      refresh: 'Measure again',
      cleanable: '{size} of this is safe to clean up',
      cleanableHint: 'Temporary files DSH can rebuild by itself, so cleaning them breaks nothing.',
      keep: 'The remaining {size} should be left alone — the app itself, its runtime, and your conversations.',
      careLine: 'Another {size} can be reclaimed, but only the right way: uninstall the plugins you no longer use rather than deleting files.',
      from: ' (from {list})',
      level_safe: 'Safe to clean up',
      level_care: 'Handle with care',
      level_keep: 'Leave alone',
      colorHelpTitle: 'What the colours mean',
      color_safe: 'DSH can rebuild it by itself; cleaning breaks nothing',
      color_care: 'Reclaimable the right way — uninstall plugins you no longer use rather than deleting files',
      color_keep: 'Needed to run DSH, plus your own conversations and attachments; deleting breaks something',
      cleanupTitle: 'Cleanup',
      cleanupPreview: 'Show what would move',
      cleanupPreviewAgain: 'List it again',
      cleanupLoading: 'Listing…',
      cleanupFailed: 'Could not build the list.',
      cleanupNothing: 'Nothing is safe to clean up right now.',
      cleanupSummary: '{size} is safe to clean up, from {list}',
      cleanupMoves: '{count} items would move, {size} in total',
      cleanupTarget: 'Into: {path}',
      cleanupDryRun: 'This step only lists things — it **moves no files**.',
      cleanupPlanTitle: 'What the second step does',
      cleanupPlan1: '① Move things into a quarantine folder — nothing is really deleted',
      cleanupPlan2: '② You restart DSH and use it for a while to check everything still works',
      cleanupPlan3: '③ If something is wrong, one click moves everything back; once you are happy, you empty that folder yourself',
      cleanupMore: '…and {count} more not listed',
      cleanupMove: 'Move to quarantine',
      cleanupMoveDisabled: 'Turn on "Allow cleanup" in the ⚙ above to actually move anything (right now this only lists)',
      cleanupMoveFailed: 'The move did not work: {reason}',
      cleanupStaleHost: 'The host is still an older version (this endpoint does not exist yet) — restart DSH and try again',
      cleanupHostGone: 'Could not reach the host — try again in a moment',
      cleanupPermission: 'Allow cleanup (move to quarantine)',
      cleanupPermissionHint: 'It only moves, never deletes, and one click puts everything back',
      cleanupPermissionLocked: 'This setting is locked by a configuration above it',
      cleanupConfirm: 'Move these {count} items ({size})?',
      cleanupConfirmYes: 'Yes, move them',
      cleanupConfirmNo: 'Cancel',
      cleanupMoved: 'Moved to quarantine: {count} items, {size}',
      cleanupMovedHint: 'Next: restart DSH and use it for a while. If something is wrong, press Undo — it moves everything back from the manifest.',
      cleanupMovedNothing: 'There was nothing to move this time.',
      cleanupUndo: 'Undo',
      cleanupUndoDone: 'Moved {count} items back, {size}',
      cleanupUndoPartial: '{count} could not go back (the original spot is taken, or the copy is gone) — the manifest says why; the rest are back',
      cleanupUndoFailed: 'The undo did not go through: {reason}',
      cleanupBatchesTitle: 'Batches in quarantine',
      cleanupBatchLine: '{id}: {count} items, {size}',
      cleanupBatchUndone: '{id}: all moved back',
      cleanupEmptyHint: 'Once you are satisfied, empty that quarantine folder yourself — this plugin never deletes anything for you.',
      guideTitle: 'Want more space back? This is the right way',
      guideUninstall: 'The biggest plugin is {name} ({size}) — uninstall the ones you no longer use on the Plugins page rather than deleting files',
      guidePrune: 'The pnpm store is {size}, about {overlap} of it the same physical files as the plugins; ' +
        'only pnpm store prune really frees that (deleting the plugin folders may change almost nothing)',
      guideLeaveAlone: 'Leave these alone: the bundled runtime, the Electron runtime files, the application install folder, and your conversations and attachments',
      empty: 'Nothing here yet — DSH is barely using any disk.',
      noItems: 'Nothing to list',
      area_data: 'DSH data',
      area_app: 'DSH application',
      area_cache: 'System caches',
      cat_sessions: 'Chat history',
      cat_storages: 'Chat index',
      cat_profile_deps: 'Installed plugins',
      cat_profile_logs: 'Plugin install logs',
      cat_profile_market: 'Plugin market cache',
      cat_plugin_cache: 'Plugin download cache',
      cat_runtimes: 'Bundled runtime',
      cat_runtime_app: 'Electron runtime files',
      cat_temp_spill: 'Temporary files',
      cat_attachments: 'Attachments',
      cat_other: 'Other',
      cat_app_install: 'Application install folder',
      cat_chromium_data: 'Desktop user data',
      cat_pnpm_store: 'pnpm content store',
      // The third DSH installation the scan found: an npm-global copy, not the desktop app.
      cat_npm_global_dsh: 'DSH installed globally by npm',
      note_sessions: 'Your conversations with DSH. Deleting these is permanent, so be careful.',
      note_storages: 'An index that makes chat history open quickly. It can be rebuilt.',
      note_profile_deps: 'The plugins you installed. To free this space, uninstall plugins rather than deleting files.',
      note_profile_logs: 'Logs left by plugin installs, useful only for troubleshooting. Safe to clean.',
      note_profile_market: 'Cached pages from the plugin market. Safe to clean.',
      note_plugin_cache: 'Downloaded plugin packages. Safe to clean; they download again if needed.',
      note_runtimes: 'The runtime DSH ships with. Removing it means downloading it again.',
      note_runtime_app: 'The Electron program files DSH runs on, kept inside the data folder. Delete these and DSH will not start — leave them alone.',
      note_temp_spill: 'Temporary files. Always safe to clean; DSH rebuilds them as needed.',
      note_attachments: 'Images and documents you shared with DSH.',
      note_other: 'Files that do not belong to any of the groups above.',
      note_app_install: 'Where the DSH application is installed. Only uninstalling should touch this; it is read-only here.',
      note_chromium_data: 'Sign-in state and interface cache of the desktop window. Deleting means signing in again.',
      note_pnpm_store: 'pnpm keeps plugin files here and hard-links them into the plugin folders. ' +
        'Deleting the folders may free almost nothing, because the files still live here — and the reverse is also true.',
      dshHome: 'Which folder to look at',
      dshHomeHint: 'Defaults to the DSH folder. You normally do not need to change this.',
      topN: 'How many items to list',
      topNHint: 'How many entries to show when you open a group in the panel. Default 10.',
      reportDir: 'Where the full report is saved',
      reportDirHint: 'Leave blank to keep it inside the DSH folder.',
      advanced: 'Advanced (you normally do not need these)',
      excludeGlobs: 'Folders to leave out',
      excludeGlobsHint: 'Separate several paths with English commas. Anything listed is not measured.',
      followSymlinks: 'Follow shortcuts',
      followSymlinksHint: 'true or false, default false. Setting true double-counts sizes, so leave it alone.',
      appDir: 'Where DSH is installed',
      appDirHint: 'Leave blank to detect it from the running program. Anything you type wins over detection.',
      allowOpenFolder: 'Allow opening folders',
      allowOpenFolderHint: 'On by default. Rows marked safe to clean open straight away; switching this off greys out every Open button.',
      allowOpenFolderSensitive: 'Allow opening sensitive locations',
      allowOpenFolderSensitiveHint: 'Off by default. Switching it on also allows the "handle with care" and ' +
        '"leave alone" rows — your conversation folders and the application files.',
      allowCleanup: 'Allow cleanup (move to quarantine)',
      allowCleanupHint: 'Off by default. When on, the cleanup box gets a working "Move to quarantine" button: ' +
        'it only moves files, never deletes them, and one click puts everything back.',
      overridden: 'Changed',
      reset: 'Reset',
      readOnly: 'This installation does not allow settings changes.',
      unavailable: 'This plugin is not loaded yet, so its settings cannot be changed.',
      save: 'Save',
      saving: 'Saving…',
      saveFailed: 'That did not save. Please check the values.',
      invalidNumber: 'Enter a number, or leave blank for the default.',
      invalidBoolean: 'Enter true or false, or leave blank for the default.'
    }

    /**
     * Fill a `{placeholder}` template from a dictionary entry. The dictionary ships
     * plain strings, so sentences keep their own word order per language.
     * @param {string} template - the dictionary entry.
     * @param {object} values - the substitutions.
     * @returns {string} the finished sentence.
     */
    function fill (template, values) {
      return String(template).replace(/\{(\w+)\}/g, (match, key) => (key in values ? String(values[key]) : match))
    }

    /**
     * The colour key: what 🟢 / 🟠 / ⚪ actually mean.
     *
     * The panel is full of coloured dots and the settings page asks the reader to
     * decide about "the amber and grey ones", so the meaning is written down once and
     * shown in both places rather than left to a tooltip.
     *
     * @param t - the page's locale reader.
     * @returns the colour key block.
     */
    function colorHelp (t) {
      return h('div', { className: 'dd-color-help' },
        h('div', { className: 'dd-section-title' }, t('colorHelpTitle')),
        ...LEVELS.map((level) => h('div', { className: 'dd-color-row', key: level },
          h('span', { className: 'dd-dot', 'data-level': level }),
          h('span', {}, `${t(`level_${level}`)} —— ${t(`color_${level}`)}`))))
    }

    /** The frame's copy, read from the page's dictionary. */
    function formLabels (t) {
      return {
        unavailable: t('unavailable'),
        readOnly: t('readOnly'),
        saveFailed: t('saveFailed'),
        save: t('save'),
        saving: t('saving')
      }
    }

    /**
     * Scale a byte count into the largest unit that keeps it readable.
     * @param {number} bytes - the value.
     * @returns {string} for example `736 MB` or `1.2 GB`.
     */
    function size (bytes) {
      if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB'
      const units = [
        { suffix: 'TB', scale: 1024 ** 4 },
        { suffix: 'GB', scale: 1024 ** 3 },
        { suffix: 'MB', scale: 1024 ** 2 },
        { suffix: 'KB', scale: 1024 }
      ]
      for (const unit of units) {
        if (bytes >= unit.scale) {
          const value = bytes / unit.scale
          return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${unit.suffix}`
        }
      }
      return `${Math.round(bytes)} B`
    }

    /**
     * Shorten an absolute path to its last couple of segments: a wall of
     * `C:\Users\…` tells a reader nothing, while the tail identifies the folder.
     * @param {string} value - the full path.
     * @returns {string} the shortened label.
     */
    function shortPath (value) {
      if (typeof value !== 'string' || value === '') return ''
      const parts = value.split(/[\\/]/).filter((part) => part !== '')
      if (parts.length <= 2) return value
      return `…/${parts.slice(-2).join('/')}`
    }

    /** A boolean field. The shared control is a text input, so it carries a word. */
    function settingsBooleanField (field) {
      return {
        field,
        format: (value) => value === true ? 'true' : value === false ? 'false' : '',
        parse: (text) => {
          const trimmed = text.trim().toLowerCase()
          if (trimmed === '') return { kind: 'clear' }
          if (trimmed === 'true') return { kind: 'set', value: true }
          if (trimmed === 'false') return { kind: 'set', value: false }
          return undefined
        }
      }
    }

    /** A list-of-strings field, carried as a comma-separated draft. */
    function settingsListField (field) {
      return {
        field,
        format: (value) => Array.isArray(value) ? value.join(', ') : '',
        parse: (text) => {
          const items = text.split(',').map((item) => item.trim()).filter((item) => item !== '')
          return items.length === 0 ? { kind: 'clear' } : { kind: 'set', value: items }
        }
      }
    }

    /** A small palette that reads well on both light and dark themes. */
    const PALETTE = [
      'var(--dsw-alias-brand-primary)',
      'var(--dsw-alias-state-success-primary)',
      'var(--dsw-alias-state-warn-primary)',
      'var(--dsw-alias-state-business-primary)',
      'var(--dsw-alias-link)'
    ]

    /** The stroke colour for slice `index`; past the palette it fades rather than repeats. */
    function sliceColor (index) {
      return PALETTE[index % PALETTE.length]
    }

    /**
     * A donut chart, drawn as stroked arcs. No chart library: one `<circle>` per slice
     * with a dash pattern is the whole trick, and it stays crisp at any size.
     *
     * @param {Array<{id: string, bytes: number}>} slices - the parts, largest first.
     * @param {number} whole - the total the slices are a part of.
     * @returns the chart element, or null when there is nothing to draw.
     */
    function donut (slices, whole) {
      const RADIUS = 42
      const CIRCUMFERENCE = 2 * Math.PI * RADIUS
      if (!(whole > 0) || slices.length === 0) return null

      let offset = 0
      const arcs = slices.map((slice, index) => {
        const raw = (slice.bytes / whole) * CIRCUMFERENCE
        // A hair of gap keeps neighbouring slices legible; a floor keeps a tiny
        // slice from vanishing entirely.
        const dash = Math.max(raw - 1.5, 0.5)
        const arc = h('circle', {
          key: slice.id,
          cx: 50,
          cy: 50,
          r: RADIUS,
          fill: 'none',
          stroke: sliceColor(index),
          strokeWidth: 13,
          strokeDasharray: `${dash} ${CIRCUMFERENCE - dash}`,
          strokeDashoffset: -offset,
          opacity: index < PALETTE.length ? 1 : 0.55,
          transform: 'rotate(-90 50 50)'
        })
        offset += raw
        return arc
      })

      return h('svg', {
        className: 'dd-donut',
        viewBox: '0 0 100 100',
        role: 'img',
        'aria-label': 'share of total'
      }, ...arcs)
    }

    /**
     * The package name inside a plugin path: `…/node_modules/dsh-image-gen` becomes
     * `dsh-image-gen`, and a scoped package keeps its scope (`@scope/pkg`).
     *
     * A legend is unreadable when every entry starts with the same truncated
     * `…/node_modules/`; the name after it is the part a person recognises.
     *
     * @param {string} value - the package directory path.
     * @returns {string} the package name.
     */
    function pluginName (value) {
      const parts = String(value).split(/[\\/]/).filter((part) => part !== '')
      const last = parts[parts.length - 1] ?? String(value)
      const parent = parts[parts.length - 2]
      return parent !== undefined && parent.startsWith('@') ? `${parent}/${last}` : last
    }

    /**
     * A short, distinguishing tag for one session folder.
     *
     * Session folders are UUIDs, and some carry a `session-` prefix. Shortening the raw
     * name would print `session-` on every row, so the prefix goes first — otherwise the
     * label identifies nothing at all.
     *
     * @param {string} value - the session directory path.
     * @returns {string} for example `64875ca0`.
     */
    function sessionTag (value) {
      const parts = String(value).split(/[\\/]/).filter((part) => part !== '')
      const folder = (parts[parts.length - 1] ?? String(value)).replace(/^session-/, '')
      return folder.length > 8 ? folder.slice(0, 8) : folder
    }

    /**
     * A readable name for one conversation: its project, then a short session tag.
     *
     * The DSH session folder encodes the project as `--E-demo--` and the session as a
     * long id, so both ends are unhelpful raw. `E:\demo · 3f9a1c2b` says far more.
     *
     * @param {string} value - the session directory path.
     * @returns {string} the display name.
     */
    function chatName (value) {
      const parts = String(value).split(/[\\/]/).filter((part) => part !== '')
      const project = parts[parts.length - 2] ?? ''
      const decoded = project.replace(/^--/, '').replace(/--$/, '').split('-').filter((part) => part !== '').join('\\')
      const tag = sessionTag(value)
      return decoded === '' ? tag : `${decoded} · ${tag}`
    }

    /**
     * Turn sized paths into chart slices.
     * @param {Array<{path: string, bytes: number, note?: string}>} items - the entries.
     * @param {(item: object) => string} label - how to name one entry: the whole item,
     *   not just its path, because a conversation's real name arrives in its `note`.
     * @param {object} [owner] - the category these entries belong to, so a legend row can
     *   be judged by the same safety level as the row it names.
     * @returns {Array<{id: string, name: string, bytes: number, path: string}>} the slices.
     */
    function toSlices (items, label, owner) {
      return items
        .filter((item) => item.bytes > 0)
        .sort((a, b) => b.bytes - a.bytes)
        .map((item, index) => ({
          id: `${item.path}-${index}`,
          name: label(item),
          bytes: item.bytes,
          path: item.path,
          owner
        }))
    }

    /**
     * Keep a pie readable: past limit slices the remainder folds into one entry.
     *
     * With fifteen plugins the palette repeats three times and the legend fills with
     * 0% rows, which is worse than useless — it looks precise and reads as noise.
     *
     * @param {Array} slices - the slices, largest first.
     * @param {number} limit - how many named slices to keep.
     * @param {(count: number) => string} label - names the folded remainder.
     * @returns {Array} the slices to draw.
     */
    function foldTail (slices, limit, label) {
      if (slices.length <= limit) return slices
      const tail = slices.slice(limit)
      return [
        ...slices.slice(0, limit),
        {
          id: '__rest',
          name: label(tail.length),
          bytes: tail.reduce((sum, slice) => sum + slice.bytes, 0),
          folded: tail,
          path: ''
        }
      ]
    }

    /**
     * A chart plus its legend: a pie without a key is a puzzle, so the two travel
     * together and share one colour order.
     *
     * @param t - the page's locale reader.
     * @param {Array} slices - the slices, largest first.
     * @param {number} whole - the total the slices are a part of.
     * @param {object} [options] - `showPercent` toggles the percentage column.
     * @returns the chart block.
     */
    function chartBlock (t, slices, whole, options = {}) {
      if (slices.length === 0) return h('div', { className: 'dd-empty' }, t('noItems'))

      /** One copy control, or an invisible stand-in so the columns stay aligned. */
      const copyCell = (path, key) => (options.onCopy === undefined || path === undefined || path === ''
        ? h('span', { key })
        : h('button', {
          type: 'button',
          className: 'dd-copy',
          key,
          title: t('copyPath'),
          onClick: () => options.onCopy(path)
        }, t('copy')))

      /**
       * One open control per legend row, judged by the category the row belongs to: the
       * plugin and conversation charts are the same paths the rows of the list views
       * show, so they deserve the same button rather than a copy-only dead end.
       *
       * An aggregate row (`… 其他 N 项`) names no single folder, so it gets none.
       */
      const openCell = (slice, key) => (options.openCell === undefined || slice.path === undefined || slice.path === ''
        ? h('span', { key })
        : options.openCell(slice.owner, slice.path, key))

      const rows = slices.flatMap((slice, index) => {
        const isOpen = slice.folded !== undefined && options.expanded === slice.id
        const row = h('div', { className: 'dd-legend-row', key: slice.id, title: slice.path },
          h('span', { className: 'dd-legend-dot', key: 'dot', style: { background: sliceColor(index) } }),
          // An aggregate hides its members, so it opens: the folded tail is real data,
          // and a reader who wants the seventh plugin should be able to reach it.
          slice.folded === undefined
            ? h('span', { className: 'dd-legend-name', key: 'name' }, slice.name)
            : h('button', {
              type: 'button',
              className: 'dd-legend-name dd-legend-toggle',
              key: 'name',
              'aria-expanded': isOpen,
              onClick: () => options.onToggleFold?.(slice.id)
            },
            h('span', { className: 'dd-chev', 'data-open': isOpen ? '1' : '0' }, '▶'),
            slice.name),
          options.showPercent === false
            ? h('span', { key: 'pct' })
            : h('span', { className: 'dd-legend-pct', key: 'pct' }, `${Math.round((slice.bytes / whole) * 100)}%`),
          h('span', { className: 'dd-legend-size', key: 'size' }, size(slice.bytes)),
          openCell(slice, 'open'),
          copyCell(slice.path, 'copy'))

        if (!isOpen) return [row]
        return [row, ...slice.folded.map((entry) => h('div', {
          className: 'dd-legend-row dd-legend-sub',
          key: entry.id,
          title: entry.path
        },
        h('span', { className: 'dd-legend-dot', key: 'dot', style: { background: 'transparent' } }),
        h('span', { className: 'dd-legend-name', key: 'name' }, entry.name),
        h('span', { key: 'pct' }),
        h('span', { className: 'dd-legend-size', key: 'size' }, size(entry.bytes)),
        openCell(entry, 'open'),
        copyCell(entry.path, 'copy')))]
      })

      return h('div', { className: 'dd-chart' },
        // The legend's own controls, in its top-right corner: what to call these entries,
        // and — when every row is greyed out — why.
        h('div', { className: 'dd-chart-head' },
          typeof options.gatedHint === 'string' && options.gatedHint !== ''
            ? h('span', { className: 'dd-chart-hint' }, options.gatedHint)
            : null,
          options.onTogglePaths === undefined
            ? null
            : h('button', {
              type: 'button',
              className: 'dd-path-toggle',
              title: t('pathToggleHint'),
              onClick: () => options.onTogglePaths()
            }, t(options.showPaths === true ? 'showNames' : 'pref_showPaths'))),
        h('div', { className: 'dd-chart-graphic' }, donut(slices, whole)),
        h('div', { className: 'dd-legend' }, ...rows))
    }

    /**
     * The name of one entry, for a legend or a list row.
     *
     * The host already solved this for conversations: an item's `note` carries the real
     * workspace title (`2026-10-07 · disk-doctor`), read from DSH's own workspace index.
     * The date belongs in the report, so it is dropped here, and the session tag is
     * appended because several conversations usually share one workspace — three rows
     * reading `disk-doctor` would identify nothing.
     *
     * A plugin has no better name than its package name — the human-readable
     * `displayName` lives in each plugin's `package.json`, and reading those would break
     * the one thing this plugin promises about file access (see the source audit test).
     *
     * @param {object} item - a report item, with `path` and optionally `note`.
     * @param {boolean} showPaths - whether the reader asked for paths instead.
     * @returns {string} the label.
     */
    function itemName (item, showPaths) {
      if (showPaths) return shortPath(item.path)
      const isChat = /[\\/]sessions[\\/]/.test(item.path)
      if (typeof item.note === 'string' && item.note !== '') {
        // `<date> · <workspace title>`: keep the title, drop the date.
        const parts = item.note.split(' · ')
        const title = parts.length > 1 ? parts.slice(1).join(' · ') : item.note
        return isChat ? `${title} · ${sessionTag(item.path)}` : title
      }
      return isChat ? chatName(item.path) : pluginName(item.path)
    }

    /**
     * One appearance switch. Client-side only, so flipping it needs no host round-trip.
     * @param t - the page's locale reader.
     * @param {string} key - the preference key.
     * @param {boolean} on - its current value.
     * @param {object} ui - the panel's callbacks.
     * @param {object} prefs - the whole preference set.
     * @returns the row.
     */
    function preference (t, key, on, ui, prefs) {
      return h('div', { className: 'dd-pref', key },
        h('span', {}, t(`pref_${key}`)),
        h('button', {
          type: 'button',
          className: 'dd-switch',
          'data-on': on ? '1' : '0',
          role: 'switch',
          'aria-checked': on,
          title: t(`pref_${key}`),
          onClick: () => ui?.onPrefs?.({ ...prefs, [key]: !on })
        }))
    }

    /**
     * The panel's body, as a pure function of its inputs.
     *
     * Kept separate from the fetch lifecycle so the presentation can be exercised
     * directly, without a React runtime.
     *
     * @param t - the page's locale reader.
     * @param report - the report document the host served.
     * @param {string|null} open - the id of the expanded group, if any.
     * @param {(id: string) => void} onToggle - called with a group id when its row is clicked.
     * @param {() => void} [onRefresh] - called when the refresh control is used.
     * @returns the panel body.
     */
    function renderPanelBody (t, report, open, onToggle, onRefresh, ui) {
      const view = ui?.view ?? 'total'
      const prefs = ui?.prefs ?? {}
      const showPercent = prefs.showPercent !== false
      /** The dictionary entry for a key, or undefined when the key is unknown. */
      const text = (key) => {
        const value = t(key)
        return typeof value === 'string' && value !== key ? value : undefined
      }
      const name = (category) => text(`cat_${category.id.replace(/-/g, '_')}`) ?? category.label ?? category.id
      const note = (category) => text(`note_${category.id.replace(/-/g, '_')}`) ?? ''
      const showPaths = prefs.showPaths === true

      // Three boxes, each with its own figure. The host sends the areas and the flat
      // category list; grouping here keeps the panel working against an older report
      // that has only the list.
      const categories = Array.isArray(report.categories) ? report.categories : []
      const areaOf = (category) => category.area ?? 'data'
      const declared = Array.isArray(report.areas) && report.areas.length > 0
        ? report.areas
        : [{ id: 'data', label: report.totals === undefined ? '' : text('area_data'), notes: [] }]
      const areas = declared.map((area) => ({
        ...area,
        bytes: area.bytes ?? (area.id === 'data' ? report.totals?.bytes ?? 0 : 0),
        files: area.files ?? (area.id === 'data' ? report.totals?.files ?? 0 : 0),
        rows: categories.filter((category) => areaOf(category) === area.id && (category.bytes ?? 0) > 0)
          .sort((a, b) => b.bytes - a.bytes)
      }))
      const dataArea = areas.find((area) => area.id === 'data') ?? null
      const areaName = (area) => text(`area_${area.id}`) ?? area.label ?? area.id
      const dataRows = dataArea?.rows ?? []
      const largest = dataRows.length > 0 ? dataRows[0].bytes : 1

      /** safe / care / keep — the host states it, with a fallback for older reports. */
      const levelOf = (category) => category.safety ?? (category.regenerable ? 'safe' : 'care')
      const levelLabel = (category) => t(`level_${levelOf(category)}`)
      // Three disjoint buckets derived from the rows themselves, so the headline
      // numbers can never disagree with the breakdown printed underneath them.
      const bucket = (level) => dataRows
        .filter((category) => levelOf(category) === level)
        .reduce((sum, category) => sum + category.bytes, 0)
      const safeBytes = bucket('safe')
      const careBytes = bucket('care')
      const keepBytes = bucket('keep')
      /** The groups behind the cleanable total, largest first. */
      const cleanable = dataRows.filter((category) => levelOf(category) === 'safe')

      /** The per-plugin and per-conversation views reuse the items the host already lists. */
      const itemsOf = (id) => (categories.find((category) => category.id === id)?.topItems ?? [])
      const categoryById = (id) => categories.find((category) => category.id === id)
      // Label functions take the whole item: a conversation's real name is in its `note`.
      const plug = (item) => itemName(item, showPaths)
      const chat = (item) => itemName(item, showPaths)
      const restLabel = (count) => fill(t('restItems'), { count })

      // Revealing a folder is the host's decision, twice over: the feature has to be
      // switched on, and the amber/grey rows need a second, separate opt-in. The
      // panel mirrors that rule so a row never pretends to be clickable when the
      // host would refuse it.
      const caps = report.capabilities ?? {}
      const canOpen = (category) =>
        caps.openFolder === true && (category === undefined || levelOf(category) === 'safe' || caps.openFolderSensitive === true)
      /** Why a row cannot be opened, in the reader's words. */
      const openReason = (category) => caps.openFolder !== true
        ? t('openDisabled')
        : (category !== undefined && levelOf(category) !== 'safe' ? t('openSensitive') : t('openHint'))
      const openCell = (category, target, key) => (ui?.onOpen === undefined
        ? null
        : h('button', {
          type: 'button',
          className: 'dd-open',
          key,
          disabled: !canOpen(category),
          title: openReason(category),
          onClick: () => ui.onOpen(target)
        }, t('open')))

      const chartOptions = {
        showPercent,
        onCopy: ui?.onCopy,
        openCell,
        expanded: ui?.foldedId,
        onToggleFold: ui?.onToggleFold
      }
      /**
       * Options for the two charts whose rows are names rather than categories: they get
       * the name/path toggle in the legend's corner, and — when their rows are all greyed
       * out — the sentence saying which switch would light them up. A reader who is not
       * told will read "every button is dead" as "the feature is broken".
       */
      const nameChartOptions = (owner) => ({
        ...chartOptions,
        showPaths,
        onTogglePaths: ui?.onPrefs === undefined
          ? undefined
          : () => ui.onPrefs({ ...prefs, showPaths: !showPaths }),
        gatedHint: canOpen(owner) ? null : openReason(owner)
      })
      // Each chart names the same folders the list views do, so every legend row carries
      // the category that owns it — that is what decides whether its button is live.
      const pluginSlices = foldTail(toSlices(itemsOf('profile-deps'), plug, categoryById('profile-deps')), 8, restLabel)
      const chatSlices = foldTail(toSlices(itemsOf('sessions'), chat, categoryById('sessions')), 8, restLabel)
      const categorySlices = dataRows.map((category) => ({
        id: category.id,
        name: name(category),
        bytes: category.bytes,
        path: category.roots?.[0] ?? '',
        owner: category
      }))
      const categoryBytes = dataRows.reduce((sum, category) => sum + category.bytes, 0)
      /** A readable name for one row, unless the reader asked for full paths. */
      const itemLabel = (item) => itemName(item, showPaths)
      const pluginBytes = pluginSlices.reduce((sum, slice) => sum + slice.bytes, 0)
      const chatBytes = chatSlices.reduce((sum, slice) => sum + slice.bytes, 0)
      const views = [
        { id: 'total', label: t('view_total') },
        { id: 'plugins', label: t('view_plugins') },
        { id: 'chats', label: t('view_chats') }
      ]

      /** The rows of one area, each with its bar, note and item list. */
      const categoryList = (area) => (area.rows.length === 0
        ? null
        : h('div', { className: 'dd-list' }, ...area.rows.map((category) => {
          const isOpen = open === category.id
          return h('div', { key: category.id },
            h('div', { className: 'dd-row' },
              h('button', {
                type: 'button',
                className: 'dd-row-head',
                'aria-expanded': isOpen,
                onClick: () => onToggle(category.id)
              },
              h('span', { className: 'dd-row-name' },
                h('span', { className: 'dd-chev', 'data-open': isOpen ? '1' : '0' }, '▶'),
                h('span', {
                  className: 'dd-dot',
                  'data-level': levelOf(category),
                  title: levelLabel(category)
                }),
                name(category)),
              h('span', { className: 'dd-row-size' }, size(category.bytes))),
              openCell(category, category.roots?.[0] ?? '', 'open')),
            h('div', { className: 'dd-bar' },
              h('i', { style: { width: `${Math.max(2, Math.round((category.bytes / largest) * 100))}%` } })),
            isOpen
              ? [
                note(category) !== '' ? h('div', { className: 'dd-note', key: 'note' }, note(category)) : null,
                h('div', { className: 'dd-items', key: 'items' },
                  ...((category.topItems ?? []).length === 0
                    ? [h('div', { className: 'dd-item-path' }, t('noItems'))]
                    : (category.topItems ?? []).map((item, index) => h('div', { className: 'dd-item', key: `${item.path}-${index}` },
                      h('span', { className: 'dd-item-path', title: item.path }, itemLabel(item)),
                      h('span', { className: 'dd-item-size' }, size(item.bytes)),
                      openCell(category, item.path, 'open'),
                      ui?.onCopy === undefined
                        ? null
                        : h('button', {
                          type: 'button',
                          className: 'dd-copy',
                          title: t('copyPath'),
                          onClick: () => ui.onCopy(item.path)
                        }, t('copy'))))))
              ]
              : null)
        })))

      /**
       * Plugins that are installed as links: their real bytes are outside every
       * scanned folder, so they are shown here and never added to a figure.
       *
       * No open control is offered: the host's rule is containment inside a root the
       * scan covers, and a link's target is by definition outside those roots — a
       * button that always failed would be worse than none. The path can be copied.
       */
      const linkSection = (areaId) => {
        const links = (report.linkInstalls ?? []).filter((link) => (link.area ?? 'data') === areaId)
        if (links.length === 0) return null
        return h('div', { className: 'dd-link-installs' },
          h('div', { className: 'dd-section-title' }, t('linkInstallsTitle')),
          ...links.map((link, index) => h('div', { className: 'dd-item', key: `${link.path}-${index}` },
            h('span', { className: 'dd-item-path', title: `${link.path} → ${link.target}` },
              `${pluginName(link.path)} → ${shortPath(link.target)}`),
            h('span', { className: 'dd-item-size' }, size(link.bytes)),
            ui?.onCopy === undefined
              ? null
              : h('button', {
                type: 'button',
                className: 'dd-copy',
                title: t('copyPath'),
                onClick: () => ui.onCopy(link.target)
              }, t('copy')))))
      }

      /** One box: what the area is called, its own figure, where it lives, its rows. */
      const areaBox = (area, body) => h('div', {
        className: 'dd-area',
        key: area.id,
        'data-lead': area === dataArea ? '1' : '0'
      },
      h('div', { className: 'dd-area-head' },
        h('span', { className: 'dd-area-title' }, areaName(area)),
        h('span', { className: 'dd-area-size' }, size(area.bytes)),
        area === dataArea ? h('span', { className: 'dd-total-label' }, t('totalLabel')) : null),
      ...(Array.isArray(area.notes) ? area.notes : []).map((line, index) =>
        h('div', { className: 'dd-area-note', key: `note-${index}` }, line)),
      h('div', { className: 'dd-area-body' }, ...body))

      /**
       * The cleanup box. It lists what a cleanup *would* move and says, in the same
       * breath, that nothing moves — the panel has no control that could move anything,
       * because the host has none either.
       */
      const cleanupBox = () => {
        const preview = ui?.preview ?? {}
        const plan = preview.plan ?? null
        const rows = [
          h('div', { className: 'dd-cleanup-head', key: 'head' },
            h('span', { className: 'dd-section-title' }, t('cleanupTitle')),
            safeBytes > 0
              ? h('span', { className: 'dd-area-size dd-cleanup-size' }, size(safeBytes))
              : null),
          h('div', { className: 'dd-cleanup-line', key: 'summary' },
            safeBytes > 0
              ? fill(t('cleanupSummary'), {
                size: size(safeBytes),
                list: cleanable.map((category) => `${name(category)} ${size(category.bytes)}`).join('、')
              })
              : t('cleanupNothing'))
        ]
        if (safeBytes > 0 && ui?.onPreview !== undefined) {
          rows.push(h('div', { className: 'dd-actions', key: 'action' },
            h('button', {
              type: 'button',
              className: 'dd-btn',
              disabled: preview.phase === 'loading',
              onClick: () => ui.onPreview()
            }, t(plan === null ? 'cleanupPreview' : 'cleanupPreviewAgain')),
            // The one button in the whole panel that can move a file. It only exists when
            // the host says the permission is on, and it takes two clicks: the first asks,
            // the second does. A move is recoverable, but a mis-click should still not be.
            //
            // It must stay *enabled* while it is asking. A disabled button receives no
            // click at all, so disabling it until the confirmation is open made the first
            // click a no-op and the confirmation unreachable — the button looked alive and
            // did nothing.
            plan !== null && plan.itemCount > 0 && ui?.onMove !== undefined
              ? h('button', {
                type: 'button',
                className: ui.confirming === true ? 'dd-btn dd-btn-danger' : 'dd-btn',
                key: 'move',
                disabled: caps.cleanup !== true,
                title: caps.cleanup === true ? t('cleanupMove') : t('cleanupMoveDisabled'),
                onClick: () => (ui.confirming === true ? ui.onMove() : ui.onConfirmMove?.(true))
              }, t(ui.confirming === true ? 'cleanupConfirmYes' : 'cleanupMove'))
              : null))
        }
        if (plan !== null && plan.itemCount > 0 && ui?.onMove !== undefined) {
          if (caps.cleanup !== true) {
            rows.push(h('div', { className: 'dd-cleanup-line dd-cleanup-warn', key: 'move-disabled' },
              t('cleanupMoveDisabled')))
          } else if (ui.confirming === true) {
            // The question, and a way out. The "yes" is the button above, which has just
            // relabelled itself — one yes and one cancel beats two identical yes buttons.
            rows.push(h('div', { className: 'dd-cleanup-line dd-cleanup-confirm', key: 'confirm' },
              fill(t('cleanupConfirm'), { count: plan.itemCount, size: size(plan.totalBytes) }),
              h('button', {
                type: 'button',
                className: 'dd-btn',
                onClick: () => ui.onConfirmMove?.(false)
              }, t('cleanupConfirmNo'))))
          }
        }
        if (preview.phase === 'loading') {
          rows.push(h('div', { className: 'dd-cleanup-line', key: 'loading' }, t('cleanupLoading')))
        }
        if (preview.phase === 'failed') {
          rows.push(h('div', { className: 'dd-cleanup-line', key: 'failed' }, t('cleanupFailed')))
        }
        if (plan !== null) {
          rows.push(h('div', { className: 'dd-cleanup-line', key: 'moves' },
            fill(t('cleanupMoves'), { count: plan.itemCount, size: size(plan.totalBytes) })))
          rows.push(h('div', { className: 'dd-cleanup-line dd-cleanup-target', key: 'target' },
            fill(t('cleanupTarget'), { path: plan.destination })))
          rows.push(h('div', { className: 'dd-cleanup-items', key: 'items' },
            ...(plan.items ?? []).slice(0, PREVIEW_ROWS).map((item, index) => h('div', {
              className: 'dd-item',
              key: `${item.path}-${index}`,
              title: item.path
            },
            h('span', { className: 'dd-item-path' }, itemLabel(item)),
            h('span', { className: 'dd-item-size' }, size(item.bytes)),
            ui?.onOpen === undefined
              ? null
              : openCell(categoryById(item.categoryId), item.path, 'open')))),
          plan.items.length > PREVIEW_ROWS
            ? h('div', { className: 'dd-cleanup-line', key: 'more' },
              fill(t('cleanupMore'), { count: plan.items.length - PREVIEW_ROWS }))
            : null,
          ...(plan.warnings ?? []).map((line, index) =>
            h('div', { className: 'dd-cleanup-line dd-cleanup-warn', key: `warn-${index}` },
              line.replace(/\*\*/g, ''))))
        }

        // What the last move did, and the way back. The undo works off the manifest the
        // host wrote, so it needs nothing remembered here — and it refuses to overwrite
        // anything that has appeared in the meantime.
        const batch = ui?.batch ?? null
        if (batch !== null) {
          // A move that did not happen says why, and says only that. Silence here would be
          // indistinguishable from a dead button, which is exactly how this looked the first
          // time; and announcing "nothing to move" next to a failure would be a second lie.
          if (batch.error !== undefined && batch.error !== null) {
            rows.push(h('div', { className: 'dd-cleanup-line dd-cleanup-warn', key: 'move-error' },
              fill(t('cleanupMoveFailed'), { reason: batch.error })))
          } else {
            rows.push(h('div', { className: 'dd-cleanup-moved', key: 'batch' },
              h('div', { className: 'dd-cleanup-line' },
                batch.items?.length > 0
                  ? fill(t('cleanupMoved'), { count: batch.items.length, size: size(batch.bytes) })
                  : t('cleanupMovedNothing')),
              batch.items?.length > 0 ? h('div', { className: 'dd-cleanup-line' }, t('cleanupMovedHint')) : null,
              batch.failures?.length > 0
                ? h('div', { className: 'dd-cleanup-line dd-cleanup-warn' },
                  fill(t('cleanupUndoPartial'), { count: batch.failures.length }))
                : null,
              batch.items?.length > 0 && ui?.onUndo !== undefined
                ? h('div', { className: 'dd-actions' },
                  h('button', {
                    type: 'button',
                    className: 'dd-btn',
                    onClick: () => ui.onUndo(batch.id)
                  }, t('cleanupUndo')))
                : null))
          }
        }
        const undo = ui?.undo ?? null
        if (undo !== null) {
          rows.push(h('div', { className: 'dd-cleanup-line', key: 'undo-result' },
            undo.error !== undefined
              ? fill(t('cleanupUndoFailed'), { reason: undo.error })
              : undo.restored?.length > 0
                ? fill(t('cleanupUndoDone'), { count: undo.restored.length, size: size(undo.restoredBytes) })
                : t('cleanupUndoPartial').replace('{count}', String(undo.failures?.length ?? 0))))
        }
        // Batches already on disk, so a reader who comes back later still finds the undo.
        const batches = (plan?.batches ?? []).filter((entry) => entry.status !== 'undone')
        if (batches.length > 0 && ui?.onUndo !== undefined) {
          rows.push(h('div', { className: 'dd-cleanup-batches', key: 'batches' },
            h('div', { className: 'dd-section-title' }, t('cleanupBatchesTitle')),
            ...batches.slice(0, 3).map((entry) => h('div', { className: 'dd-cleanup-line', key: entry.id },
              fill(t('cleanupBatchLine'), { id: entry.id, count: entry.itemCount, size: size(entry.bytes) }),
              h('button', {
                type: 'button',
                className: 'dd-btn',
                onClick: () => ui.onUndo(entry.id)
              }, t('cleanupUndo'))))))
        }
        rows.push(h('div', { className: 'dd-cleanup-line', key: 'empty-hint' }, t('cleanupEmptyHint')))

        // The ritual this follows, written down where the buttons are: quarantine first,
        // restart and watch, and an undo that puts every listed path back where it came from.
        rows.push(h('div', { className: 'dd-cleanup-plan', key: 'plan' },
          h('div', { className: 'dd-section-title' }, t('cleanupPlanTitle')),
          h('div', { className: 'dd-cleanup-plan-step', key: '1' }, t('cleanupPlan1')),
          h('div', { className: 'dd-cleanup-plan-step', key: '2' }, t('cleanupPlan2')),
          h('div', { className: 'dd-cleanup-plan-step', key: '3' }, t('cleanupPlan3'))))
        rows.push(h('div', { className: 'dd-cleanup-line', key: 'dry-run' },
          t('cleanupDryRun').replace(/\*\*/g, '')))
        return h('div', { className: 'dd-cleanup' }, ...rows)
      }

      /**
       * Where the space really is, and the operation that actually frees it.
       *
       * The temptation is to "clean up" by deleting folders; on this layout that frees
       * almost nothing (hard links) or breaks DSH (the runtime, the program). So the
       * panel says the two things that work instead of leaving the reader to guess.
       */
      const guideBox = () => {
        const lines = []
        const plugins = categoryById('profile-deps')
        const biggest = plugins?.topItems?.[0]
        if (biggest !== undefined) {
          lines.push(fill(t('guideUninstall'), {
            name: pluginName(biggest.path),
            size: size(biggest.bytes)
          }))
        }
        const store = categoryById('pnpm-store')
        if (store !== undefined && store.bytes > 0) {
          lines.push(fill(t('guidePrune'), { size: size(store.bytes), overlap: size(store.overlapBytes ?? 0) }))
        }
        lines.push(t('guideLeaveAlone'))
        return h('div', { className: 'dd-guide' },
          h('div', { className: 'dd-section-title' }, t('guideTitle')),
          ...lines.map((line, index) => h('div', { className: 'dd-guide-line', key: index }, line)))
      }

      const dataBody = [
        h('div', { className: 'dd-sub', key: 'files' },
          fill(t('files'), { count: (dataArea?.files ?? 0).toLocaleString('en-US') })),
        safeBytes > 0
          ? h('div', { className: 'dd-pill', key: 'pill', title: t('cleanableHint') },
            fill(t('cleanable'), { size: size(safeBytes) }))
          : null,
        // Say WHERE the cleanable number lives, rather than leaving it a dead end.
        cleanable.length > 0
          ? h('div', { className: 'dd-sub dd-from', key: 'from' },
            fill(t('from'), {
              list: cleanable.map((category) => `${name(category)} ${size(category.bytes)}`).join('、')
            }))
          : null,
        careBytes > 0
          ? h('div', { className: 'dd-sub dd-from', key: 'care' }, fill(t('careLine'), { size: size(careBytes) }))
          : null,
        keepBytes > 0
          ? h('div', { className: 'dd-sub dd-from', key: 'keep' }, fill(t('keep'), { size: size(keepBytes) }))
          : null,
        h('div', { className: 'dd-actions', key: 'actions' }, onRefresh === undefined
          ? null
          : h('button', { type: 'button', className: 'dd-btn', onClick: onRefresh }, t('refresh'))),

        h('div', { className: 'dd-tabs', key: 'tabs' }, ...views.map((entry) => h('button', {
          type: 'button',
          className: 'dd-tab',
          key: entry.id,
          'data-on': view === entry.id ? '1' : '0',
          onClick: () => ui?.onView?.(entry.id)
        }, entry.label))),

        view === 'total' ? chartBlock(t, categorySlices, categoryBytes, chartOptions) : null,

        view === 'plugins'
          ? chartBlock(t, pluginSlices, pluginBytes, nameChartOptions(categoryById('profile-deps')))
          : view === 'chats'
            ? chartBlock(t, chatSlices, chatBytes, nameChartOptions(categoryById('sessions')))
            : h('div', { className: 'dd-section', key: 'section' },
              h('div', { className: 'dd-section-title' }, t('sectionTitle')),
              dataRows.length === 0
                ? h('div', { className: 'dd-empty' }, t('empty'))
                : categoryList(dataArea)),
        linkSection('data')
      ]

      return h('div', { className: 'dd-scroll' },
        h('div', { className: 'dd-top' },
          h('span', { className: 'dd-top-title' }, t('panelTitle')),
          ui?.onPrefs === undefined
            ? null
            : h('button', {
              type: 'button',
              className: 'dd-gear',
              title: t('settings'),
              'aria-expanded': prefs.open === true,
              onClick: () => ui.onPrefs({ ...prefs, open: prefs.open !== true })
            }, '⚙')),

        // The gear opens the appearance preferences — client-side only, so nothing here has
        // to round-trip to the host just to change how the panel looks — and, below a
        // divider, the one **host** setting a reader needs while looking at this panel:
        // the cleanup permission. It sits here because this is where the buttons it governs
        // are, and it is written through the same configuration form the settings page uses.
        prefs.open === true
          ? h('div', { className: 'dd-prefs' },
            preference(t, 'showPercent', showPercent, ui, prefs),
            preference(t, 'showPaths', showPaths, ui, prefs),
            preference(t, 'compact', prefs.compact === true, ui, prefs),
            ui?.onPermission === undefined
              ? null
              : h('div', { className: 'dd-pref-group', key: 'cleanup-permission' },
                h('div', { className: 'dd-pref dd-pref-host' },
                  h('span', { title: t('cleanupPermissionHint') }, t('cleanupPermission')),
                  h('button', {
                    type: 'button',
                    className: 'dd-switch',
                    'data-on': ui.permission?.on === true ? '1' : '0',
                    role: 'switch',
                    'aria-checked': ui.permission?.on === true,
                    'aria-label': t('cleanupPermission'),
                    title: t('cleanupPermissionHint'),
                    disabled: ui.permissionBusy === true || ui.permission?.writable === false,
                    onClick: () => ui.onPermission()
                  })),
                h('div', { className: 'dd-setting-hint' }, t('cleanupPermissionHint')),
                ui?.permissionError !== undefined && ui.permissionError !== null
                  ? h('div', { className: 'dd-cleanup-line dd-cleanup-warn' }, ui.permissionError)
                  : null))
          : null,

        // An area with nothing to say (no rows and no note of its own) is left out
        // rather than drawn as an empty box.
        ...areas
          .filter((area) => area === dataArea || area.rows.length > 0 || (area.notes ?? []).length > 0)
          .map((area) => areaBox(area,
            area === dataArea && dataArea !== null
              ? dataBody
              : [categoryList(area), linkSection(area.id)])),

        ui?.openError !== undefined && ui.openError !== null
          ? h('div', { className: 'dd-warn' }, fill(t('openFailed'), { reason: ui.openError }))
          : null,
        cleanupBox(),
        guideBox(),
        colorHelp(t),
        h('div', { className: 'dd-scope' }, t('scopeNote')),
        (report.warnings ?? []).length > 0 ? h('div', { className: 'dd-warn' }, report.warnings[0]) : null)
    }

    /**
     * The resident panel: fetches the host's report and renders it.
     * @param props - the locale reader injected by the tab registration.
     * @returns the panel.
     */
    function DiskPanel (props) {
      const { t } = props
      const [state, setState] = react.useState({ phase: 'loading', report: null })
      const [open, setOpen] = react.useState(null)
      const [view, setView] = react.useState('total')
      const [prefs, setPrefs] = react.useState({})
      const [foldedId, setFoldedId] = react.useState(null)
      const [openError, setOpenError] = react.useState(null)
      const [preview, setPreview] = react.useState({ phase: 'idle', plan: null })
      const [confirming, setConfirming] = react.useState(false)
      const [batch, setBatch] = react.useState(null)
      const [undo, setUndo] = react.useState(null)
      const [permission, setPermission] = react.useState(() => props.permission?.read() ?? { on: false })
      const [permissionError, setPermissionError] = react.useState(null)
      const [permissionBusy, setPermissionBusy] = react.useState(false)

      // Follow the shared configuration form, so the gear shows the host's value even when
      // the form is served after this panel mounted, or the settings page changed it.
      react.useEffect(() => {
        if (props.permission === undefined) return undefined
        setPermission(props.permission.read())
        return props.permission.subscribe(() => setPermission(props.permission.read()))
      }, [props.permission])
      const copy = react.useCallback((value) => {
        try {
          navigator.clipboard?.writeText(value)
        } catch {
          /* the path is still in the tooltip when the clipboard is unavailable */
        }
      }, [])

      /**
       * Ask the host to reveal a folder. The host decides again — the button's
       * disabled state is a courtesy, not the security boundary — and a refusal is
       * shown rather than swallowed, because a click that does nothing is worse
       * than a click that explains itself.
       */
      const reveal = react.useCallback((target) => {
        setOpenError(null)
        fetch(`${OPEN_ROUTE}?path=${encodeURIComponent(target)}`, { method: 'POST' })
          .then((response) => response.json()
            .catch(() => ({}))
            .then((body) => {
              if (!response.ok) setOpenError(String(body.error ?? `HTTP ${response.status}`))
            }))
          .catch(() => setOpenError('network'))
      }, [])

      /** Fetch the report again: the headline numbers change after a move or an undo. */
      const load = react.useCallback(() => {
        // A refresh keeps the panel on screen. Blanking it back to "measuring…" would hide
        // the batch summary and the undo button for as long as the rescan takes — exactly
        // when a reader wants them.
        setState((current) => ({
          phase: current.report === null ? 'loading' : 'refreshing',
          report: current.report
        }))
        fetch(`${REPORT_ROUTE}?top=${PANEL_TOP}`, { cache: 'no-store' })
          .then((response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            return response.json()
          })
          .then((report) => setState({ phase: 'ready', report }))
          .catch(() => setState((current) => current.report === null
            ? { phase: 'failed', report: null }
            : current))
      }, [])

      /**
       * Ask the host what a cleanup would move. It is a GET, and the host side of it is a
       * scan plus a listing of the quarantine: nothing leaves this request changed, which
       * is why the button can be offered without a confirmation step.
       */
      const loadPreview = react.useCallback(() => {
        setPreview({ phase: 'loading', plan: null })
        fetch(CLEANUP_ROUTE, { cache: 'no-store' })
          .then((response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            return response.json()
          })
          .then((plan) => setPreview({ phase: 'ready', plan }))
          .catch(() => setPreview({ phase: 'failed', plan: null }))
      }, [])

      /**
       * The one action in this panel that moves a file.
       *
       * The host has the final say — it refuses with 403 unless the permission is on, and
       * re-checks every path before it renames anything — but the button already asked the
       * reader to confirm, so a click here is a deliberate second one. Afterwards both the
       * plan and the report are fetched again: the green total has just changed.
       */
      const moveNow = react.useCallback(() => {
        setConfirming(false)
        setUndo(null)
        setBatch(null)
        fetch(`${CLEANUP_ROUTE}?action=move`, { method: 'POST' })
          .then((response) => response.json()
            .catch(() => ({}))
            .then((body) => {
              if (!response.ok) {
                // Say which of the three things went wrong. "Nothing happened" was the
                // symptom the first version produced, and it told the reader nothing.
                const reason = body.error === 'disabled'
                  ? t('cleanupMoveDisabled')
                  : response.status === 404 || response.status === 405
                    ? t('cleanupStaleHost')
                    : String(body.error ?? `HTTP ${response.status}`)
                setBatch({ error: reason, items: [], bytes: 0, failures: [] })
                return
              }
              setBatch(body)
              load()
              loadPreview()
            }))
          .catch(() => setBatch({ error: t('cleanupHostGone'), items: [], bytes: 0, failures: [] }))
      }, [load, loadPreview, t])

      /**
       * Flip the cleanup permission from the panel's gear.
       *
       * The switch shows the host's effective value, not a local one, so a write the host
       * refuses leaves it where it was and says why. On success the report is fetched
       * again, because the move button's enabled state comes from that capability.
       */
      const togglePermission = react.useCallback(() => {
        const next = permission.on !== true
        setPermissionBusy(true)
        setPermissionError(null)
        Promise.resolve(props.permission?.write(next))
          .then((landed) => {
            setPermission(props.permission?.read() ?? { on: false })
            if (landed !== true) {
              setPermissionError(t('cleanupPermissionLocked'))
              return
            }
            load()
          })
          .catch(() => setPermissionError(t('cleanupPermissionLocked')))
          .finally(() => setPermissionBusy(false))
      }, [permission, props.permission, load, t])

      /** Put one batch back. Safe direction, so one click is enough. */
      const undoBatch = react.useCallback((id) => {
        setPreview((current) => ({ ...current, phase: 'loading' }))
        fetch(`${CLEANUP_ROUTE}?action=undo&id=${encodeURIComponent(id)}`, { method: 'POST' })
          .then((response) => response.json()
            .catch(() => ({}))
            .then((body) => {
              // A refused undo is not a result. Without this check a 400 — "no manifest",
              // "already undone", the switch off — rendered as "0 could not go back", which
              // is the opposite of what the host said and hides the reason entirely.
              if (!response.ok) {
                setUndo({
                  error: body.error === 'disabled'
                    ? t('cleanupMoveDisabled')
                    : String(body.error ?? `HTTP ${response.status}`),
                  restored: [],
                  failures: [],
                  restoredBytes: 0
                })
                return
              }
              setUndo(body)
              setBatch(null)
              load()
              loadPreview()
            }))
          .catch((error) => setUndo({
            restored: [],
            failures: [{ reason: String(error.message ?? error) }],
            restoredBytes: 0
          }))
      }, [load, loadPreview, t])

      react.useEffect(() => {
        load()
      }, [load])

      if (state.report === null) {
        return h('div', { className: 'dd-panel' }, h('div', { className: 'dd-scroll' },
          h('div', { className: 'dd-empty' },
            state.phase === 'loading' ? t('scanning') : t('failed'),
            state.phase === 'loading' ? h('br') : null,
            state.phase === 'loading' ? t('scanningHint') : null,
            state.phase === 'failed'
              ? h('div', { style: { marginTop: '12px' } },
                h('button', { type: 'button', className: 'dd-btn', onClick: load }, t('retry')))
              : null)))
      }

      return h('div', { className: 'dd-panel', 'data-compact': prefs.compact === true ? '1' : '0' },
        renderPanelBody(t, state.report, open, (id) => setOpen(open === id ? null : id), load,
          {
            view,
            prefs,
            onView: setView,
            onPrefs: setPrefs,
            onCopy: copy,
            onOpen: reveal,
            openError,
            onPreview: loadPreview,
            preview,
            onConfirmMove: (value) => setConfirming(value !== false),
            confirming,
            onMove: moveNow,
            batch,
            onUndo: undoBatch,
            undo,
            onPermission: togglePermission,
            permission,
            permissionBusy,
            permissionError,
            foldedId,
            onToggleFold: (id) => setFoldedId(foldedId === id ? null : id)
          }))
    }

    /**
     * The bundle's settings page, over every field the host exposes.
     *
     * The plain text fields come first and the technical ones stay folded away, so the
     * page reads as a few choices. The two permissions are **switches**, not text
     * boxes: the shared control only offers text and number, and asking someone to
     * type `true` to let a button work is a poor way to explain a permission. The
     * staged value still travels the shared form model's own text encoding, so the
     * profile patch this writes is exactly the same one.
     *
     * @param props - the view asked for, locale copy, the form snapshot, and its actions.
     * @returns the one-liner, or the form.
     */
    function DiskDoctorCard (props) {
      const { t } = props
      if (props.view === 'summary') return t('description')
      const state = props.useDiskDoctorCard((snapshot) => snapshot)
      const disabled = !state.writable
      const control = (id, key, labelKey, hintKey, invalidKey, numeric) => h(SettingsValueField, {
        id: `disk-doctor-${id}`,
        key,
        label: t(labelKey),
        hint: t(hintKey),
        overriddenLabel: t('overridden'),
        resetLabel: t('reset'),
        invalidLabel: t(invalidKey),
        numeric: numeric === true,
        disabled,
        ...state[key],
        onEdit: (value) => {
          props.edit(key, value)
        },
        onReset: () => {
          props.resetField(key)
        }
      })
      /**
       * One permission, as a switch.
       * @param id - the control id, matching the host field name.
       * @param key - the config field.
       * @param fallback - the documented default, used when the host sends no value.
       */
      const permission = (id, key, labelKey, hintKey, fallback) => {
        const field = state[key] ?? {}
        const text = typeof field.text === 'string' ? field.text : ''
        const on = text === '' ? fallback === true : text === 'true'
        return h('div', { className: 'dd-setting', id: `disk-doctor-${id}`, key },
          h('div', { className: 'dd-setting-row' },
            h('span', { className: 'dd-setting-label' }, t(labelKey)),
            field.overridden === true
              ? h('button', {
                type: 'button',
                className: 'dd-reset',
                onClick: () => props.resetField(key)
              }, t('reset'))
              : null,
            h('button', {
              type: 'button',
              className: 'dd-switch',
              role: 'switch',
              'aria-checked': on,
              'aria-label': t(labelKey),
              'data-on': on ? '1' : '0',
              title: t(hintKey),
              disabled,
              onClick: () => props.edit(key, on ? 'false' : 'true')
            })),
          h('div', { className: 'dd-setting-hint' }, t(hintKey)))
      }
      return h(SettingsForm, {
        labels: formLabels(t),
        state,
        onSave: props.save,
        onDiscard: props.discard
      },
      control('dsh-home', 'dshHome', 'dshHome', 'dshHomeHint', 'invalidNumber', false),
      control('top-n', 'topN', 'topN', 'topNHint', 'invalidNumber', true),
      control('report-dir', 'reportDir', 'reportDir', 'reportDirHint', 'invalidNumber', false),
      h('details', { className: 'dd-advanced', key: 'advanced' },
        h('summary', {}, t('advanced')),
        control('exclude-globs', 'excludeGlobs', 'excludeGlobs', 'excludeGlobsHint', 'invalidNumber', false),
        control('follow-symlinks', 'followSymlinks', 'followSymlinks', 'followSymlinksHint', 'invalidBoolean', false),
        control('app-dir', 'appDir', 'appDir', 'appDirHint', 'invalidNumber', false),
        permission('allow-open-folder', 'allowOpenFolder', 'allowOpenFolder', 'allowOpenFolderHint', true),
        permission('allow-open-folder-sensitive', 'allowOpenFolderSensitive', 'allowOpenFolderSensitive',
          'allowOpenFolderSensitiveHint', false),
        colorHelp(t)))
    }

    /**
     * The cleanup permission, reachable from the panel's own gear.
     *
     * This is a **host** setting, not a browser preference like the three above it, so it
     * is written through the same configuration form the settings page edits:
     * `ctx.configForms.get(namespace)` hands out the shared scope for this plugin, and a
     * save through it persists like any other settings write. The panel and the settings
     * page therefore cannot disagree — and the host stays the authority on whether the
     * write was accepted, which is why the result is read back instead of assumed.
     */
    class CleanupPermission {
      /** @param scope - the shared configuration form of the `disk-doctor` entry. */
      constructor (scope) {
        this.scope = scope
        this.form = new SettingsFormModel(scope, [settingsBooleanField('allowCleanup')])
      }

      /** @returns what the gear needs to draw the switch. */
      read () {
        const snapshot = this.scope.getSnapshot()
        return {
          on: snapshot.value?.allowCleanup === true,
          // A value pinned by a home patch or a command-line overlay cannot be written
          // here; saying so beats a switch that silently springs back.
          writable: snapshot.writable === true
        }
      }

      /**
       * Watch the shared scope.
       *
       * The form is served asynchronously, and the same scope is edited from the settings
       * page, so the gear has to follow it rather than sample it once at mount.
       *
       * @param {() => void} listener - called whenever the scope changes.
       * @returns {() => void} the unsubscribe function.
       */
      subscribe (listener) {
        return this.scope.subscribe(listener)
      }

      /**
       * Stage the new value and write it.
       * @param {boolean} next - the value to store.
       * @returns {Promise<boolean>} whether the host accepted it.
       */
      async write (next) {
        const actions = this.form.actions()
        actions.edit('allowCleanup', next ? 'true' : 'false')
        await this.form.save()
        const landed = this.scope.getSnapshot().value?.allowCleanup === next
        // A write that did not land keeps its draft on purpose, so the reader can correct
        // it; here nothing needs correcting, and a stale draft would confuse the page.
        if (!landed) actions.discard()
        return landed
      }

      /** Release the form subscription. */
      dispose () {
        this.form.dispose()
      }
    }

    /** The staged form over the `disk-doctor` entry. */
    class DiskDoctorCardController {
      /** @param scope - the shared configuration form of the `disk-doctor` entry. */
      constructor (scope) {
        this.form = new SettingsFormModel(scope, [
          settingsTextField('dshHome'),
          settingsNumberField('topN'),
          settingsTextField('reportDir'),
          settingsListField('excludeGlobs'),
          settingsBooleanField('followSymlinks'),
          settingsTextField('appDir'),
          settingsBooleanField('allowOpenFolder'),
          settingsBooleanField('allowOpenFolderSensitive')
        ])
        this.store = this.form.bind(() => this.projection())
      }

      /** @returns the shared form state plus one entry per control. */
      projection () {
        return {
          ...this.form.shell(),
          dshHome: this.form.field('dshHome'),
          topN: this.form.field('topN'),
          reportDir: this.form.field('reportDir'),
          excludeGlobs: this.form.field('excludeGlobs'),
          followSymlinks: this.form.field('followSymlinks'),
          appDir: this.form.field('appDir'),
          allowOpenFolder: this.form.field('allowOpenFolder'),
          allowOpenFolderSensitive: this.form.field('allowOpenFolderSensitive')
        }
      }

      /** @returns the page's snapshot hook and its form actions. */
      inject () {
        return {
          hooks: { diskDoctorCard: this.store },
          ...this.form.actions()
        }
      }

      /** Release the form subscription. */
      dispose () {
        this.form.dispose()
      }
    }

    /** Required services (cordis fiber inject). */
    const inject = ['slots', 'locale', 'configForms']

    /**
     * Mount the panel and the settings page.
     *
     * Both seats are optional in the deployment sense: `ctx.inject` waits for the
     * services they need, so a client without a right sidebar still gets the
     * settings page, and the tool works regardless.
     *
     * @param ctx - the browser plugin context.
     */
    function apply (ctx) {
      installStyles()
      const t = ctx.locale.bind(LOCALE_NS)
      ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), 'dsh-disk-doctor: dictionaries')

      const controller = new DiskDoctorCardController(ctx.configForms.get(NS))
      ctx.effect(() => () => {
        controller.dispose()
      }, 'dsh-disk-doctor: form subscription')
      // The cleanup permission is the one host setting a reader needs while looking at the
      // panel, right next to the buttons it governs, so the panel's gear owns a form for
      // it as well. Same scope, so both surfaces agree and either one can write it.
      const permission = new CleanupPermission(ctx.configForms.get(NS))
      ctx.effect(() => () => {
        permission.dispose()
      }, 'dsh-disk-doctor: permission form subscription')
      ctx.effect(() => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
        name: 'plugins.bundle.config',
        key: BUNDLE,
        locale: LOCALE_NS,
        inject: () => ({ t, ...controller.inject() })
      }, DiskDoctorCard)), 'dsh-disk-doctor: bundle configuration')

      ctx.inject(['sidebarRightTabs', 'sidebarRight'], (owner) => {
        const tabs = owner.get('sidebarRightTabs')
        const navigation = owner.get('sidebarRight')
        owner.effect(() => tabs.register({
          id: TAB_ID,
          kind: TAB_KIND,
          priority: 'extension',
          title: () => t('panelTitle'),
          guide: [{ order: 60, title: () => t('panelTitle') }]
        }), 'dsh-disk-doctor: sidebar tab type')
        const register = owner.slots.register.bind(owner.slots)
        owner.slots.inject('sidebar.right.pane.tab', () => register({
          name: 'sidebar.right.pane.tab',
          key: TAB_ID,
          inject: () => ({ t, permission })
        }, DiskPanel))

        // Open the panel once per browser session: a reader who closes it keeps it
        // closed until the next load. If the seat is not ready in time the panel
        // stays one click away in the sidebar's own add control.
        let alreadyOpened = true
        try {
          alreadyOpened = window.sessionStorage?.getItem(OPENED_KEY) === '1'
          if (!alreadyOpened) window.sessionStorage?.setItem(OPENED_KEY, '1')
        } catch {
          alreadyOpened = false
        }
        if (!alreadyOpened) {
          const timer = setTimeout(() => {
            try {
              navigation.openTab(TAB_KIND)
            } catch {
              /* the add control still reaches the panel */
            }
          }, 400)
          owner.effect(() => () => clearTimeout(timer), 'dsh-disk-doctor: auto-open timer')
        }
      })
    }

    exports.NS = NS
    exports.LOCALE_NS = LOCALE_NS
    exports.BUNDLE = BUNDLE
    exports.TAB_ID = TAB_ID
    exports.TAB_KIND = TAB_KIND
    exports.REPORT_ROUTE = REPORT_ROUTE
    exports.OPEN_ROUTE = OPEN_ROUTE
    exports.CLEANUP_ROUTE = CLEANUP_ROUTE
    // Pure helpers, exported so the panel's presentation can be checked directly.
    exports.size = size
    exports.shortPath = shortPath
    exports.fill = fill
    exports.renderPanelBody = renderPanelBody
    exports.apply = apply
    exports.inject = inject
    return module.exports
  }
})
