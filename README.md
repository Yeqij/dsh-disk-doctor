# dsh-disk-doctor

**DSH 空间体检** —— 看清 DeepSeek Harness 把磁盘吃到哪去了，以及哪些部分可以收拾。

> DSH 从不删东西，所以这个数字只会涨。这个插件把它摊开给你看：三个区并排、每一类占多少、哪些是可再生的、哪些是你自己的会话内容。

**Read-only disk accounting for [DeepSeek Harness](https://github.com/deepseek-ai): where the gigabytes went, what is regenerable, and what is yours. Its one mutation is a `rename` into a quarantine folder — it never deletes, and it can be undone with one click.** [English ↓](#english)

---

## 它做什么

- **三个区并排，永不相加。** DSH 数据文件夹 / DSH 程序安装 / 系统缓存（桌面端用户数据、pnpm 内容仓库）。三者物理字节有重叠——pnpm 仓库里放的就是插件 `node_modules` 硬链接过去的真身——相加会把同一批字节算两遍，所以它只分开给数，并写明原因。
- **路径全部自动探测。** 数据目录跟随 `$DSH_HOME`（回落 `~/.dsh`）；程序安装目录从运行中的可执行文件探测，且**必须真的存在 `resources/app.asar` 才认**，所以无头 `node` 部署会老实报"没找到"；两个系统缓存按 `%APPDATA%` / `%LOCALAPPDATA%` 探测，另有 `.config` 与 `Library/Application Support` 回落；npm 全局安装的那份 DSH 也会被单独认出来。探不到的就说探不到，不猜。
- **右侧栏常驻面板。** 分类构成、每类 Top N 明细、按插件 / 按聊天记录两个视图、每行一个"在文件管理器里打开"。中文 / English 双语，跟随界面语言。
- **清理从不删除。** 全包没有任何 `unlink` / `rm` / `rmdir` 调用，唯一会动你文件系统的是 `lib/cleanup.js` 里的一次 `renameSync`——移动到插件自己的隔离目录 `<dshHome>/disk-doctor/quarantine/<时间戳>/`，**每移动一项就重写一次清单**，所以中途断电也留下与现实一致的记录，随时一键撤回。清理开关默认关闭，需要二次确认；只处理 🟢「可以安全清理」的四类，插件本体、运行环境、程序文件和你的对话都不在其中。
- **不联网。** 清单里声明 `network: []`，并有测试钉住"两半代码都不得出现出站调用"。
- **报告脱敏。** 会离开这台机器的输出（工具结果、Markdown/JSON 报告）一律把主目录替换成 `~`；只有本机右侧栏面板显示真实路径，因为那是你要复制和打开的地方。

## 安装

要求 **DeepSeek Harness `>=0.1.0-rc.2`**（实测版本 `0.2.0-rc.2`）、**Node.js `^22.19.0 || >=24.0.0`**。零运行时依赖、零构建步骤、不需要打包器。

```powershell
dsh plugin --profile <profile> add dsh-disk-doctor
```

装完**重启 DSH**（bundle 在启动时组装）。

**其他方式**：直接从本仓库装 —— `dsh plugin --profile <profile> add https://github.com/Yeqij/dsh-disk-doctor`；或下载本仓库，在 **插件 → 添加插件** 里粘贴文件夹的完整路径。也可以用 release 里那个与 npm 完全相同的 tgz：`dsh plugin --profile <profile> add https://github.com/Yeqij/dsh-disk-doctor/releases/download/v0.1.0/dsh-disk-doctor-0.1.0.tgz`。

## 测试

```powershell
npm test
```

177 项全部通过（`locate` 18 / `scan` 55 / `plugin` 41 / `client` 63），一条命令跑完四套，不需要 DSH 宿主或已安装的 peer 包（`@deepseek-ai/dsh-tools` 与 `schemastery` 由 `test/stubs/` 的解析钩子替换）。

## 文档

| 文件 | 内容 |
|---|---|
| [`README.en.md`](README.en.md) · [`README.zh.md`](README.zh.md) | 完整文档：能力声明、三个区的口径、扫描限额、JSON 契约（英 / 中） |
| [`USAGE.md`](USAGE.md) | 面向普通用户：面板怎么看、清理该怎么做、常见问题（中英对照） |
| [`TRIAL-INSTALL.md`](TRIAL-INSTALL.md) | 从工作副本试装、逐项验证、回退（中英对照） |
| [`DESIGN.md`](DESIGN.md) | 设计文档：口径、路径探测、清理模型与不变式（中文） |

## 仓库结构

仓库根目录**就是这个 npm 包**——`package.json`、`lib/`、`client/` 都在顶层，所以 `pnpm add <仓库地址>` 能直接装、`npm publish` 也能直接在根目录跑。

```
.
├── package.json        npm 清单（dsh.bundle / dsh.client 声明在这里）
├── cordis.patch.yml    插入 profile 分层栈的 bundle patch
├── lib/                宿主半边：扫描、分类、渲染、路由、清理
├── client/             浏览器半边：右侧栏面板与设置页（零构建）
├── test/               177 项测试
├── README.md           本文件（门面）
├── README.en.md        完整英文文档
├── README.zh.md        完整中文文档
├── USAGE.md            面向普通用户的用法
├── TRIAL-INSTALL.md    试装与回退
├── DESIGN.md           设计文档（开发材料，不随包发布）
└── LICENSE             MIT
```

## 许可证

[MIT](LICENSE)。

---

## English

**Read-only disk accounting for DeepSeek Harness**, with a cleanup that never deletes.

- **Three areas side by side, never summed** — the DSH data folder, the DSH application install, and the system caches DSH feeds (desktop user data, pnpm content store). They share physical bytes (the pnpm store holds the very files the plugin `node_modules` hard-link to), so adding them would count the same bytes twice. Each reports its own figure, and the report says why.
- **Every path is detected, not guessed** — the data folder follows `$DSH_HOME`, the install folder comes from the running executable and must really hold `resources/app.asar`, the caches come from `%APPDATA%` / `%LOCALAPPDATA%` with macOS/Linux fallbacks, and a second npm-global DSH install is recognised separately. When something cannot be found, it says so.
- **A resident sidebar panel** — category roll-up, Top-N detail, by-plugin and by-conversation views, and an "open in file manager" control per row. Bilingual.
- **The cleanup never deletes** — there is no `unlink`, `rm` or `rmdir` anywhere in the package. The one filesystem mutation is a `renameSync` into the plugin's own quarantine folder, with the manifest rewritten after every single item so an interrupted run still matches the disk. Off by default, asks twice, and touches only the 🟢 "safe to clean up" categories.
- **No network access** — declared as `network: []` in the manifest, with a test that fails if either half grows an outbound call.
- **Reports are redacted** — anything leaving the machine replaces your home directory with `~`. Only the local panel shows real paths, because that is where you copy them from.

**Install** — published on npm:

```powershell
dsh plugin --profile <profile> add dsh-disk-doctor
```

Alternatively install straight from this repository (`dsh plugin --profile <profile> add https://github.com/Yeqij/dsh-disk-doctor`), paste the folder path into **Plugins → Add plugin**, or use the identical tarball attached to the release. Requires DSH `>=0.1.0-rc.2` (verified against `0.2.0-rc.2`) and Node `^22.19.0 || >=24.0.0`.

**Test:** `npm test` — 177 tests, no DSH host required.

Full documentation in English lives in [`README.en.md`](README.en.md); user-facing how-to in [`USAGE.md`](USAGE.md).

**License:** [MIT](LICENSE).
