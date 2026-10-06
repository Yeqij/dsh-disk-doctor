/**
 * `dsh-disk-doctor` — read-only disk accounting for DeepSeek Harness.
 *
 * v0.1 is deliberately incapable of destroying anything: it walks `$DSH_HOME` and
 * the session temp directories, sizes what it finds, and writes a report into its
 * own report directory. There is no delete path, no network call, and no write
 * outside that one directory.
 *
 * @module dsh-disk-doctor
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

import { detectAppRoot, detectChromiumDataDir, detectNpmGlobalDsh, detectPnpmStore, expandHome, resolveDshHome } from './locate.js'
import { redactDeep, renderMarkdownFile, renderSummary, timestampSlug, toJsonReport } from './report.js'
import { scan } from './scan.js'
import { registerCleanupRoute, registerOpenRoute, registerReportRoute } from './serve.js'
import { CATEGORY_DEFS } from './targets.js'

/** Cordis plugin name. */
export const name = 'disk-doctor'

/** The tool registry this plugin publishes into. */
export const inject = ['tools']

/** Every category id a caller may name in `categories`. */
export const CATEGORY_IDS = CATEGORY_DEFS.map((def) => def.id)

/** The model-facing tool name. */
export const TOOL_NAME = 'disk_report'

/**
 * Default DSH data folder: `$DSH_HOME` when set, otherwise `~/.dsh`.
 *
 * DSH itself reads that variable, so a plugin that ignored it would report on a
 * folder DSH never opens — on any machine whose owner moved their data.
 *
 * @param {NodeJS.ProcessEnv} [env] - the process environment.
 * @param {string} [home] - the OS home directory.
 * @returns {string} the data folder.
 */
export function defaultDshHome (env = process.env, home = os.homedir()) {
  return resolveDshHome(env, home)
}

/**
 * Mark one configuration field as live-editable.
 *
 * DSH projects a settings form only for fields declared `.volatile()`; every other
 * field is ordinary configuration, edited through the profile's Cordis patch. A
 * host whose schemastery predates the method keeps the field plain, so the plugin
 * still loads there rather than failing on an unknown method.
 *
 * @param {object} schema - the field schema.
 * @returns {object} the schema, marked when the host supports it.
 */
function volatile (schema) {
  const mark = schema.volatile
  return typeof mark === 'function' ? mark.call(schema) : schema
}

/**
 * Plugin configuration. The host derives the settings page from the fields marked
 * `.volatile()`, so every field carries a Chinese description for the UI.
 */
export const Config = z.object({
  dshHome: volatile(z.string().default(defaultDshHome()).description('扫描根目录，默认 ~/.dsh')),
  topN: volatile(z.natural().min(1).max(100).default(10).description('每个类别列出的条目数（1..100）')),
  excludeGlobs: volatile(z.array(z.string()).default([]).description('额外排除的绝对路径通配符，例如 C:\\Users\\me\\.dsh\\big-*')),
  reportDir: volatile(z.string().default('').description('报告输出目录，留空则用 <dshHome>/disk-doctor/reports')),
  followSymlinks: volatile(z.boolean().default(false).description('是否跟随符号链接与 junction，默认否（防重复计数与越界）')),
  allowOpenFolder: volatile(z.boolean().default(true).description(
    '允许在系统文件管理器里打开「可以安全清理」的位置，默认开；关掉后面板上所有「打开」按钮都会变灰')),
  allowOpenFolderSensitive: volatile(z.boolean().default(false).description(
    '允许打开「要谨慎处理」和「不要动」两档的位置（对话目录、程序文件），默认否')),
  allowCleanup: volatile(z.boolean().default(false).description(
    '允许把「可以安全清理」的内容移动到回收站文件夹，默认否（只移动、绝不删除，随时可一键撤销）')),
  appDir: volatile(z.string().default('').description('DSH 程序安装目录，留空则自动探测（一般不用填）'))
})

/**
 * Read one configuration field.
 *
 * A `.volatile()` field reaches `apply` as a frozen box exposing `get()`, not as
 * the plain value; on a host that does not mark fields it arrives plain. Both
 * shapes are accepted, so the same module works on either host generation.
 *
 * @param {unknown} value - the raw field value.
 * @returns {unknown} the plain value.
 */
export function plainValue (value) {
  if (value !== null && typeof value === 'object' && typeof value.get === 'function' && Object.isFrozen(value)) {
    return value.get()
  }
  return value
}

/**
 * Canonicalize a directory path by resolving symlinks and junctions in its deepest
 * existing ancestor, then re-appending the not-yet-created segments.
 *
 * `path.resolve` alone would leave a link in the report path pointing elsewhere, so
 * a write could land outside the tree the configuration names. Resolving first makes
 * the comparison below meaningful.
 *
 * @param {string} target - the path to canonicalize.
 * @returns {string} the canonical absolute path.
 */
export function canonicalizeDirectory (target) {
  const resolved = path.resolve(target)
  const missing = []
  let existing = resolved
  for (;;) {
    try {
      const real = fs.realpathSync(existing)
      return missing.length === 0 ? real : path.join(real, ...missing.reverse())
    } catch {
      const parent = path.dirname(existing)
      if (parent === existing) return resolved
      missing.push(path.basename(existing))
      existing = parent
    }
  }
}

/**
 * Resolve raw config into the concrete settings one scan uses.
 *
 * The three folders outside the data directory are *detected*, not guessed: the
 * application folder comes from the running executable, and the two system caches
 * from the platform's own variables. An explicit `appDir` overrides detection, which
 * is the escape hatch for a deployment the heuristics cannot recognise.
 *
 * @param {object|undefined} raw - config as supplied by the host.
 * @param {object} [deps] - injectable world, for tests: `env`, `home`, `execPath`,
 *   `resourcesPath`, `isDirectory`, `isFile`.
 * @returns {{ dshHome: string, topN: number, excludeGlobs: string[], reportDir: string,
 *   followSymlinks: boolean, allowOpenFolder: boolean, allowOpenFolderSensitive: boolean,
 *   paths: { appRoot: string|null, appRootSource: string|null, chromiumDir: string|null,
 *     pnpmStore: string|null }, reportDirExplicit: boolean, reportDirOutsideHome: boolean }}
 *   normalized settings.
 */
export function normalizeConfig (raw, deps = {}) {
  const config = raw ?? {}
  const home = deps.home ?? os.homedir()
  const rawDshHome = plainValue(config.dshHome)
  const dshHome = canonicalizeDirectory(expandHome(
    typeof rawDshHome === 'string' && rawDshHome.trim() !== '' ? rawDshHome.trim() : defaultDshHome(),
    home
  ))
  const configuredTopN = Number(plainValue(config.topN))
  const topN = Number.isInteger(configuredTopN) && configuredTopN >= 1 && configuredTopN <= 100 ? configuredTopN : 10
  const rawGlobs = plainValue(config.excludeGlobs)
  const excludeGlobs = Array.isArray(rawGlobs)
    ? rawGlobs.filter((glob) => typeof glob === 'string' && glob.trim() !== '')
    : []
  const rawReportDir = plainValue(config.reportDir)
  const reportDirRaw = typeof rawReportDir === 'string' ? rawReportDir.trim() : ''
  // Exactly one writable location exists in this plugin: the report directory.
  const reportDir = canonicalizeDirectory(
    reportDirRaw !== '' ? expandHome(reportDirRaw, home) : path.join(dshHome, 'disk-doctor', 'reports')
  )
  const reportDirExplicit = reportDirRaw !== ''

  const rawAppDir = plainValue(config.appDir)
  const appDirRaw = typeof rawAppDir === 'string' ? rawAppDir.trim() : ''
  const detectedApp = appDirRaw !== ''
    ? { path: expandHome(appDirRaw, home), source: 'config' }
    : detectAppRoot(deps)
  const detectedChromium = detectChromiumDataDir(deps)
  const detectedPnpm = detectPnpmStore(deps)
  const detectedNpm = detectNpmGlobalDsh(deps)
  const paths = {
    appRoot: detectedApp === null ? null : canonicalizeDirectory(detectedApp.path),
    appRootSource: detectedApp === null ? null : detectedApp.source,
    npmGlobalDsh: detectedNpm === null ? null : canonicalizeDirectory(detectedNpm),
    chromiumDir: detectedChromium === null ? null : canonicalizeDirectory(detectedChromium),
    pnpmStore: detectedPnpm === null ? null : canonicalizeDirectory(detectedPnpm)
  }

  return {
    dshHome,
    topN,
    excludeGlobs,
    reportDir,
    followSymlinks: plainBoolean(config.followSymlinks, false),
    allowOpenFolder: plainBoolean(config.allowOpenFolder, true),
    allowOpenFolderSensitive: plainBoolean(config.allowOpenFolderSensitive, false),
    // Off by default: this is the only setting in the plugin whose switch is a permission
    // to move the user's files.
    allowCleanup: plainBoolean(config.allowCleanup, false),
    paths,
    reportDirExplicit,
    reportDirOutsideHome: reportDirExplicit && !isUnder(reportDir, dshHome)
  }
}

/**
 * Read a boolean field, falling back to the documented default.
 *
 * The host applies the schema's defaults before `apply` sees the config, but a host
 * generation that does not, and any code that normalizes a bare object, would otherwise
 * read `undefined` as `false` — which for `allowOpenFolder` is the opposite of what the
 * schema promises. The defaults are therefore stated here as well as in the schema.
 *
 * @param {unknown} value - the raw field value.
 * @param {boolean} fallback - the value the schema declares as the default.
 * @returns {boolean} the effective value.
 */
function plainBoolean (value, fallback) {
  const plain = plainValue(value)
  return typeof plain === 'boolean' ? plain : fallback
}

/**
 * True when `candidate` is `base` itself or lies inside it.
 * @param {string} candidate - absolute path.
 * @param {string} base - absolute path.
 * @returns {boolean} whether `candidate` is inside `base`.
 */
export function isUnder (candidate, base) {
  const rel = path.relative(path.resolve(base), path.resolve(candidate))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/** Clamp a caller-supplied `topN` to the documented 1..100 range. */
function resolveTopN (requested, fallback) {
  if (requested === undefined || requested === null) return fallback
  const value = Number(requested)
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new Error(`topN must be an integer between 1 and 100, got ${JSON.stringify(requested)}`)
  }
  return value
}

/** Reject unknown category ids with the valid set, instead of silently ignoring them. */
function resolveCategories (requested) {
  if (requested === undefined || requested === null || requested.length === 0) return undefined
  const unknown = requested.filter((id) => !CATEGORY_IDS.includes(id))
  if (unknown.length > 0) {
    throw new Error(`unknown categories: ${unknown.join(', ')}. Valid ids: ${CATEGORY_IDS.join(', ')}`)
  }
  return [...new Set(requested)]
}

/**
 * The `disk_report` tool definition.
 *
 * @param {object} settings - normalized plugin settings, as of load time.
 * @param {() => object} [current] - re-reads the live settings; volatile fields are
 *   edited without re-applying the plugin, so anything that can change has to be read
 *   again when it is used rather than captured once.
 * @returns {object} a registry-ready tool definition.
 */
function defineDiskReport (settings, current) {
  const live = () => current === undefined ? settings : current()
  return defineTool({
    name: TOOL_NAME,
    description:
      'Report how much disk space DeepSeek Harness occupies on this machine (read-only). ' +
      'Three areas are reported side by side and never summed: the DSH data folder, the DSH ' +
      'application install folder, and the system caches DSH feeds (desktop user data, pnpm store). ' +
      'Each area is broken down by category (session logs, plugin node_modules, runtimes, temp spill, …), ' +
      'the largest items per category are listed, link-installed plugins are named separately, and ' +
      'Markdown + JSON reports are written. It never deletes or modifies anything. ' +
      '中文：只读统计 DSH 的磁盘占用，分「数据 / 程序 / 系统缓存」三个区各自独立统计（不相加），' +
      '附 Top N 明细与链接安装清单，不删除任何文件。',
    parameters: {
      scope: {
        type: 'string',
        enum: ['summary', 'full'],
        description: 'summary = 只看分类汇总（默认）；full = 附带每个类别的 Top N 明细。'
      },
      topN: {
        type: 'integer',
        description: '每个类别列出的条目数，1..100；默认取插件配置。'
      },
      write: {
        type: 'boolean',
        description: '是否把 Markdown/JSON 报告写入报告目录，默认 true。'
      },
      categories: {
        type: 'array',
        items: { type: 'string', enum: CATEGORY_IDS },
        description: `只统计这些类别，默认全部。可选：${CATEGORY_IDS.join(', ')}`
      }
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          markdown: { type: 'string', required: true },
          reportPath: { type: 'string' },
          jsonPath: { type: 'string' },
          totals: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              bytes: { type: 'integer', required: true },
              files: { type: 'integer', required: true },
              dirs: { type: 'integer', required: true }
            }
          },
          regenerableBytes: { type: 'integer', required: true },
          contentBytes: { type: 'integer', required: true },
          durationMs: { type: 'integer', required: true },
          truncated: { type: 'boolean', required: true },
          warnings: { type: 'array', required: true, items: { type: 'string' } },
          areas: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                label: { type: 'string', required: true },
                bytes: { type: 'integer', required: true },
                files: { type: 'integer', required: true },
                dirs: { type: 'integer', required: true },
                roots: { type: 'array', required: true, items: { type: 'string' } },
                notes: { type: 'array', required: true, items: { type: 'string' } },
                categories: { type: 'array', required: true, items: { type: 'string' } }
              }
            }
          },
          linkInstalls: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                path: { type: 'string', required: true },
                target: { type: 'string', required: true },
                bytes: { type: 'integer', required: true },
                files: { type: 'integer', required: true },
                truncated: { type: 'boolean', required: true },
                categoryId: { type: 'string', required: true },
                area: { type: 'string', required: true }
              }
            }
          },
          categories: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                area: { type: 'string', required: true, enum: ['data', 'app', 'cache'] },
                label: { type: 'string', required: true },
                bytes: { type: 'integer', required: true },
                files: { type: 'integer', required: true },
                regenerable: { type: 'boolean', required: true },
                safety: { type: 'string', required: true, enum: ['safe', 'care', 'keep'] },
                itemCount: { type: 'integer', required: true },
                overlapBytes: { type: 'integer', required: true },
                roots: { type: 'array', required: true, items: { type: 'string' } },
                topItems: {
                  type: 'array',
                  required: true,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      path: { type: 'string', required: true },
                      bytes: { type: 'integer', required: true },
                      files: { type: 'integer', required: true },
                      mtimeMs: { type: 'integer', required: true },
                      note: { type: 'string' }
                    }
                  }
                }
              }
            }
          }
        }
      },
      render: (_args, value) => [{ type: 'text', text: value.markdown }]
    },
    async execute (args) {
      const settings = live()
      const topN = resolveTopN(args.topN, settings.topN)
      const only = resolveCategories(args.categories)
      const report = await scan({
        dshHome: settings.dshHome,
        tempDir: os.tmpdir(),
        appRoot: settings.paths.appRoot,
        appRootSource: settings.paths.appRootSource,
        npmGlobalDsh: settings.paths.npmGlobalDsh,
        chromiumDir: settings.paths.chromiumDir,
        pnpmStore: settings.paths.pnpmStore,
        topN,
        excludeGlobs: settings.excludeGlobs,
        followSymlinks: settings.followSymlinks,
        ...(only === undefined ? {} : { only })
      })

      const generatedAt = new Date()
      if (settings.reportDirOutsideHome) {
        // An explicitly configured directory outside $DSH_HOME is the one
        // authorized write outside the scan root; it is always surfaced.
        report.warnings.push(`报告目录位于 $DSH_HOME 之外，由配置显式指定：${settings.reportDir}`)
      }
      let reportPath
      let jsonPath
      if (args.write !== false) {
        fs.mkdirSync(settings.reportDir, { recursive: true })
        const stem = `disk-report-${timestampSlug(generatedAt)}`
        reportPath = path.join(settings.reportDir, `${stem}.md`)
        jsonPath = path.join(settings.reportDir, `${stem}.json`)
        fs.writeFileSync(reportPath, renderMarkdownFile(report, { dshHome: settings.dshHome, generatedAt }), 'utf8')
        fs.writeFileSync(jsonPath, `${JSON.stringify(toJsonReport(report, { dshHome: settings.dshHome, generatedAt }), null, 2)}\n`, 'utf8')
      }

      // The tool result reaches session logs and the conversation, so the home
      // directory is redacted here as well — not just in the rendered document.
      return redactDeep({
        markdown: renderSummary(report, { detail: args.scope === 'full', reportPath }),
        ...(reportPath === undefined ? {} : { reportPath, jsonPath }),
        totals: report.totals,
        areas: report.areas.map((area) => ({
          id: area.id,
          label: area.label,
          bytes: area.totals.bytes,
          files: area.totals.files,
          dirs: area.totals.dirs,
          roots: area.roots,
          notes: area.notes,
          categories: area.categories
        })),
        linkInstalls: report.linkInstalls.map((link) => ({
          path: link.path,
          target: link.target,
          bytes: link.bytes,
          files: link.files,
          truncated: link.truncated,
          categoryId: link.categoryId,
          area: link.area
        })),
        regenerableBytes: report.regenerableBytes,
        contentBytes: report.contentBytes,
        durationMs: report.durationMs,
        truncated: report.truncated,
        warnings: report.warnings,
        categories: report.categories.map((category) => ({
          id: category.id,
          area: category.area,
          label: category.label,
          bytes: category.bytes,
          files: category.files,
          regenerable: category.regenerable,
          safety: category.safety,
          itemCount: category.itemCount,
          overlapBytes: category.overlapBytes ?? 0,
          roots: category.roots,
          topItems: category.topItems
        }))
      })
    },
    presentCall: (args) => ({
      card: 'generic',
      title: 'DSH 空间体检',
      kind: 'other',
      rawInput: args
    })
  })
}

/**
 * Register the `disk_report` tool.
 *
 * The two routes and the tool all read their settings through `current()` rather than
 * from the snapshot taken here. A `.volatile()` field is live-editable: the host
 * writes the new value into the same frozen reference and does *not* re-apply the
 * plugin, so a value captured at load time would keep answering with the old one —
 * a permission switch that appears to do nothing until the next restart.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - the plugin context.
 * @param {object} [config] - raw plugin config.
 * @param {{ reveal?: (directory: string) => void }} [deps] - extra collaborators,
 *   used by tests to drive the whole plugin without opening a file-manager window.
 */
export function apply (ctx, config, deps = {}) {
  const raw = config ?? {}
  const settings = normalizeConfig(raw)
  const current = () => normalizeConfig(raw)
  ctx.tools.register(defineDiskReport(settings, current))
  // The browser panel reads the same report over a local, read-only route.
  registerReportRoute(ctx, settings, current)
  // The cleanup preview: what a cleanup would move, with no power to move it.
  registerCleanupRoute(ctx, settings, current)
  // …and may reveal a folder, but only inside the scan root and only when enabled.
  registerOpenRoute(ctx, settings, current, deps)
}
