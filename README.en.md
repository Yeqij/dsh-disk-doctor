# dsh-disk-doctor

> **DSH never deletes anything, so this number only grows.** `dsh-disk-doctor` lays out where DeepSeek Harness space actually goes — three areas side by side, how much per category, which parts are regenerable, and which parts are your own session content.

**v0.1 never deletes anything.** It measures and reports, and its one mutation is a **rename**: when you switch cleanup on and confirm it, a 🟢「可以安全清理」folder is moved into the plugin's own quarantine folder under `~/.dsh/disk-doctor/quarantine/` — not copied, not deleted, and reversible with one click. Everything else it does is read-only.

---

## Capability declaration

Read this before installing. It is the whole contract.

| Question | Answer |
|---|---|
| What does it read? | Directory metadata (`stat` sizes) under `$DSH_HOME` (default `~/.dsh`) — wherever that variable points — plus both DSH installations, the two system caches, and directories named `dsh-*` in the system temp directory. It never opens, parses, or uploads file contents; the single exception is `storages/workspace.json`, read only to print each session folder with its workspace title. |
| What does it write? | Exactly two files per report — `disk-report-<timestamp>.md` and `.json` — inside one directory (`<dshHome>/disk-doctor/reports` by default). A confirmed cleanup additionally writes a quarantine batch: the moved folders themselves (a rename — the same bytes, in a new place) plus a `manifest.json` that is rewritten after **every single item**, so an interrupted run still leaves a record that matches the disk. Nothing is ever deleted or copied. |
| Does it delete or modify anything? | **It never deletes.** There is no delete path anywhere: a test forbids `unlink`, `unlinkSync`, `rmdir`, `rmdirSync`, `rm(`, `rmSync`, `trashItem`, `Remove-Item` and `shutil.rmtree` across the whole package. What a confirmed cleanup does is **rename** a green folder into the plugin's own quarantine folder — a single mutating call (`renameSync`), which a test asserts appears in exactly one file, `lib/cleanup.js`. Emptying the quarantine stays your job, done outside this plugin. |
| Does it use the network? | **No.** No `fetch`, no `http`/`https`, no sockets. A test asserts this too. |
| Does it leave `$DSH_HOME`? | Yes — for the folders it reports on but does not own: both DSH installations (the packed application and the global npm one), the desktop user-data folder, and the pnpm content store. All of them are *detected* rather than guessed (see [The three areas](#the-three-areas-and-why-there-is-no-grand-total)), measured read-only, and named in the report. It still never follows a symlink or junction by default, so bytes reachable only through a link outside the tree are not counted. |
| Does it phone home or report telemetry? | No. There is no analytics code. |
| Does it print my real paths? | It depends where the text goes. The sidebar panel shows **real paths**, because that is where you copy them and reveal the location from. Everything that leaves the machine — the tool result, the Markdown report and the JSON report — replaces your home directory with `~`, so `C:\Users\<you>\.dsh\…` travels as `~\.dsh\…`. That split is deliberate: the panel has to hand you a copyable path, while anything leaving the machine must not carry your account name. |
| Does it open a port or serve anything? | It registers **three routes** on DSH's own local web server, and listens on nothing of its own. `GET /dsh-disk-doctor/report` returns the same JSON the tool returns, so the sidebar panel can draw it, and never writes a file. `GET /dsh-disk-doctor/cleanup` returns the cleanup **preview** plus the batches already sitting in quarantine; `POST /dsh-disk-doctor/cleanup?action=move` performs a move and `POST …?action=undo&id=<batch>` puts one batch back — both are refused with 403 `disabled` unless the cleanup switch is on, and both re-read the live settings so the switch needs no restart. `POST /dsh-disk-doctor/open` asks the host to reveal one folder in the OS file manager: it is POST-only, and refuses any path outside the roots the scan actually covers. Opening a 🟢「可以安全清理」folder works out of the box; the 🟠「要谨慎处理」and ⚪「不要动」rows need a second switch that is off by default. Nothing is registered when no web server is composed. All three ask the Host's own browser-trust fence for a verdict before doing anything — the same Host/Origin check and browser authentication the official routes use — so a page you merely visited cannot POST a move or pop open a file-manager window. |

These claims are machine-readable too: the manifest declares `dshhub.permissions.network` as an **empty list** — no origins at all — alongside `dshhub.surfaces: ["host", "web"]` and `schemaVersion: 1`. A test binds that declaration to the code: it fails if either half gains an *outbound* call, while the browser half is allowed to `fetch` its own host's relative route.

---

## What you get

**A panel in the right sidebar.** Open **Disk space** to see the three areas one under another — **DSH data**, **DSH application**, **System caches** — each with its own figure, one bar per kind of content, and — when you open a bar — the largest folders inside it plus a sentence saying whether it is safe to remove. The headline belongs to the data area, so it says "DSH data is using …", not "DSH is using …". Rows carry an **Open** button that reveals the folder in your file manager: 🟢「可以安全清理」rows work straight away, while the 🟠 and ⚪ rows stay greyed out until you allow sensitive locations. A colour key at the bottom of the panel spells out what the three dots mean. Below the areas sit two more boxes: a **Cleanup** box that first lists what a cleanup would move and then — only after you switch cleanup on and confirm a second time — moves those folders into the plugin's own quarantine, with an **Undo** button and a list of other batches still waiting (see [Cleanup](#cleanup-preview-move-and-undo)); and a short guide to the operations that actually free space. Link-installed plugins get a list of their own, because their real files sit outside every scanned folder. The panel opens by itself the first time. This is the surface to point a non-technical user at.

**A `disk_report` tool.** The same numbers, on demand from the model, written up as a Markdown summary plus `.md`/`.json` report files. Its result carries the `areas` and `linkInstalls` blocks too, and every category names its area and how many of its bytes overlap another one.

**Three views inside the data box.** **Overview** puts one slice per category; **By plugin** and **By conversation** name their entries instead. The two name views carry a small **显示完整路径 / 显示名称** pill in the legend's corner that flips their labels between names and full paths — the same preference the ⚙ switch sets, so the two controls cannot disagree. Conversations are labelled with their **real workspace title** plus a short session tag (`disk-doctor · 64875ca0`, never `E\disk-doctor · session-`), and the expandable list rows use the same labels. Plugins keep their package name (`dsh-image-gen`, `@scope/pkg`): the prettier `displayName` lives in each plugin's own `package.json`, and reading those would break the promise that only `storages/workspace.json` is ever opened.

**Eight settings** on the plugin's page under **Plugins → Installed** — three plain fields, five behind *Advanced*, two of them switches — plus a ninth, `allowCleanup`, which lives in the panel's own **⚙** gear because that is where the button it governs is. It is still a host setting, saved through the same profile patch. See [USAGE.md](./USAGE.md) for what each one means in plain words, and for how to hand this plugin to someone else.

> **v0.1 never deletes.** A confirmed cleanup moves the 🟢「可以安全清理」folders into the plugin's own quarantine folder, a second click puts them back, and emptying that folder stays your job. Plugins and conversations are never touched — uninstall plugins the normal way, from the Plugins page.

---

## The three areas, and why there is no grand total

The report splits the machine into three areas and prints **a total for each one, side by side**:

| Area | What it is | On the machine these figures come from |
|---|---|---|
| `data` | The DSH **data folder** — `$DSH_HOME`, default `~/.dsh`: session content, storage and projection caches, plugin `node_modules`, bundled runtimes, and the unpacked Electron runtime under `~/.dsh/electron`. | 735 MB |
| `app` | The **DSH application**, in both installations one machine can have: the packed Electron application (`E:\dsh1` here) and the separate global npm installation (`%APPDATA%\npm\node_modules\@deepseek-ai\dsh`, 254.8 MB here) that a profile's shared `node_modules` is mostly junctions into. Read-only: an uninstaller owns these folders, not this plugin. | 1270 MB (1.2 GB) |
| `cache` | **System caches** DSH feeds but does not own: the Chromium user-data folder (`%APPDATA%\@deepseek-ai\dsh-desktop`) and the pnpm content store (`%LOCALAPPDATA%\pnpm`). | 126 MB |

**The areas are never added together, and no grand total is printed.** The pnpm content store holds the *real* files that the plugin `node_modules` entries are hard-linked to, so adding the areas would count the same physical bytes twice. The `pnpm-store` category therefore reports `overlapBytes` — measured by inode — and the cache area carries that sentence in its own words. On this machine the 112 MB pnpm store overlapped the data area by about 109 MB.

The number the panel and the summary lead with is the **data area** — the part of DSH you actually own — which is why the panel reads "DSH data is using …" rather than implying it counted everything.

*Measured on the development machine, 2026-10-07.*

---

## Requirements

- DeepSeek Harness `>=0.1.0-rc.2`, declared as `engines.dsh` in the manifest — `0.2.0-rc.2` and `0.2.1-rc.2` have both been run against it, and a version outside the declared range is refused by DSH itself instead of loading silently
- Node.js `^22.19.0 || >=24.0.0`
- No runtime dependencies. No build step. No bundler — the browser half is hand-written in the web client's own module format.

## Install

> Published on **npm**. Restart DSH after installing. When npm is not reachable, install from a local folder instead — [TRIAL-INSTALL.md](./TRIAL-INSTALL.md) for a development checkout, or [USAGE.md](./USAGE.md) for the no-command route through **Plugins → Add plugin**.

```
dsh plugin --profile <profile> add dsh-disk-doctor
```

`dsh plugin` forwards to pnpm inside the profile directory, and the plugin manager selects the new bundle by default, so the plugin's `dsh.bundle.patch` is inserted into the profile's layer stack automatically. A local absolute path works in place of the package name.

`pnpm` must be reachable on your `PATH` for this command — if it is not, [TRIAL-INSTALL.md](./TRIAL-INSTALL.md) gives a one-line shim that uses the pnpm bundled with the DSH runtime.

After installing and restarting, the **Disk space** panel is in the right sidebar, `disk_report` is available to the model, and **eight** configuration fields appear on the plugin's own page under **Plugins → Installed** — the ninth, **Allow cleanup (move to quarantine)**, deliberately lives in the panel's own ⚙ gear, beside the button it governs.

## Usage

Ask in natural language — *"DSH 占了多少磁盘？"* / *"where did my disk space go?"* — or call the tool directly.

### `disk_report`

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `scope` | `"summary"` \| `"full"` | `"summary"` | `summary` prints the category roll-up; `full` adds each category's Top N items inline. |
| `topN` | integer `1..100` | plugin config | Items listed per category. Out-of-range values are rejected, not clamped silently. |
| `write` | boolean | `true` | Write the Markdown and JSON report files. |
| `categories` | string[] | all | Restrict the scan (and therefore the totals) to these category ids. Unknown ids are rejected. |

The tool returns the Markdown summary that appears in the conversation, the absolute path of each written report, and the JSON structure.

### Sample output

Real output from a working installation (paths and per-item figures abbreviated):

```
### DSH 空间体检 — DSH 数据 735 MB / 8,903 个文件

> 数据文件夹：~\.dsh

  ├─ 会话日志            2.73 MB  (3 项，最大 1.15 MB)
  ├─ 存储与投影缓存      0.13 MB  (5 项，最大 91.5 KB)
  ├─ 插件 node_modules    109 MB  (511 个链接未跟随，23 项，最大 62.3 MB)
  ├─ 插件安装日志        0.00 MB  (最大 3.70 KB)
  ├─ 市场数据            0.02 MB  (最大 17.8 KB)
  ├─ 运行时依赖           272 MB  (4 项，最大 165 MB)
  ├─ 临时目录与溢出      3.82 MB  (10 项，最大 3.24 MB)
  ├─ 附件                0.27 MB  (最大 279 KB)
  ├─ Electron 运行文件    347 MB  (21 项，最大 215 MB)
  └─ 其他                0.10 MB  (19 项，最大 22.8 KB)

一共 **735 MB**：**3.84 MB** 可以安全清理（来自 临时目录与溢出 3.82 MB、市场数据 17.8 KB、插件安装日志 3.70 KB），**109 MB** 需要正确操作才能省下（例如卸载不用的插件），剩下 **622 MB** 请不要动。三部分相加就是总数。

**DSH 程序 — 1.24 GB**
> 安装位置：E:\dsh1（自动找到）；npm 全局安装：~\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh；只读展示，不参与清理

  ├─ 程序安装目录            0.99 GB  (22 项，最大 649 MB)
  └─ 全局安装的 DSH（npm）   0.25 GB  (8 项，最大 255 MB)

**系统缓存 — 126 MB**
> 这些是 DSH 之外的位置，与上面的区不能相加：桌面端用户数据 ~\AppData\Roaming\@deepseek-ai\dsh-desktop、pnpm 内容仓库 ~\AppData\Local\pnpm
> 注意：其中约 109 MB 与「DSH 数据」里的插件文件是同一批物理文件（硬链接），所以两个区的数字不能相加，也不是删掉就能省下这么多。

  ├─ 桌面端用户数据   13.9 MB  (24 项，最大 9.30 MB)
  └─ pnpm 内容仓库     112 MB  (最大 112 MB)

**链接安装（真实文件在扫描范围之外，不计入上面的数字）**

- ~\.dsh\profiles\desktop\node_modules\dsh-disk-doctor
  → 真实位置 `<你的插件目录>\dsh-disk-doctor`，420 KB

扫描用时 7.2 秒
报告已写入 `~\.dsh\disk-doctor\reports\disk-report-20261007-094500.md`
```

Three things in that sample are worth pointing out. The data area's figure is already in the headline, so its note follows directly and no second title is printed; **each of the other two areas carries its own heading and its own figure**, and none of them is ever summed with the others — the cache area says in words why. A **bounded measurement prints as `至少 <size>`**: if the walk of a link target hits its own ceiling, the line reads "至少 12.4 MB" instead of pretending to be exact. And the **link list is capped at 10 lines** in the rendered documents, with a final "…另有 N 个未列出" when there are more.

Traversal is parallel — sixteen subdirectories and sixty-four `lstat` calls in flight — so a full three-area pass takes a few seconds even though the npm installation is about 33,000 files.

With `scope: "full"`, the data area is followed by its largest items, each with an absolute path — so every number can be traced back to the files that produced it.

## Configuration

Edit eight of the fields on the plugin's own page — and the ninth, `allowCleanup`, from the panel's **⚙** gear — or write any of them in the profile's Cordis patch.

### Where the form is

Sidebar → **Plugins** → **Installed** → the `dsh-disk-doctor` card → its page carries the form. It is contributed through `plugins.bundle.config`, keyed by the bundle's package name, so only that bundle's own page can render it. If the Host has not served the plugin's settings namespace yet, the form says so rather than disappearing.

This is a property worth knowing if you write a DSH plugin yourself: **a schema alone does not produce a page.** `dsh-settings` projects a form only from fields declared `.volatile()` (all nine are), and no shipped client builds pages from a schema — `autoGenerate` exists for that purpose and nothing consumes it. The page has to come from the plugin's own browser half, which is why this package ships `client/client.js` alongside `lib/`. The plugin's page renders **eight** of the fields — three plain ones, then the other five behind the *Advanced* disclosure — and the panel's **⚙** gear renders the ninth (`allowCleanup`) through the *same* shared configuration form, which is why the two surfaces cannot disagree and why the gear's save persists exactly like a settings-page save. The gear shows the host's effective value, and says so plainly when a write is refused because a home patch or a command-line overlay owns the value.

### The same fields in YAML

```yaml
- id: disk-doctor
  name: 'dsh-disk-doctor'
  config:
    topN: 20
    followSymlinks: true
    allowOpenFolderSensitive: true
    allowCleanup: true
```

Both routes are equivalent; the form writes through the same profile patch. Use the patch directly in a headless deployment or when a value must be set before first paint. Two fields are still text-encoded in the form, because the shared form control is a text input: `excludeGlobs` is a comma-separated list, and `followSymlinks` takes the literal word `true` or `false`. The three permissions are **switches** rather than text boxes — `allowOpenFolder` and `allowOpenFolderSensitive` on the plugin's page, `allowCleanup` in the panel's **⚙** gear — and the staged value still travels the same text encoding, so the patch written on save is unchanged. Clearing any field removes the override and falls back to the default.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `dshHome` | string | `$DSH_HOME`, else `~/.dsh` | Data folder to scan. It follows the host exactly: `DSH_HOME` when that variable is set, `~/.dsh` otherwise, so the default is already right on someone else's machine. |
| `topN` | integer `1..100` | `10` | Items listed per category. |
| `excludeGlobs` | string[] | `[]` | Extra absolute-path globs to skip, e.g. `C:\Users\me\.dsh\big-*`. `*` stays within a path segment, `**` crosses them. |
| `reportDir` | string | `<dshHome>/disk-doctor/reports` | Where reports are written. `~` is expanded, and the path is canonicalized with `realpath` so a symlink cannot silently redirect the write. This is the only writable location; pointing it outside `$DSH_HOME` is allowed but always reported as a warning. |
| `followSymlinks` | boolean | `false` | Whether to follow symlinks and junctions. See *Symlinks* below before enabling. |
| `appDir` | string | empty — *detect* | The DSH application install folder. Empty means detect it from the running executable; anything you type wins, and the report then says the area is "来自设置" (from the settings) rather than detected. Fill it in only when detection cannot see your installation. |
| `allowOpenFolder` | boolean | `true` | Shown as an on/off switch. The master switch for the panel's **Open** buttons, on by default so 🟢「可以安全清理」rows open straight away. Switching it **off** greys out every button and makes the host refuse the request. |
| `allowOpenFolderSensitive` | boolean | `false` | Shown as an on/off switch, off by default. A second, separate consent that also allows the 🟠「要谨慎处理」and ⚪「不要动」rows — the folder beside your conversations, or your application files. |
| `allowCleanup` | boolean | `false` | An on/off switch, **off by default**, and the one field edited from the panel's **⚙** gear rather than the plugin page (it is the fourth control there, below a divider, under the three appearance preferences). With it off, the move button is greyed out and the host answers `POST …?action=move` with 403 `disabled`. Turning it on does not move anything by itself: the first click only relabels the button to 「确定，移动」 and opens the question line, and the second click moves. A settings change takes effect on the next request — no restart. |

### The Open buttons

Rows in the panel carry an **打开 / Open** button. Two switches gate it, and they are deliberately not the same switch:

- `allowOpenFolder` is the master switch and it is **on by default**: 🟢「可以安全清理」rows open their folder straight away, with nothing to configure. It also works as a kill switch — turning it off greys out every Open button and makes the host refuse with `disabled`.
- `allowOpenFolderSensitive` is **off by default** and is a second, separate consent for the 🟠「要谨慎处理」and ⚪「不要动」rows. Opening the folder beside someone's conversations or their application files is a bigger favour to ask than opening a temp folder, so it does not ride along on the master switch.

Both render as a switch row on the settings page — the label, a hint line, and a small reset control that appears only once the value has been overridden. The staged value still travels the same text encoding as before, so the profile patch written on save is unchanged.

The host checks **containment** against the roots the scan actually covers, choosing the most specific covering root, and refuses anything else; the route is POST-only, so a stray navigation or a prefetch cannot pop a window open; and a file reveals its containing folder, never the file itself. Link-installed plugins get no button at all — their targets are by definition outside every scanned root — only a copy control.

Every legend row in the **By plugin** and **By conversation** charts carries an Open button as well, and those rows are 🟠 and ⚪ — so both charts start with **every** button greyed out. When that happens, the chart's own corner says why and which switch fixes it: 「要在设置里打开『允许打开需谨慎处理的位置』才能点开」 while only the sensitive switch is missing, and 「要打开文件夹，得先去设置里把『允许打开文件夹』打开」 when the master switch is off. The sentence disappears as soon as the buttons work. The **Overview** chart names categories rather than folders, so it deliberately shows no name/path pill.

### What the colours mean

The same key appears twice: at the bottom of the panel, above the scope note (and hidden in compact mode), and inside the settings page's *Advanced* section, right below the two switches — which is where a reader is being asked to decide about the amber and grey rows.

| Dot | Level | Meaning |
|---|---|---|
| 🟢 | 可以安全清理 / Safe to clean up | DSH can rebuild it by itself; cleaning breaks nothing. |
| 🟠 | 要谨慎处理 / Handle with care | Reclaimable the right way — uninstall the plugins you no longer use rather than deleting files. |
| ⚪ | 不要动 / Leave alone | Needed to run DSH, plus your own conversations and attachments; deleting breaks something. |

## What gets scanned

Each category is probed for existence; a missing path is skipped and recorded in the report's warnings rather than silently dropped. Every category names the area it belongs to, so the three area totals can never borrow each other's jobs: `other` is a catch-all for the data folder only, never for the machine.

| Area | id | Path | Regenerable | Safety | Notes |
|---|---|---|---|---|---|
| data | `sessions` | `<dshHome>/sessions/**` | no | keep | Session content. Ranked per session, labelled with its real workspace title and date. |
| data | `storages` | `<dshHome>/storages/**` | no | care | Storage and projection caches; `session_projcache/sessions/*.json` listed individually. |
| data | `profile-deps` | `<dshHome>/profiles/*/node_modules/**` | yes | care | Third-party plugin dependencies, ranked per package. |
| data | `profile-logs` | `<dshHome>/profiles/*/.plugin-manager/logs/**` | yes | safe | Plugin install logs. |
| data | `profile-market` | `<dshHome>/profiles/*/.dsh-market/**` | yes | safe | Market state and logs. |
| data | `plugin-cache` | `<dshHome>/plugin-packages/**` | yes | safe | Downloaded package archives. |
| data | `runtimes` | `<dshHome>/dsh-runtimes/**` | no | keep | Bundled node/python/pnpm, ranked per component. |
| data | `temp-spill` | `%TEMP%/dsh-*` | yes | safe | Spill and per-session temp directories. |
| data | `attachments` | any `<dshHome>/*attach*` directory | no | keep | Probed; warns and falls through to `other` when absent. |
| data | `runtime-app` | `<dshHome>/electron/**` | no | keep | The full unpacked Electron runtime DSH runs on. Formerly labelled "The DSH application"; renamed **Electron runtime files** so it can no longer be confused with the application-install area below. |
| data | `other` | the rest of `<dshHome>` | no | care | Catch-all, so nothing in the data folder is unaccounted for. Excludes every data root above. |
| app | `app-install` | the DSH application install folder — detected, or `appDir` | no | keep | The packed Electron application. Read-only; this is the folder an uninstaller owns. Reported as "not found", in plain words, when detection cannot see it. |
| app | `npm-global-dsh` | `%APPDATA%/npm/node_modules/@deepseek-ai/dsh`, or the npm prefix | no | keep | The second installation: the global `dsh` CLI, which the desktop app cannot even share a profile with. Accepted only when the folder is a directory that really contains a `package.json`. |
| cache | `chromium-data` | `%APPDATA%/@deepseek-ai/dsh-desktop` | no | care | The desktop window's user data: sign-in state and interface cache. |
| cache | `pnpm-store` | `%LOCALAPPDATA%/pnpm` | no | care | The pnpm content store. Carries the **overlap probe**: its `overlapBytes` is the share of its bytes already counted in the data area, measured by inode. |

Within the data area every byte under `$DSH_HOME` (plus the temp directories) lands in exactly one category, so the data area's parts sum to its total. The app and cache areas each have a total of their own; the three totals are never added together (see [The three areas](#the-three-areas-and-why-there-is-no-grand-total)).

`other` is defined as *the complement of the data area's roots*, not as a fixed path list. Narrowing `categories` therefore narrows the totals as well as the report, and selecting `other` alone reports only what the unselected categories do not already cover.

### How the folders outside the data area are found

Nothing is guessed, and nothing is asked of the user if it can be worked out:

- **The data folder** follows `DSH_HOME` exactly as the host reads it, falling back to `~/.dsh`. A machine whose owner moved their data folder is therefore measured correctly without any configuration.
- **The application install folder** is detected from the running executable — `process.execPath`, with `process.resourcesPath` and `DSH_DESKTOP_NODE_EXECUTABLE` as fallbacks — and a candidate is accepted only when the folder really contains `resources/app.asar`. A headless `node` deployment therefore reports **not found** instead of guessing at some directory that happens to sit nearby. Setting `appDir` overrides detection, and the area's own note then says "来自设置" (from the settings) rather than "自动找到" (detected).
- **The second installation** is the one npm owns. The desktop application and the global `dsh` CLI are two installations on one machine — they cannot even read each other's profile — and a profile's shared `node_modules` is mostly junctions into the npm one. It is detected from `%APPDATA%\npm\node_modules`, the `npm_config_prefix` paths (`lib/node_modules` and `node_modules`), `~/.npm-global/lib/node_modules` and the usual Unix global roots, and accepted only when the candidate is a directory holding a `package.json`. Left out, a quarter of a gigabyte stays invisible next to a report that looks complete, which is exactly the failure this area exists to prevent.
- **The two cache folders** come from `%APPDATA%` and `%LOCALAPPDATA%`, with `.config` and `Library/Application Support` as fallbacks elsewhere.

### Link-installed plugins

A plugin installed as a link — `dsh plugin add <local path>`, exactly how `dsh-disk-doctor` itself is installed during development, living at `<your checkout>` while appearing under `~/.dsh/profiles/<profile>/node_modules/` — has none of its bytes physically inside the scanned tree, so it would otherwise vanish from the report entirely: a user who installs something and sees nothing starts distrusting every other number. It is therefore listed in a section of its own: the link, where it really points, and the real size of that target. **Those bytes are never added to any area total.**

The rule is about the target, not the link. A link whose target is *inside* a root the scan already covers is **not** listed, because its bytes are already counted in that area — claiming they were "not in any figure" would be false. On the development machine 510 of the 512 links point into the npm installation above; the report states that in one line and lists only the link that genuinely leads outside.

The measurement is bounded both per root and overall, and the rendered documents cap the list at 10 lines; a measurement that hit its ceiling prints as `至少 <size>` ("at least"), never as a precise figure it did not earn.

## Report artifacts

- `disk-report-<YYYYMMDD-HHMMSS>.md` — the full human report: one section per area, each with its roll-up tree and its own total, then the link-install list, warnings, and a Top-N table per category.
- `disk-report-<YYYYMMDD-HHMMSS>.json` — the stable machine contract, `"schema": "dsh-disk-doctor/report@1"`, extended **additively** by this change. It carries `totals` (the data area, as always), plus `areas`, `linkInstalls` and `capabilities` (`openFolder`, `openFolderSensitive`, `cleanup`), and `warnings`; every category in `categories[]` still carries `topItems` and now also states its `area` and its `overlapBytes`.

The tool's own result gained the same additions: `areas` and `linkInstalls` at the top level, and `area`/`overlapBytes` on every category. Every `topItems` entry now also carries `mtimeMs` — the newest file mtime inside that item — and that field is **required** in the tool's output schema, because the cleanup preview's recency rule depends on it.

## Cleanup: preview, move, and undo

The cleanup box has three stages, and each one is a separate, deliberate click.

### 1. The preview lists what would move

Press **「看看会移动什么」** and the host draws up a plan from `GET /dsh-disk-doctor/cleanup` (`"schema": "dsh-disk-doctor/cleanup@1"`), whose first field is `dryRun: true`; the same response carries the batches already sitting in quarantine. The rules behind the plan:

- **Only the 🟢「可以安全清理」categories take part** — `profile-logs`, `profile-market`, `plugin-cache` and `temp-spill`. Every other category is listed in `refused[]` with its safety level, so the omission is stated rather than silent: ⚪ holds the application, the runtime and your conversations, and 🟠 holds the installed plugins, where "move it and restart to see" is guaranteed to fail.
- **Only things that have been quiet for an hour.** Anything whose newest file was touched within the last hour is left out of the plan and reported in `skipped[]` with `reason: "recent"` (`RECENT_USE_MS = 60 * 60 * 1000`). The age comes from the **newest mtime inside the item**, not the folder's own timestamp, because a directory's mtime does not move while a process keeps writing files into it. The largest green item on a working machine is usually the running session's own spill directory, and moving that out from under a live process is not a cleanup. Anything that cannot be inspected at all is skipped too.
- **Everything, not the Top N.** The report carries ten items per category — the wrong shape for a plan, since a plan that lists fifteen of forty folders is a lie about what would move. The preview re-enumerates the safe categories with a ceiling of `PREVIEW_ITEM_LIMIT = 500` items and sets `truncated: true` plus a warning if a category exceeds it.
- **The destination is only computed.** The plan names `<dshHome>/disk-doctor/quarantine/<YYYYMMDD-HHMMSS>` and does not create it.

### 2. The move renames — it never copies and never deletes

The `allowCleanup` switch (**off by default**) is what makes a move real, and it is flipped from the panel's own **⚙** gear — the fourth control there, below a divider, under the three appearance preferences. With it off, the **Move to quarantine** button is greyed out with the reason and the host answers a move request with 403 `disabled`. With it on, the flow is literally two clicks on that button: the first **relabels it** to 「确定，移动」 and opens a question line — 「确定移动这 N 项（共 X）吗？」 with 「确定，移动」 and 「取消」 — and the second click (either the relabelled button or the line's yes) moves. The button stays enabled while it is asking; a disabled button would receive no click at all, which is exactly how the first version of this shipped a button that looked alive and did nothing. Then, per item:

- **The plan is drawn up again, immediately before anything moves**, so a move can never act on a stale list: an item that started being written to since you looked simply drops out and is reported in `skippedRecent`.
- **Ownership is re-checked on every single item.** `ownsCleanupPath()` in `lib/targets.js` answers "may a green cleanup own this path" **independently of whether the path exists right now** — and that independence is the point: a whole-folder item (`.dsh-market`, a `dsh-spill-*` directory) *is* its own root and is gone the moment it moves. Each green category declares its own rule: two profile-leaf shapes (`<profiles>/<profile>/.dsh-market` and `…/.plugin-manager/logs`), a folder prefix (`<dshHome>/plugin-packages`) and a shape rule for temp spill (`<tempDir>/dsh-*`). Asking the scan's root list instead would refuse to put the user's own files back.
- **The item is renamed** to `<quarantine>/<timestamp>/<categoryId>/<original layout under its root>`, so a look inside the quarantine still says where things came from. Two profiles both have a `.dsh-market`, so a name that is already taken gets a `-2`, `-3`, … suffix.
- **The manifest is rewritten after every single item**, so an interrupted run still leaves a record that matches the disk. The batch document is `dsh-disk-doctor/quarantine@1`, its status runs `moving` → `moved` / `moved-with-failures`, and an empty plan creates **no folder at all** (`nothing-to-move`).

A failed move says which of three things went wrong instead of doing nothing visible: the permission is off (`disabled`), **the host is still an older version** — this POST route does not exist yet, so restart DSH and try again — or the host could not be reached at all.

`renameSync` is the only mutating call in the cleanup module. Emptying the quarantine stays your job, outside this plugin.

### 3. The undo puts every item back — or refuses

The box offers **Undo** for the batch just moved and for every other batch still in quarantine (`listQuarantine()` lists them newest first). Before a single rename happens, `undoCleanup()` re-validates everything: the batch id must be a `YYYYMMDD-HHMMSS` timestamp, every recorded `target` must sit inside that batch, and every recorded `original` must be a path a cleanup is allowed to own. A hand-edited manifest therefore cannot be used to move files anywhere else.

An original that has since reappeared is **refused, never overwritten**, and reported in `failures` with `reason: 'occupied'`; items are restored in reverse order, so nested ones come back before the folder containing them. The batch is left at `status: 'undone'` (or `partly-undone`) and the panel says what could not go back, and why.

A second box, **「想省更多空间？这样做才对」**, exists because deleting folders here frees almost nothing (the pnpm store and the plugin folders are hard links to the same bytes) or breaks DSH (the runtime and the program): it names the biggest plugin and points at the Plugins page, names the pnpm store with its measured overlap and `pnpm store prune`, and lists what must not be touched.

### Measured on a real machine (2026-10-07)

The preview takes about **45 ms**; at 02:21 it planned **8 items / 3,854.8 KB** while skipping **466,243 bytes** as too fresh. A real move was then performed on dead temporary spill directories: **6 items / 3,833.3 KB**, every original gone, every target present under `quarantine/<timestamp>/temp-spill/…`, **0 failures**. The undo restored all six with 0 failures, a fingerprint of every cleanup-eligible path was **byte-for-byte identical** afterwards, and the manifest was left at `status: 'undone'`. The batches that remain in the quarantine folder (`20261007-030514` and later ones) hold only their manifest and an empty category folder, and are safe for you to delete.

## Design invariants

1. **Nothing destructive, ever.** v0.1 writes only its own report, and the one mutating operation it has is a **rename** into its own quarantine folder — green categories only, only with the switch on, only after a second confirmation, and always with a manifest that makes it reversible.
2. **Explainable.** Every number descends to the files that produced it; no untraceable aggregates.
3. **Rollback-ready, and now real.** Every move rewrites the manifest as it goes, and the undo re-validates that manifest against the disk before restoring: a target outside the batch, an original outside the safe roots, or an original that has reappeared is refused rather than acted on — never overwritten. Nothing here deletes.
4. **In bounds.** The data folder and the session temp directories are the only folders scanned by default; both DSH installations, the desktop user-data folder and the pnpm content store are *detected* outside it, measured read-only, and named in the report. Paths are canonicalized with `realpath` before any comparison, the report directory stays the single writable location, and the one route that can reach the file manager refuses any path outside a root the scan actually covers.
5. **Conservative by default.** Symlinks are not followed; scans stop at a ceiling (500,000 files or 30 seconds) and flag `truncated: true` instead of hanging.

### Symlinks and junctions

By default a link is counted, reported, and **not** traversed. This is deliberate: on a pnpm profile, `profiles/node_modules/*` are junctions into a global npm tree, and following them both leaves `$DSH_HOME` and double counts the same bytes (once through the link, once through the real directory). With `followSymlinks: true`, the scanner follows links but deduplicates by real path, so each real directory is still counted once.

### Accuracy

Sizes come from `stat`, and the same file is never counted twice. Accuracy is checked two independent ways:

- The test suite asserts the scanner's total equals an independent recursive walk of the same fixture, byte for byte, and that the data area's categories sum to its total.
- Against a real installation it is cross-checked with PowerShell's own measurement — `Get-ChildItem -Recurse -File | Measure-Object -Sum Length`, reparse points excluded. The scanner's **file set and byte total match exactly**: 8,903 files and 767,049,761 bytes on both sides.

## Scope of v0.1

**Does:** read-only measurement, three areas reported side by side, category breakdown, Top-N detail, a separate list of link-installed plugins, Markdown + JSON reports, nine config fields, a sidebar panel with a colour key and a space-freedom guide, **Open** buttons that reveal a folder in the OS file manager — on by default for the 🟢 safe tier, with the 🟠 and ⚪ tiers behind a second, separate switch — and a **cleanup** that previews at item level, moves the green folders into its own quarantine folder, and puts them back with one click.

**Does not:** delete anything, or make any network request. The cleanup never removes a byte — it renames, refuses to overwrite, and stops at the 🟢 tier; emptying the quarantine is your job outside the plugin. Destructive removal (`L3`) is v0.2+ and will arrive as a separate, explicitly-confirmed layer.

## Development

```
npm test              # all four suites: locate, scan, plugin, client
npm run test:locate   # where DSH keeps things: data folder, install folder, two caches
npm run test:scan     # scanner and reporter only
npm run test:plugin   # entry module, driven through stubbed peers
npm run test:client   # the browser half, driven through stubbed peers
```

`test/plugin.test.mjs` loads `lib/index.js` with `@deepseek-ai/dsh-tools` and `@deepseek-ai/schemastery` replaced by the stubs in `test/stubs/`, so the suite runs without an installed DSH host. `test/locate.test.mjs` keeps detection testable by injecting the environment, the executable path and the filesystem probes, so the rules are checked without depending on the machine they happen to run on.

Beyond that suite, the plugin is checked against the real implementation — first `0.2.0-rc.2`, then the tool definition again under `0.2.1-rc.2`: its definition compiles under the actual `defineTool`; the actual argument validator rejects bad input and the actual output validator accepts the returned value; and the tool is dispatched end to end through the real `ToolRuntime` service on a real cordis context — registering, projecting its schema, executing through the full policy pipeline, and writing its report files. Installing into a profile remains the final confirmation on a given host.

### Layout

```
lib/index.js     plugin entry: Config, apply, the disk_report tool
lib/locate.js    where DSH keeps things here: data folder, install folder, two system caches
lib/targets.js   area and category tables, item enumeration, workspace index, cleanup ownership
lib/scan.js      traversal, aggregation, limits, the inode overlap probe
lib/cleanup.js   the preview, the move into quarantine, the manifest and the undo
lib/report.js    Markdown and JSON rendering
lib/serve.js     the report, cleanup and open-folder routes
lib/targets.js   also mirrors DSH's projectKey() directory-naming algorithm
```

## License

MIT — see [LICENSE](./LICENSE).
