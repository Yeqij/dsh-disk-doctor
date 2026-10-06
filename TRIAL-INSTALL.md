# Trial install (local working copy)

English | [中文](#中文)

How to install **this working copy** into a DSH profile and check it really works. Written for the unfinished local checkout; once the package is published, the plain `dsh plugin add dsh-disk-doctor` in the README is enough.

Nothing here is destructive: installing adds one package and one bundle entry, and the rollback is a single command.

## Prerequisite: make pnpm reachable

`dsh plugin` forwards its arguments to **pnpm** inside the profile directory, and the DSH runtime's own pnpm ships as an `.mjs` entry with no `.cmd` shim. If `pnpm` is not on your `PATH`, the command fails with `'pnpm' is not recognized`.

This is enough to fix it for the current shell, using the runtime's own node and pnpm:

```powershell
$runtime = "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies"
$shim = "$env:TEMP\dsh-pnpm-shim"
New-Item -ItemType Directory -Force $shim | Out-Null
"@echo off`r`n`"$runtime\node\bin\node.exe`" `"$runtime\pnpm\bin\pnpm.mjs`" %*" |
  Set-Content -Encoding ascii "$shim\pnpm.cmd"
$env:PATH = "$shim;$runtime\node\bin;$env:PATH"
```

Confirm the route works before installing anything — `list` is read-only:

```powershell
dsh plugin --profile <profile> list --depth 0
```

You should see the profile's current dependencies. If you do, the install will work.

## Install

```powershell
dsh plugin --profile <profile> add "<absolute path of this working copy>"
```

Expect pnpm to add a `link:` dependency. The plugin manager selects the new bundle by default, so `dsh.profile.bundles` in `profiles/<profile>/package.json` gains `dsh-disk-doctor`, and the loader applies the package's `cordis.patch.yml` on the next start.

**A restart of DSH is required** — bundles are composed at boot. The currently running app will not see the tool.

## Verify after restarting

1. Ask the model for a disk report (*"DSH 占了多少磁盘？"*), or call `disk_report` directly. The Markdown summary should come back and a report file should appear under `~/.dsh/disk-doctor/reports/`.
2. **Reload the web page** — the browser half is fetched at page load. Then open **Plugins → Installed → `dsh-disk-doctor`** and check that its page shows **all eight** fields: `dshHome`, `topN` and `reportDir` as plain fields, then `excludeGlobs`, `followSymlinks`, `appDir` and the **two** permissions behind the **Advanced** disclosure. Those two render as **switches**, not text boxes — **Allow opening folders** already on, **Allow opening sensitive locations** off — and the **colour key** ("What the colours mean") sits directly below them. **"Allow cleanup (move to quarantine)" is deliberately *not* on this page**: it is the ninth field and it lives in the panel's own **⚙** gear. A missing field means either it is not declared `.volatile()`, or the page's `plugins.bundle.config` registration did not load.
3. `disk_report` with `write: false` should return the summary without creating any file.
4. Open the **Disk space** panel and check the three areas: **DSH data** carries the headline ("DSH data is using …"), **DSH application** names the installations it found (the desktop app's folder and the npm one) or says in plain words that it found none, and **System caches** states in words that its figure cannot be added to the others. The data area should also list `dsh-disk-doctor` itself under *link-installed plugins*, with the real target path of the working copy — those bytes are not part of any area total.
5. In that panel, click **Open** on a 🟢 row — it should reveal the folder with no configuration at all. Now switch **Allow opening folders** off in the settings and use the panel's refresh control: every Open button is greyed out again and the host refuses the request. Switch it back on and they work again. A settings change reaches both routes on the **next request** — **no restart is needed**.
6. Switch the data box to **By plugin** and **By conversation**: each legend row carries its own Open button, and because those rows are 🟠 and ⚪ the chart's corner should say which switch would light them up (with the sensitive switch off, the sentence is 「要在设置里打开『允许打开需谨慎处理的位置』才能点开」; with the master switch off, 「要打开文件夹，得先去设置里把『允许打开文件夹』打开」). The corner also carries a **「显示完整路径」/「显示名称」** pill that flips the labels between names and paths; the **Overview** tab has no such pill. Conversation rows should read as a real workspace title plus a short tag (`disk-doctor · 64875ca0`), not `E\disk-doctor · session-`.
7. Still in the panel, find the **Cleanup** box below the three areas and press **"Show what would move"**. It should list the planned items largest-first (each with its own Open control), the count and total that would move, and the destination folder. If a spill directory was written to in the last hour, the listed total should be **smaller** than the green "safe to clean up" figure, and the plan's own warnings should give "still changing within the last hour, possibly in use" as the reason. **Before you press anything at all**, the box should already show the always-visible block titled **"What the second step does"** with its three numbered lines (quarantine rather than delete; restart DSH and check; one-click undo, then you empty the folder yourself). At this stage **nothing on disk may change**: the quarantine folder named as the destination must not exist afterwards, and no file is moved, created or deleted — the move button is still greyed out because **Allow cleanup** is off, and says so.
8. Now open the panel's **⚙** gear and turn **Allow cleanup (move to quarantine)** on (it is the fourth control there, below the divider) — the move button lights up on the next fetch. Press it once: it should **relabel itself to "Yes, move them"** and a question line should appear ("Move these N items?" with "Yes, move them" and "Cancel"). Press **Cancel** first and confirm that nothing moved and the button is back to "Move to quarantine"; then press it again and confirm. Afterwards: every listed original should be **gone** from its original spot and present under `~/.dsh/disk-doctor/quarantine/<timestamp>/<categoryId>/…`, `manifest.json` should be in that batch folder with `status: "moved"`, and the panel should show the green "Moved to quarantine: N items" line plus an **Undo** button. (If instead you get **"The host is still an older version"**, you have not restarted DSH since installing — restart and try again; that message replaced what used to be a button that did nothing.)
9. Press **Undo**. Every item should be back at its original path, the manifest should now read `status: "undone"`, and a fingerprint of the cleanup-eligible paths should be **byte-for-byte identical** to before step 8. The batch folder keeps only its `manifest.json` (and an empty category folder) — emptying it is the user's job, and nothing in the plugin can delete it.
### If the form does not appear

Work down this list; each step names the layer that failed:

1. **Settings → Plugins → Plugin list** — page-local module-synchronization failures are reported per entry there, with a retry, without changing Host enablement.
2. **Browser console** — a `require(...) missed the module table` message means a module the bundle asked for is neither a platform seed word nor a declared external. A composition error naming `dsh-disk-doctor` means the Host rejected our `dsh.client` declaration or could not find `exports["./client"]`.
3. **The card exists but its page is empty** — the bundle composed and the page loaded, but the slot registration did not run.
4. **The page says the plugin is unavailable** — the Host is not serving the `disk-doctor` settings namespace.

Note that `dsh --profile <profile> --dump-config` is **not** a valid check here: the globally installed `dsh` CLI is a separate installation from the desktop app, and it fails on this profile because it cannot resolve the official bundles the profile lists. The app resolves them; the CLI does not.

## Rollback

```powershell
dsh plugin --profile <profile> remove dsh-disk-doctor
```

That drops the dependency and deselects the bundle. Reports already written under `~/.dsh/disk-doctor/reports/` are yours to keep or delete; the plugin never writes anywhere else.

## Note on the plugin's own footprint

`dsh-disk-doctor` scans `~/.dsh`, so once installed it will report its own report directory like anything else. That directory is the plugin's only write, and it is not marked regenerable.

---

<a id="中文"></a>
# 中文

把**这份本地工作副本**装进某个 DSH profile 并验证它真的能用的步骤。写这份是因为包还没发布；发布之后用 README 里的 `dsh plugin add dsh-disk-doctor` 就够了。

全程可逆：安装只增加一个包和一条 bundle 记录，回退是一条命令。

## 前提：让 pnpm 可达

`dsh plugin` 会把参数转发给 profile 目录里的 **pnpm**；而 DSH 运行时自带的 pnpm 只有 `.mjs` 入口，没有 `.cmd` 转接文件。如果 `pnpm` 不在 `PATH` 上，命令会报 `'pnpm' is not recognized`。

下面这几行用运行时自带的 node 与 pnpm，给当前 shell 临时解决：

```powershell
$runtime = "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies"
$shim = "$env:TEMP\dsh-pnpm-shim"
New-Item -ItemType Directory -Force $shim | Out-Null
"@echo off`r`n`"$runtime\node\bin\node.exe`" `"$runtime\pnpm\bin\pnpm.mjs`" %*" |
  Set-Content -Encoding ascii "$shim\pnpm.cmd"
$env:PATH = "$shim;$runtime\node\bin;$env:PATH"
```

**装之前**先用只读命令确认这条路是通的：

```powershell
dsh plugin --profile <profile> list --depth 0
```

能看到该 profile 现有的依赖就说明没问题。

## 安装

```powershell
dsh plugin --profile <profile> add "<这份工作副本的绝对路径>"
```

预期 pnpm 会加一条 `link:` 依赖。插件管理器默认会把新 bundle 选入，于是 `profiles/<profile>/package.json` 的 `dsh.profile.bundles` 会多出 `dsh-disk-doctor`；下次启动时加载器会应用该包的 `cordis.patch.yml`。

**必须重启 DSH**——bundle 是在启动时组装的，当前正在运行的实例看不到这个工具。

## 重启后验证

1. 让模型做一次空间体检（「DSH 占了多少磁盘？」），或直接调用 `disk_report`。应当返回 Markdown 摘要，并在 `~/.dsh/disk-doctor/reports/` 下生成报告文件。
2. **先刷新一下网页**（浏览器半边是在页面加载时取回的）。然后打开 **插件 / Plugins → Installed → `dsh-disk-doctor`**，确认它的页面上有**全部 8 个**字段：`dshHome`、`topN`、`reportDir` 摆在明面上，`excludeGlobs`、`followSymlinks`、`appDir` 与**两个**权限项收在「**高级选项**」折叠区里。这两个权限项应当是**开关**，不是让你打字的输入框——**「允许打开文件夹」已经开着**、**「允许打开需谨慎处理的位置」关着**——而**颜色说明**就在这两个开关的正下方。**「允许清理（移动到回收站）」刻意不在这个页面上**：它是第 9 个字段，住在**面板自己的 ⚙ 齿轮**里。少字段只可能是两个原因：该字段没声明 `.volatile()`，或者页面的 `plugins.bundle.config` 注册没加载。
3. 用 `write: false` 调用 `disk_report`，应当只返回摘要、不产生任何文件。
4. 打开 **磁盘空间** 面板，确认三个区：**DSH 数据** 带着最上面那行「DSH 的数据占了…」；**DSH 程序** 写明它找到的安装位置（桌面程序那一份与 npm 那份），或者用大白话说没找到；**系统缓存** 用文字说明它的数字不能与别的区相加。数据区里还应当把 `dsh-disk-doctor` 自己列在「链接安装」一节，并写出工作副本的真实目标路径——那些字节不算进任何区的总数。
5. 在这个面板里点一下 🟢 档某行的 **打开** 按钮——什么都不用配，它应当直接在文件管理器里定位到那个文件夹。然后去设置里把 **「允许打开文件夹」** 关掉，再用面板的「重新统计」刷一次：所有「打开」按钮都变灰，宿主也会拒绝请求。重新打开开关，它们又能用了。设置改动在**下一次请求**就会被宿主读到——**不需要重启**。
6. 把数据区切到 **「按插件」** 与 **「按聊天记录」**：图例里每一行都带自己的「打开」按钮，而这些行是 🟠 与 ⚪，所以图的右上角应当写清楚该打开哪个开关（敏感开关没开时是「要在设置里打开『允许打开需谨慎处理的位置』才能点开」；总开关被关掉时是「要打开文件夹，得先去设置里把『允许打开文件夹』打开」）。同一个角落还有一个 **「显示完整路径」/「显示名称」** 小按钮，在名称与完整路径之间切换；**「总览」** 页签没有这个按钮。聊天记录的行应当是真实工作区标题加一小段编号（`disk-doctor · 64875ca0`），而不是 `E\disk-doctor · session-`。
7. 还在这个面板里，找到三个区下面的 **「清理」** 方框，点 **「看看会移动什么」**。它应当按大小倒序列出计划条目（每条带自己的「打开」控件）、会移动的条目数与总量、以及落点目录。如果最近一小时内往某个临时溢出目录写过东西，列出的总量应当**小于**面板上那个绿色「可以安全清理」的数字，而清单自带的注意事项会给出原因（「最近 1 小时内还在改动，可能正被 DSH 使用」）。**在你点任何按钮之前**，方框里就应该已经有那个一直显示的说明块 **「第二步会这样做」** 加三行编号文字（先移进回收站而不是真删；重启 DSH 用一会儿确认正常；一键撤销、之后你自己清空那个文件夹）。这一步**磁盘上不能有任何变化**：作为落点的那隔离目录事后必须不存在，没有任何文件被移动、创建或删除——因为「允许清理」还关着，移动按钮应当是灰的并写明原因。
8. 现在打开**面板的 ⚙ 齿轮**，把 **「允许清理（移动到回收站）」** 打开（它是齿轮里的第 4 个控件，在分隔线下面）——下一次取数后移动按钮就亮了。先点一次：它应当**把自己改成「确定，移动」**，并弹出一行问句（「确定移动这 N 项（共 X）吗？」加「确定，移动」与「取消」）。先点「取消」，确认什么都没移动、按钮也回到「移动到回收站」；再点一次并确认。之后：清单里每个原位置都应当**空了**，而每一项都出现在 `~/.dsh/disk-doctor/quarantine/<时间戳>/<分类 id>/…` 下；那个批次目录里有 `manifest.json`，`status` 为 `moved`；面板上应当出现绿色的「已移动到回收站：N 项，共 X」和 **「撤销」** 按钮。（如果出现的是 **「宿主还是旧版本（这个接口还不存在）」**，说明装完之后还没重启 DSH——重启再试一次。这句提示就是用来替代过去那个「点了没反应」的按钮的。）
9. 点 **「撤销」**。每一项都应当回到原路径，清单里的 `status` 变成 `undone`，并且对所有「清理可涉及路径」做指纹比对，结果应当与第 8 步之前**逐字节一致**。批次目录里只剩下 `manifest.json`（和一个空的分类目录）——清空它是用户自己的事，插件里没有任何东西能删它。
### 如果表单没出现

按顺序排查，每一步都指向一个具体的层：

1. **设置 → 插件 → 插件列表** —— 页面局部的模块同步失败会在这里按条目列出，并可以重试，且不会改变宿主的启用状态。
2. **浏览器控制台** —— 出现 `require(...) missed the module table`，说明 bundle 请求了既不是平台种子、也没声明为 external 的模块；出现点名 `dsh-disk-doctor` 的组合错误，说明宿主拒绝了我们的 `dsh.client` 声明或找不到 `exports["./client"]`。
3. **卡片在、但它的页面是空的** —— bundle 组合成功、页面也加载了，只是插槽注册没跑。
4. **页面说该插件不可用** —— 宿主没有提供 `disk-doctor` 这个设置命名空间。

另外注意：`dsh --profile <profile> --dump-config` **在这里不是有效的检查手段**——全局安装的 `dsh` CLI 与桌面应用是**两套不同的安装**，它在这个 profile 上会因为解析不了 profile 里列出的官方 bundle 而直接失败。应用能解析，CLI 不能。

## 回退

```powershell
dsh plugin --profile <profile> remove dsh-disk-doctor
```

这会移除依赖并取消 bundle 选中。已经写到 `~/.dsh/disk-doctor/reports/` 的报告由你自己处置；插件不会写其他任何地方。

## 关于插件自身的占用

`dsh-disk-doctor` 扫描的就是 `~/.dsh`，所以装好之后它会把自己的报告目录也算进去。那个目录是本插件唯一的写操作，并且没有被标记为可再生。
