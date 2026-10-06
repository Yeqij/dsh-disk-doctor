/**
 * Report rendering: the Markdown that enters the conversation, the Markdown file
 * written to disk, and the stable JSON document other tools can consume.
 *
 * Rendering is pure: it takes a finished {@link import('./scan.js').scan} result and
 * returns strings, so it is testable without touching the filesystem.
 *
 * @module dsh-disk-doctor/report
 */

import os from 'node:os'

/** The JSON contract version. Bump only on a breaking shape change. */
export const SCHEMA_ID = 'dsh-disk-doctor/report@1'

const UNITS = [
  { suffix: 'TB', scale: 1024 ** 4 },
  { suffix: 'GB', scale: 1024 ** 3 },
  { suffix: 'MB', scale: 1024 ** 2 },
  { suffix: 'KB', scale: 1024 }
]

/**
 * Format a byte count in a fixed unit, so a column of values lines up.
 * @param {number} bytes - the value.
 * @param {{ suffix: string, scale: number }} unit - the unit to use.
 * @returns {string} for example `2.10 GB`.
 */
export function formatIn (bytes, unit) {
  const value = bytes / unit.scale
  const digits = unit.suffix === 'B' ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2
  return `${value.toFixed(digits)} ${unit.suffix}`
}

/**
 * Pick the unit that makes a set of values readable together.
 * @param {number} largest - the biggest value in the set.
 * @returns {{ suffix: string, scale: number }} the chosen unit.
 */
export function pickUnit (largest) {
  for (const unit of UNITS) if (largest >= unit.scale) return unit
  return { suffix: 'B', scale: 1 }
}

/**
 * Format a byte count on its own, choosing a unit per value.
 * @param {number} bytes - the value.
 * @returns {string} for example `380 MB`.
 */
export function formatBytes (bytes) {
  return formatIn(bytes, pickUnit(bytes))
}

/**
 * Build the local-time `YYYYMMDD-HHMMSS` slug used in report filenames.
 * @param {Date} [date] - the instant to encode.
 * @returns {string} the slug.
 */
export function timestampSlug (date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

/**
 * Name the groups that make up the cleanable total.
 *
 * A bare "113 MB is safe to clean up" is a dead end for a reader — it says a number
 * without saying where it lives. Only groups that actually contribute are listed.
 *
 * @param {object[]} categories - the categories of one area.
 * @returns {string} a parenthetical suffix, or an empty string when nothing qualifies.
 */
function cleanableBreakdown (categories) {
  const parts = categories
    .filter((category) => category.bytes > 0 && category.safety === 'safe')
    .sort((a, b) => b.bytes - a.bytes)
    .map((category) => `${category.label} ${formatBytes(category.bytes)}`)
  return parts.length === 0 ? '' : `（来自 ${parts.join('、')}）`
}

/**
 * The three disjoint safety buckets of one area, derived from its categories
 * themselves so the headline numbers can never disagree with the itemised detail
 * beside them.
 *
 * @param {object[]} categories - the categories of one area.
 * @returns {{safe: number, care: number, keep: number}} byte totals per level.
 */
function safetyBuckets (categories) {
  const sum = (level) => categories
    .filter((category) => category.safety === level)
    .reduce((total, category) => total + category.bytes, 0)
  return { safe: sum('safe'), care: sum('care'), keep: sum('keep') }
}

/**
 * One sentence that adds up to the total, naming where the removable part lives.
 * @param {object[]} categories - the categories of one area.
 * @param {{bytes: number}} totals - that area's total.
 * @returns {string} the sentence.
 */
function reclaimSentence (categories, totals) {
  const buckets = safetyBuckets(categories)
  return `一共 **${formatBytes(totals.bytes)}**：`
    + `**${formatBytes(buckets.safe)}** 可以安全清理${cleanableBreakdown(categories)}，`
    + `**${formatBytes(buckets.care)}** 需要正确操作才能省下（例如卸载不用的插件），`
    + `剩下 **${formatBytes(buckets.keep)}** 请不要动。三部分相加就是总数。`
}

/**
 * The categories of one area, in report order.
 * @param {object} report - the scan result.
 * @param {string} areaId - the area id.
 * @returns {object[]} that area's categories.
 */
export function categoriesOf (report, areaId) {
  return (report.categories ?? []).filter((category) => category.area === areaId)
}

/**
 * The areas of a report, tolerating a report built before areas existed.
 * @param {object} report - the scan result.
 * @returns {object[]} the areas, in report order.
 */
export function areasOf (report) {
  if (Array.isArray(report.areas) && report.areas.length > 0) return report.areas
  return [{
    id: 'data',
    label: 'DSH 数据',
    labelEn: 'DSH data',
    totals: report.totals,
    roots: [],
    notes: [],
    categories: (report.categories ?? []).map((category) => category.id)
  }]
}

/** The platform block shared by the JSON document. */
function platformInfo () {
  return { os: process.platform, release: os.release(), node: process.versions.node }
}

/**
 * The largest single item in a category, used for the one-line annotation.
 * @param {object} category - a rendered category.
 * @returns {object|undefined} the biggest item.
 */
function largestItem (category) {
  return category.topItems.length === 0 ? undefined : category.topItems[0]
}

/**
 * True for code points rendered two columns wide in a terminal.
 * @param {number} code - a Unicode code point.
 * @returns {boolean} whether it is fullwidth.
 */
function isFullWidth (code) {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x20000 && code <= 0x3fffd)
  )
}

/**
 * Display width of a string, counting CJK code points as two columns.
 * @param {string} text - the text to measure.
 * @returns {number} the column count.
 */
export function displayWidth (text) {
  let width = 0
  for (const character of text) width += isFullWidth(character.codePointAt(0)) ? 2 : 1
  return width
}

/**
 * Pad to a column count rather than a character count, so mixed CJK/ASCII labels
 * line up in a monospace report.
 * @param {string} text - the text to pad.
 * @param {number} width - the target column count.
 * @returns {string} the padded text.
 */
function padDisplay (text, width) {
  return text + ' '.repeat(Math.max(0, width - displayWidth(text)))
}

/**
 * Render the headline tree: one line per category, optionally with item detail.
 *
 * @param {object[]} categories - the categories of one area.
 * @param {{ unit: object, detail: boolean, indent?: string }} options - rendering options.
 * @returns {string[]} the tree lines.
 */
function renderTree (categories, options) {
  const shown = categories.filter((category) => category.bytes > 0)
  const unit = options.unit
  const labelWidth = Math.max(6, ...shown.map((category) => displayWidth(category.label)))
  const lines = []
  shown.forEach((category, index) => {
    const glyph = index === shown.length - 1 ? '└─' : '├─'
    const size = formatIn(category.bytes, unit).padStart(9)
    const biggest = largestItem(category)
    const notes = []
    if (category.linkedItems > 0) notes.push(`${category.linkedItems} 个链接未跟随`)
    if (category.itemCount > 1) notes.push(`${category.itemCount} 项`)
    if (biggest !== undefined) notes.push(`最大 ${formatBytes(biggest.bytes)}`)
    if (category.truncated) notes.push('已截断')
    const note = notes.length > 0 ? `  (${notes.join('，')})` : ''
    lines.push(`${options.indent ?? '  '}${glyph} ${padDisplay(category.label, labelWidth)} ${size}${note}`)

    if (options.detail) {
      const itemIndent = `${options.indent ?? '  '}${index === shown.length - 1 ? '   ' : '│  '}`
      for (const item of category.topItems) {
        const itemSize = formatIn(item.bytes, unit).padStart(9)
        const note = item.note !== undefined ? `  ${item.note}` : ''
        lines.push(`${itemIndent}  ${itemSize}  ${item.path}${note}`)
      }
      if (category.itemCount > category.topItems.length) {
        lines.push(`${itemIndent}  ${' '.repeat(9)}  … 另有 ${category.itemCount - category.topItems.length} 项未列出`)
      }
    }
  })
  return lines
}

/**
 * One area's title line, plus the sentences saying where its bytes live.
 *
 * A heading is plain text (Markdown headings are already emphasised, and bold inside
 * one renders as literal asterisks in some readers).
 *
 * @param {object} area - the area.
 * @param {{ heading?: boolean, withTitle?: boolean }} [options] - rendering options.
 * @returns {string[]} the lines.
 */
function renderAreaIntro (area, options = {}) {
  const unit = pickUnit(area.totals?.bytes ?? 0)
  const label = `${area.label} — ${formatIn(area.totals?.bytes ?? 0, unit)}`
  const lines = []
  if (options.withTitle !== false) lines.push(options.heading === true ? `## ${label}` : `**${label}**`)
  for (const note of area.notes ?? []) lines.push(`> ${note}`)
  if (lines.length > 0) lines.push('')
  return lines
}

/** How many linked installations the rendered documents spell out. */
const LINK_INSTALL_LIMIT = 10

/**
 * The standalone list of link-installed plugins: real bytes outside the scan scope.
 *
 * @param {object[]} links - the recorded links.
 * @returns {string[]} the lines, or an empty list when there is nothing to say.
 */
function renderLinkInstalls (links) {
  if (!Array.isArray(links) || links.length === 0) return []
  const shown = [...links].sort((a, b) => b.bytes - a.bytes)
  const lines = [
    '**链接安装（真实文件在扫描范围之外，不计入上面的数字）**',
    ''
  ]
  for (const link of shown.slice(0, LINK_INSTALL_LIMIT)) {
    const measured = link.truncated ? `至少 ${formatBytes(link.bytes)}` : formatBytes(link.bytes)
    lines.push(`- ${link.path}`)
    lines.push(`  → 真实位置 \`${link.target}\`，${measured}`)
  }
  if (shown.length > LINK_INSTALL_LIMIT) {
    lines.push(`- …另有 ${shown.length - LINK_INSTALL_LIMIT} 个未列出`)
  }
  lines.push('')
  return lines
}

/**
 * Render the short Markdown summary that enters the conversation.
 *
 * Each area gets its own figure and its own sentence. There is deliberately no
 * grand total: the pnpm store and the plugin `node_modules` trees share physical
 * files, so adding the areas would count the same bytes twice.
 *
 * @param {object} report - the scan result.
 * @param {{ detail?: boolean, reportPath?: string }} [options] - rendering options.
 * @returns {string} the Markdown summary.
 */
export function renderSummary (report, options = {}) {
  const dataUnit = pickUnit(report.totals.bytes)
  const lines = [
    `### DSH 空间体检 — DSH 数据 ${formatIn(report.totals.bytes, dataUnit)} / ${report.totals.files.toLocaleString('en-US')} 个文件`,
    ''
  ]
  for (const area of areasOf(report)) {
    const own = categoriesOf(report, area.id)
    const areaUnit = pickUnit(area.totals?.bytes ?? 0)
    // The headline above already states the data area's figure, so repeating it as a
    // heading here would be noise; its note (where the folder is) still belongs.
    lines.push(...renderAreaIntro(area, { withTitle: area.id !== 'data' }))
    const tree = renderTree(own, { unit: areaUnit, detail: options.detail === true && area.id === 'data' })
    lines.push(...(tree.length === 0 ? ['  （这一部分没有统计到内容）'] : tree))
    if (area.id === 'data') lines.push('', reclaimSentence(own, report.totals))
    lines.push('')
  }
  lines.push(...renderLinkInstalls(report.linkInstalls))
  lines.push(`扫描用时 ${(report.durationMs / 1000).toFixed(1)} 秒${report.truncated ? '（已达上限，结果不完整）' : ''}`)
  if (options.reportPath !== undefined) lines.push(`报告已写入 \`${options.reportPath}\``)
  if (report.warnings.length > 0) {
    lines.push('', '<details><summary>注意事项</summary>', '')
    for (const warning of report.warnings) lines.push(`- ${warning}`)
    lines.push('', '</details>')
  }
  // Every rendered document leaves through here, so no printed path carries a username.
  return redactHome(lines.join('\n'))
}

/**
 * Render the full Markdown report file.
 *
 * @param {object} report - the scan result.
 * @param {{ dshHome: string, generatedAt: Date, jsonPath?: string }} options - document metadata.
 * @returns {string} the Markdown document.
 */
export function renderMarkdownFile (report, options) {
  const unit = pickUnit(report.totals.bytes)
  const areas = areasOf(report)
  const lines = [
    '# DSH 空间体检报告',
    '',
    `- 生成时间：${options.generatedAt.toISOString()}（本地 ${options.generatedAt.toLocaleString('zh-CN')}）`,
    `- 数据文件夹：\`${options.dshHome}\``,
    `- 平台：${process.platform} ${os.release()} · Node ${process.versions.node}`,
    `- DSH 数据区：**${formatIn(report.totals.bytes, unit)}**，${report.totals.files.toLocaleString('en-US')} 个文件，${report.totals.dirs.toLocaleString('en-US')} 个目录`,
    `- ${reclaimSentence(categoriesOf(report, 'data'), report.totals)}`,
    `- 扫描用时：${(report.durationMs / 1000).toFixed(1)} 秒${report.truncated ? '（已达上限，结果不完整）' : ''}`,
    '- 三个区各自独立统计，**不能相加**（「系统缓存」与「DSH 数据」里的 node_modules 是同一批物理文件）',
    ''
  ]

  for (const area of areas) {
    const own = categoriesOf(report, area.id)
    const areaUnit = pickUnit(area.totals?.bytes ?? 0)
    lines.push(...renderAreaIntro(area, { heading: true }))
    lines.push('```', ...renderTree(own, { unit: areaUnit, detail: true }), '```', '')
    if (area.id === 'data') lines.push(reclaimSentence(own, report.totals), '')
  }

  if (Array.isArray(report.linkInstalls) && report.linkInstalls.length > 0) {
    lines.push('## 链接安装', '')
    lines.push('这些插件的真实文件在扫描范围之外（链接安装），因此**不计入上面的任何数字**。', '')
    const ranked = [...report.linkInstalls].sort((a, b) => b.bytes - a.bytes)
    for (const link of ranked.slice(0, LINK_INSTALL_LIMIT)) {
      const measured = link.truncated ? `至少 ${formatBytes(link.bytes)}` : formatBytes(link.bytes)
      lines.push(`- \`${link.path}\` → \`${link.target}\`，${measured}`)
    }
    if (ranked.length > LINK_INSTALL_LIMIT) {
      lines.push(`- …另有 ${ranked.length - LINK_INSTALL_LIMIT} 个未列出`)
    }
    lines.push('')
  }

  if (report.warnings.length > 0) {
    lines.push('## 注意事项', '')
    for (const warning of report.warnings) lines.push(`- ${warning}`)
    lines.push('')
  }

  lines.push('## 明细（Top N）', '')
  for (const area of areas) {
    for (const category of categoriesOf(report, area.id)) {
      if (category.bytes === 0 && category.roots.length === 0) continue
      lines.push(`### [${area.label}] ${category.label} — ${formatBytes(category.bytes)}` +
        `（${category.itemCount} 项，可再生：${category.regenerable ? '是' : '否'}，` +
        `处理建议：${category.safety === 'safe' ? '可以安全清理' : category.safety === 'care' ? '要谨慎处理' : '不要动'}）`, '')
      if (category.roots.length > 0) {
        lines.push(`扫描路径：${category.roots.map((root) => `\`${root}\``).join('、')}`, '')
      }
      if (category.topItems.length === 0) {
        lines.push('_无条目_', '')
        continue
      }
      lines.push('| 大小 | 文件数 | 路径 | 备注 |', '|---|---:|---|---|')
      for (const item of category.topItems) {
        lines.push(`| ${formatBytes(item.bytes)} | ${item.files} | \`${item.path}\` | ${item.note ?? ''} |`)
      }
      lines.push('')
    }
  }

  lines.push('---', '', '本报告由 `dsh-disk-doctor` v0.1 生成：只读扫描，未删除或修改任何文件。', '')
  // Every rendered document leaves through here, so no printed path carries a username.
  return redactHome(lines.join('\n'))
}

/**
 * Replace the user's home directory with `~`.
 *
 * Every path this plugin prints runs through here. A report is meant to be
 * readable and shareable; `C:\Users\<name>\...` carries the account name of
 * whoever ran it, and that has no business travelling with a disk report.
 *
 * @param {*} value - a string, or anything else (returned unchanged).
 * @param {string} [home] - the prefix to replace; defaults to the real home.
 * @returns {*} the redacted value.
 */
export function redactHome (value, home = os.homedir()) {
  if (typeof value !== 'string' || value === '' || home === '') return value
  return value.split(home).join('~')
}

/**
 * Redact every string inside a JSON-shaped value, keys included in the walk.
 * @param {*} value - the value to walk.
 * @param {string} [home] - the prefix to replace.
 * @returns {*} a redacted copy.
 */
export function redactDeep (value, home = os.homedir()) {
  if (typeof value === 'string') return redactHome(value, home)
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, home))
  if (value !== null && typeof value === 'object') {
    const out = {}
    for (const [key, item] of Object.entries(value)) out[key] = redactDeep(item, home)
    return out
  }
  return value
}

/**
 * Project the scan result onto the stable JSON contract.
 *
 * The projection is additive over `@1`: `areas`, `linkInstalls` and `capabilities`
 * arrived with the three-area report, and every category now names the area it
 * belongs to and how many of its bytes overlap another area.
 *
 * @param {object} report - the scan result.
 * @param {{ dshHome: string, generatedAt: Date, redact?: boolean,
 *   capabilities?: { openFolder: boolean, openFolderSensitive: boolean } }} options
 *   - document metadata.
 * @returns {object} the JSON document.
 */
export function toJsonReport (report, options) {
  const document = {
    schema: SCHEMA_ID,
    generatedAt: options.generatedAt.toISOString(),
    dshHome: options.dshHome,
    platform: platformInfo(),
    durationMs: report.durationMs,
    truncated: report.truncated,
    // The headline number is the data area. The other areas carry their own totals
    // and are never added to it, because they share physical files with it.
    totals: report.totals,
    areas: areasOf(report).map((area) => ({
      id: area.id,
      label: area.label,
      labelEn: area.labelEn,
      bytes: area.totals?.bytes ?? 0,
      files: area.totals?.files ?? 0,
      dirs: area.totals?.dirs ?? 0,
      roots: area.roots ?? [],
      notes: area.notes ?? [],
      categories: area.categories ?? []
    })),
    regenerableBytes: report.regenerableBytes,
    contentBytes: report.contentBytes,
    symlinksSkipped: report.symlinks,
    unreadableEntries: report.unreadable,
    linkInstalls: (report.linkInstalls ?? []).map((link) => ({
      path: link.path,
      target: link.target,
      bytes: link.bytes,
      files: link.files,
      truncated: link.truncated,
      categoryId: link.categoryId,
      area: link.area
    })),
    capabilities: {
      openFolder: options.capabilities?.openFolder === true,
      openFolderSensitive: options.capabilities?.openFolderSensitive === true,
      // The one permission that lets the panel move files: off unless the user turns it on.
      cleanup: options.capabilities?.cleanup === true
    },
    categories: report.categories.map((category) => ({
      id: category.id,
      area: category.area,
      label: category.label,
      labelEn: category.labelEn,
      bytes: category.bytes,
      files: category.files,
      dirs: category.dirs,
      regenerable: category.regenerable,
      safety: category.safety,
      itemCount: category.itemCount,
      linkedItems: category.linkedItems,
      overlapBytes: category.overlapBytes ?? 0,
      roots: category.roots,
      topItems: category.topItems
    })),
    warnings: report.warnings
  }
  // The browser panel draws on the user's own screen and needs real paths so they can
  // be copied. Everything that leaves the machine — the tool result, the saved file —
  // stays redacted.
  return options.redact === false ? document : redactDeep(document)
}
