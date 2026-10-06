# dsh-disk-doctor —— 设计文档

| 项目 | 内容 |
|---|---|
| 日期 | 2026-10-06 |
| 状态 | **设计定稿，v0.1 已实现并验证**（profile 试装与首次提交待办） |
| 目标运行时 | DSH `0.2.0-rc.2`（本机实测版本） |
| 包名（候选） | `dsh-disk-doctor`（备选：`dsh-space-doctor`、`dsh-storage-doctor`） |
| v0.1 定位 | **只读空间体检**：统计 + 报告，一行删除代码都不写 |
| 本文件用途 | 自足设计档案。新会话读这一份即可接上全部调研，不必重做 |

---

## 0. 给下一个会话的第一句话（kickoff）

> 先读 `DESIGN.md`。**v0.1 已经实现并验证完毕**（代码在 `lib/`，测试在 `test/`，验证方式见 `README.md` 的开发一节），不要从第 10 节的任务 1 重做。
>
> 目前只剩两件事，且都已被用户显式推迟：
> 1. **装入本机 profile 试装** —— `dsh plugin add dsh-disk-doctor`（或本地绝对路径）。需重启 DSH 才生效，所以要用户自己挑时间；这是 §11 里唯一未打勾的一项。
> 2. **首次 git 提交** —— 仓库 `E:\disk-doctor` 已 `git init -b main`，尚无提交；署名等用户给 `user.name` / `user.email`，并按 §12.4 用**仓库局部**身份。
>
> 若要继续开发，下一步是 v0.2 的 L2 清理层。动手前务必先读：§6.5 的设置页修订（只有 `.volatile()` 字段会出现在设置界面）、§14.5 的符号链接计数陷阱（pnpm profile 会同时越界与重复计数）、以及 §8 的安全规则（强制 dry-run、路径白名单、undo 清单、回收站回退链）。推理强度建议 high。

---

## 1. 一句话定位

**DSH 的空间治理器**：唯一一个让你看清 DSH 到底占了多少磁盘、并且（从 v0.2 起）只在可回滚的前提下清理它的插件。

不是"又一个磁盘清理工具"。理由见下一节。

---

## 2. 为什么是这个插件（调研证据）

### 2.1 DSH 自己从来不清理

| 事实 | 证据来源（本次调研实测） |
|---|---|
| 会话日志只增不减 | `~/.dsh/sessions/<escaped-cwd>/session-<uuid>/session.jsonl.zstd`（+ `session.v4.jsonl.zstd`），按会话累积 |
| 核心**没有**删除会话的能力 | 应用内 `deleteSession` 的实现是**空函数** `deleteSession(_params) { }`；官方机制只有归档（`~/.dsh/storages/workspace.json` 的 `archivedSessionIds` 数组），归档 ≠ 删除 |
| 插件卸载留缓存 | profile 的 `node_modules`、`pnpm-lock.yaml`、`.plugin-manager/logs/operation-*/pnpm.log`、市场数据目录 `.dsh-market/` 都留在盘上 |
| 运行时是一整棵依赖树 | `~/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/{python,node,pnpm}` |
| 临时产物会积压 | `%TEMP%\dsh-spill-*`、会话私有临时目录 `<temp>\dsh-<hash>` |

结论：**这个生态的所有用户磁盘都会单调增长，而且官方没有任何治理入口。** 这是需求广泛性的根据。

### 2.2 生态空位（对精选清单做了关键词检索）

检索对象：[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 的精选清单（约 4400 条，God object：`plugins.json` 被 dshmarket 实时读取）。

| 关键词组 | 命中 |
|---|---|
| `disk / storage / cleanup / free space / orphan / duplicate file` | **0 个真实命中** |
| `secret / redact / leak / privacy`（旁证：地基类需求普遍没人做） | **0 个** |
| `playwright / e2e / coverage / lint / audit / dependency / outdated` | **0 个** |
| `serial / SCPI / VISA / oscilloscope / MATLAB / KiCad / LTspice` | **0 个** |

整体生态规模（2026-10-06 抓取）：GitHub topic `dsh-plugin` **17780** 个仓库；npm 关键字 `dsh-plugin` **6922** 个包；头部市场 `dshmarket` 月下载 **52.5 万**。

**已经饱和、不要进场的领域**：UI 微调（聊天宽度/目录/时间轴/状态轮播/便签…数百个）、主题皮肤与宠物、插件市场本身、记忆系统、用量计费、IM 桥接、多智能体编排、浏览器自动化。

### 2.3 已有的相邻竞品与我们的差异

| 竞品 | 它做什么 | 它不做什么（= 我们的空间） |
|---|---|---|
| [AKS1st/dsh-sysmon](https://github.com/AKS1st/dsh-sysmon) | 右下角浮窗**监控** CPU/内存/**磁盘用量** | 只监控，不统计 DSH 内部构成，不清理 |
| [duanyunlun/dsh-session-actions](https://github.com/duanyunlun/dsh-session-actions) | 侧栏菜单**删除单条会话**及其存储 | 不涉及整体空间治理、缓存、插件残留 |
| 各家 `dsh-session-diff` / `dsh-diff-stat` | 会话级文件改动 diff / 单轮撤销 | 与磁盘占用无关 |

**一句话差异**：别人给的是"某个数字"或"删某一条"，我们给的是**全局账本 + 可解释的构成 + 可回滚的清理**。

---

## 3. 用户故事与验收场景

1. 我是重度用户，DSH 用了三个月，`C:` 盘少了 8 GB，我不知道去哪了 → 一条命令给出构成与排行。
2. 我想删掉某个 380 MB 的旧会话 → v0.1 只告诉我它在哪、多大；v0.2 起提供安全删除（进回收站、可撤销）。
3. 我卸了 5 个插件，但空间没回来 → 报告指出"孤立包目录 N 个 / 可释放 X MB"。
4. 我想把这个数字发到群里 → 报告是 Markdown，可截图、可复制。

---

## 4. 设计原则（五条不变量）

1. **数据安全优先**：v0.1 的写操作只有写自己的报告；唯一的「改动」是把 🟢「可以安全清理」的文件夹 **rename** 进插件自己的隔离目录（由 `allowCleanup` 把关、面板二次确认、一路写清单、随时可撤销）。**删除能力仍然不存在**——它连同 `L3` 是后续独立的一层。
2. **可解释**：每个数字都能下钻到"由哪些文件构成"，绝不给不可追溯的汇总值。
3. **可回滚**：任何移动都落盘清单（`manifest.json`，每移动一项重写一次），撤销按清单逐条校验后再移回，原位置被占就**拒绝覆盖**。真正删字节时走回收站而不是直接 unlink 的那套（`L3`）仍未实现。
4. **不出界**：只允许操作 `$DSH_HOME` 与会话临时目录；清理也只认 🟢 四个类别声明的那四种形状（`ownsCleanupPath`）。所有路径先规范化（解析 `..`、符号链接、reparse point）再做前缀比对。
5. **默认保守**：破坏性动作默认全关；永远先 dry-run 报告，再执行——现在这条从口号变成了流程：预演 → `allowCleanup` 开关 → 面板二次确认。

---

## 5. 功能分层

| 层级 | 行为 | 默认 | 版本 |
|---|---|---|---|
| **L1 只读体检** | 分类统计、Top N 排行、报告导出 | 永远开启 | **v0.1** |
| **L2a 清理预演** | 只列清单：绿色档的每一条、字节、落点；**不动任何文件** | 永远开启（纯读取，无开关、无二次确认） | **已实现** |
| **L2b 安全清理** | 真正移动（`rename` 进插件自己的隔离目录）+ 每项落盘清单 + 一键撤销；只处理**可再生产物**（过期 spill/tmp、`.plugin-manager/logs`、插件包缓存） | 由 `allowCleanup` 把关（**默认关**）+ 面板二次确认；**从不删除** | **本轮完成** |
| **L3 破坏性** | 彻底删除会话（含其存储）、清理运行时 | **关**，逐项显式确认 | v0.2+ |

---

## 6. v0.1 范围（本次只做这一层）

### 6.1 交付物

- 一个 host-only 插件，**零构建**（手写 ESM，直接 `lib/*.js`）
- 一个模型工具：`disk_report`
- 报告产物：`~/.dsh/disk-doctor/reports/disk-report-<timestamp>.md` 与同名 `.json`
- 配置项（9 个字段；全部声明 `.volatile()` 让宿主投影出表单。其中 **8 个**由插件**自己的浏览器半边** `client/client.js` 注册进 `ui-plugin-manager` 的 `plugins.bundle.config` 渲染出来——前 3 项摆在明面上，后 5 项收进「高级选项」折叠区，其中 **2 项是开关**；第 9 个 `allowCleanup` 由**面板的 ⚙ 齿轮**用同一套共享配置表单渲染。**v0.1 因此不再是无前端**——见 6.5 的第三、四、六、七次修订）
- 文档：`README.md`（中英）、`LICENSE`、安全声明

**v0.1 明确不做**：任何删除、任何清理按钮、任何前端页面、任何网络请求。

### 6.2 工具接口

```
disk_report
  参数（全部可选）：
    scope:     "summary" | "full"     默认 "summary"（full 会列出全部类别的 Top N 明细）
    topN:      number                 默认 10，范围 1..100
    write:     boolean                默认 true，是否把报告写到 reports/
    categories: string[]              默认全部；用于只看某几类
  返回：
    人类可读的 Markdown 摘要（进对话）+ 报告文件的绝对路径 + JSON 结构
```

### 6.3 扫描目标表

> 实现时**逐个探测存在性**，不存在的类别静默跳过并在 `warnings` 里记一行。
>
> **后续修订（2026-10-07）**：每个类别都带上了 `area` 字段并归入三个区（`data` / `app` / `cache`），**三个区各自给总数、永不相加**；下表补上这次新增或改名的行。详见文末变更记录。

| 区域 | id | 路径 | 可再生 | v0.1 动作 |
|---|---|---|---|---|
| data | `sessions` | `~/.dsh/sessions/**` | 否（是内容） | 统计 + 单会话排行 |
| data | `storages` | `~/.dsh/storages/**` | 否 | 统计（含 `session_projcache/sessions/*.json` 明细） |
| data | `profile-deps` | `~/.dsh/profiles/*/node_modules/**` | 是 | 统计 + 按包排行 |
| data | `profile-logs` | `~/.dsh/profiles/*/.plugin-manager/logs/**` | 是 | 统计 |
| data | `profile-market` | `~/.dsh/profiles/*/.dsh-market/**` | 是 | 统计 |
| data | `plugin-cache` | `~/.dsh/plugin-packages/**` | 是 | 统计（市场下载的 tgz 缓存） |
| data | `runtimes` | `~/.dsh/dsh-runtimes/**` | 否（要重下） | 统计 |
| data | `temp-spill` | `%TEMP%\dsh-spill-*`、`%TEMP%\dsh-*` | 是 | 统计 |
| data | `attachments` | 探测（`dsh-attachment-local` 的后端目录） | 否 | 统计 |
| data | `runtime-app` | `~/.dsh/electron/**` | 否 | 统计。**2026-10-07 改名为「Electron 运行文件」**（原「DSH 程序本体」），因为这里是整套解包的 Electron 运行时，旧名字会与新的「程序安装目录」区撞车 |
| data | `other` | `~/.dsh/**` 中未被以上覆盖的部分 | ？ | 统计（兜底，防漏账） |
| app | `app-install` | DSH 程序安装目录（由运行中的可执行文件探测，或 `appDir` 覆盖） | 否 | 统计；探测不到就写「没找到」 |
| app | `npm-global-dsh` | npm 全局安装的那份 DSH（`%APPDATA%\npm\node_modules\@deepseek-ai\dsh`、`npm_config_prefix` 等） | 否 | 统计。**2026-10-07 新增**：桌面应用与全局 `dsh` CLI 是两套安装，profile 的共享 `node_modules` 基本是指向它的 junction |
| cache | `chromium-data` | `%APPDATA%\@deepseek-ai\dsh-desktop` | 否 | 统计。**2026-10-07 新增** |
| cache | `pnpm-store` | `%LOCALAPPDATA%\pnpm` | 否 | 统计 + **重叠探针**（按 inode 量出与 data 区共享的字节，报为 `overlapBytes`）。**2026-10-07 新增** |

### 6.4 报告格式

> **后续修订（2026-10-07）**：下面是**最初的计划稿**。实际渲染出来的是三个区并排（data / app / cache），每个区带自己的总数，**不再有「总计」这一行**；JSON 契约在 `@1` 上**增量**扩展出 `areas`、`linkInstalls`、`capabilities`，每个类别多出 `area` 与 `overlapBytes`。现状见 `README.md` 的「输出示例」与「扫描范围」。

Markdown 摘要（进对话的样子）：

```
DSH 空间体检        总计 4.7 GB / 48213 个文件
  ├─ 会话日志            2.10 GB  (137 个会话，最大 380 MB)
  ├─ 插件 node_modules   1.30 GB  (6 个第三方)
  ├─ dsh-runtimes        0.80 GB
  ├─ spill / tmp         0.30 GB
  ├─ 缓存与日志           0.20 GB
  └─ 其他                 0.02 GB
可安全清理（可再生）：1.60 GB     需你决定：3.10 GB
报告已写入 ~/.dsh/disk-doctor/reports/disk-report-20261006-203000.md
```

JSON 结构（v0.1 固定 schema，便于以后做 UI/对比）：

```json
{
  "schema": "dsh-disk-doctor/report@1",
  "generatedAt": "2026-10-06T12:30:00.000Z",
  "dshHome": "C:\\Users\\<user>\\.dsh",
  "platform": { "os": "win32", "release": "10.0.26100", "node": "22.x" },
  "durationMs": 1840,
  "totals": { "bytes": 5046586572, "files": 48213, "dirs": 3921 },
  "categories": [
    {
      "id": "sessions",
      "label": "会话日志",
      "bytes": 2254857830,
      "files": 274,
      "regenerable": false,
      "roots": ["C:\\Users\\<user>\\.dsh\\sessions"],
      "topItems": [
        { "path": "...\\session-<uuid>", "bytes": 398458880, "files": 2, "note": "2026-10-06 · deepseek harness test" }
      ]
    }
  ],
  "warnings": ["2 个会话目录缺少 session.jsonl.zstd，疑似迁移残留"]
}
```

### 6.5 配置项（Config schema + `.volatile()` → 设置页）

> **实现期修订（2026-10-06）**：本节原写"由宿主的 Config schema 自动派生设置页"，**这个前提是错的**。实测 `@deepseek-ai/dsh-settings`（0.2.0-rc.2）：
> `lib/types/schema.js` 的 `volatileForm()` 只收集"**最近的 volatile 祖先**"下的字段，没有 volatile 字段时返回 `undefined`；`isVolatilePath()` 同样只放行 volatile 路径下的编辑；其 README 明确写 "Forms expose **only volatile fields**… Ordinary configuration remains editable through Cordis configuration files"，且 `autoGenerate` 虽默认开启，但"**no shipped client does so yet**"。
>
> 也就是说：**普通字段根本不会出现在任何设置界面里**，只能在 profile 的 Cordis patch 里改。因此 5 个字段全部包了 `.volatile()`——这才是本版本暴露设置表单的真实机制（已装插件 `dsh-image-gen` 对全部用户可见字段采用同一写法，并为不支持该方法的老宿主做了条件保护）。
>
> 另有一处必须处理的细节：volatile 字段交给 `apply` 的**不是普通值，而是一个冻结的 `{ get() }` 盒子**（cosmokit 的 `createVolatile`）。直接读 `config.dshHome` 会静默拿到盒子并落回默认值。实现里用 `plainValue()` 解盒，同时兼容非 volatile 的普通值，两种宿主都能跑。
>
> 验证：用真实的 `dsh-settings` 投影函数跑 `volatileForm(Config)`，确实得到恰好 5 个字段的表单。
>
> **第二次修订（试装实测后）**：volatile **仍然不够**。装好并实测后确认，本版本**没有任何已发布的客户端会根据 schema 生成设置页**——证据：`autoGenerate` 只出现在 `dsh-settings` 自身（服务代码与其 README），`ui-plugin-manager` 那个 183 KB 的 client 完全不引用它；真正的配置页面一律由插件**自己的浏览器半边**注册进 `ui-plugin-manager` 的 `plugins.item` / `plugins.bundle.config` / `plugins.row.config` 插槽（本机已装插件里只有 `dshmarket` 这么做）。结论：**host-only 插件在本版本没有任何设置界面**，5 个字段只能在 profile 的 Cordis patch 里改。这与 §6.1「v0.1 不写任何前端」**直接矛盾**：要设置页就必须有前端。v0.1 选择保留「无前端」，把设置界面留给 v0.1.1/v0.2 的客户端半边。
>
> **第三次修订（决定加客户端半边之后）**：为真正拿到设置页，v0.1 补了一个浏览器半边 `client/client.js`（约 300 行，**仍然零构建**——客户端用的是 web 客户端自己的模块格式 `window.__ModuleLoader__.load({id, factory})`，用 `react.createElement` 手写，不需要打包器）。它做三件事：注册中英词典；用共享的 `SettingsFormModel` + 5 个字段 spec 承载表单；把页面**无条件**注册进 `plugins.bundle.config`（**以 bundle 包名 `dsh-disk-doctor` 为键**），与 `dshmarket` 对同一插槽的做法一致。注意这里**刻意不用** `whileServed`：那是官方 `plugins.item`（官方插件页）的写法，放到 `plugins.bundle.config` 上只会把「宿主尚未提供命名空间」变成**整页消失**这种无法诊断的失败——现在改为让表单自己报 `available: false`。
>
> 两个字段没有现成的表单控件：共享控件只是一个文本输入框，只自带 text / number 两种 spec。因此 `excludeGlobs` 以**英文逗号分隔**承载，`followSymlinks` 以字面量 `true`/`false` 承载；两者的 `format`/`parse` 都是本插件自己写的（`settingsBooleanField` / `settingsListField`）。空草稿 = 清除覆盖，与文本字段一致。
>
> 因此 §6.1 原定的「v0.1 不写任何前端」被**明确放弃**（用户选择要设置界面）；`dshhub.surfaces` 也从 `["host"]` 改为 `["host","web"]`。
>
> **第四次修订（2026-10-07）**：字段增至 **8 个**，设置页渲染**宿主声明的每一个字段**——`dshHome` / `topN` / `reportDir` 三个摆在明面上，`excludeGlobs` / `followSymlinks` / `appDir` / `allowOpenFolder` / `allowOpenFolderSensitive` 收进「高级选项」折叠区。新增的三项各有分工：`appDir` 用来手动覆盖程序安装目录的探测；`allowOpenFolder` 是面板「打开文件夹」按钮的总开关；`allowOpenFolderSensitive` 是**另一道独立同意**，只有打开它，🟠「要谨慎处理」与 ⚪「不要动」两档的位置（对话目录、程序文件）才能被打开。表单里文本编码的字段也从两个变成四个：`excludeGlobs` 是逗号分隔列表，`followSymlinks`、`allowOpenFolder`、`allowOpenFolderSensitive` 填字面量 `true`/`false`。
>
> **第四次修订的补充（活引用，别在 apply 时快照）**：`.volatile()` 的意义是「**不重新挂载**即可编辑」——宿主用 `createVolatile()` 返回一个冻结的 `{ get() }`，保存时通过 `updateVolatile()`/`volatileEntries()` 把新值**写进同一个引用**，**不会**重新调用 `apply`。因此 `apply` 里 `plainValue(config.x)` 快照下来的值会一直回答旧值：用户打开开关却看不到任何变化，只能靠再重启一次。实现上改成把「读当前配置」的闭包 `current()` 传给工具与各条本地路由，用到时再 `normalizeConfig(raw)`（探测只花几毫秒，而报告路由本来就要重扫）。`test/plugin.test.mjs` 里用可控的假引用（`{ get }` 背后换值）钉住了这条：主开关与敏感档打开后**下一次请求**即生效，关掉也立即恢复拒绝。
>
> **第五次修订（2026-10-07，用户实机反馈后）**：两处改动。(1) **默认值改了**：`allowOpenFolder` 的默认值从 `false` 改为 **`true`**——用户最初的要求就是「只把中等和高的两档默认关掉」，绿色档应当开箱可用；`allowOpenFolderSensitive` 仍默认 `false`。总开关的定位因此从「必须先打开」变成「急停开关」：关掉 = 面板所有「打开」按钮置灰 + 宿主以 `disabled` 拒绝。(2) **两个权限改成设置页上的开关（switch）**，不再是让人手打 `true`/`false` 的文本框（用户的抱怨就是页面显示一个字面量 `false`，还要他自己改成 `true`）。`excludeGlobs`（逗号列表）与 `followSymlinks` 仍由文本承载；`allowOpenFolder` / `allowOpenFolderSensitive` 改走开关控件——标签、提示行，外加一个**只有被改过之后才出现**的「恢复默认」小控件。暂存值仍走原来那套文本编码，所以保存时写进 profile patch 的内容一字未变。
>
> 同一轮还新增了**颜色说明**（`colorHelpTitle` + `color_safe` / `color_care` / `color_keep`）：同一份说明渲染在两个地方——面板底部、范围说明的上方（紧凑模式下隐藏），以及设置页「高级选项」里两个开关的**正下方**，因为那里正是读者被要求判断「橙色和灰色那些要不要开」的地方。三个档位复用面板行上同一个彩色圆点与同一组 `level_*` 文案，所以说明与行的颜色不可能各说各话。
>
> 顺带修掉一个**「默认值只写在 schema 里」的隐患**：`normalizeConfig` 现在用 `plainBoolean(value, fallback)` 读取三个布尔字段，字段缺失时回落到文档声明的默认值。宿主的 schema 确实会先填默认值，但任何直接归一化裸配置对象的路径会把 `undefined` 读成 `false`——对 `allowOpenFolder` 恰好与 schema 的承诺相反，面板探针就是踩到这一点才发现的。默认值因此在 schema 与 normalizer 两处都写明。见文末变更记录。
>
> **第六次修订（2026-10-07，清理下半身落地）**：字段增至 **9 个**——新增 `allowCleanup`（**默认 `false`**），设置页渲染 3 个明面字段 + **6 个**高级选项，其中 **3 个是开关**（`allowOpenFolder` 默认开、`allowOpenFolderSensitive` 默认关、`allowCleanup` 默认关）。它同样走开关控件与同一套文本编码，所以 profile patch 的写法不变。`capabilities` 随之多出一个 `cleanup` 布尔值（面板据此决定移动按钮是否可用），`normalizeConfig` 的布尔回落也覆盖到它。详见 §6.6。
>
> **第七次修订（2026-10-07，用户要求把开关挪进面板）**：`allowCleanup` **不再渲染在插件页面上**——用户说「我想把那个允许清理开关移动到 ui 界面的右上角那个设置按钮里」，所以它现在是面板 **⚙ 齿轮**里的第 4 个控件（在分隔线下面、三个纯浏览器外观偏好之后）。插件页面因此渲染 **8 个字段、其中 2 个开关**（`allowOpenFolder`、`allowOpenFolderSensitive`）；第六次修订里那句「设置页 9 个字段 / 3 个开关」被本次取代。**它仍然是宿主设置**：齿轮用的是 `ctx.configForms.get(namespace)` 拿到的**同一份共享 scope**，经 `SettingsFormModel` 暂存 + `save()` 写入，所以落盘与设置页保存完全等价，两个界面也读到同一个值；齿轮显示的是宿主生效值，`scope.writable === false`（被 home patch 或命令行覆盖锁住）时开关置灰，写入被拒时提示「这个设置被上层配置锁定了，改不了」。测试里专门有一条钉住「第 9 个字段没有凭空消失」（齿轮的写入确实到达了假 scope）。

| 字段 | 默认 | 含义 |
|---|---|---|
| `dshHome` | `$DSH_HOME`，否则 `~/.dsh` | 数据文件夹（跟随宿主的 `DSH_HOME`，所以换台机器也自动正确） |
| `topN` | `10` | 每个类别列出的条目数 |
| `excludeGlobs` | `[]` | 额外排除（如某个大附件目录） |
| `reportDir` | `<dshHome>/disk-doctor/reports` | 报告输出目录 |
| `followSymlinks` | `false` | 是否跟随符号链接（默认否，防越界与死循环） |
| `appDir` | 空 = 自动探测 | DSH 程序安装目录；填了就覆盖探测，并在报告里标成「来自设置」 |
| `allowOpenFolder` | **`true`** | 插件页面上的开/关开关。面板「打开」按钮的总开关，**默认开**，所以 🟢 安全档开箱可用；关掉 = 全部置灰且宿主拒绝（急停） |
| `allowOpenFolderSensitive` | `false` | 插件页面上的开/关开关，**默认关**。第二道同意：是否允许打开「要谨慎处理」「不要动」两档的位置 |
| `allowCleanup` | `false` | **面板 ⚙ 齿轮里的开关**（不在插件页面上），**默认关**。让清理真的能动：关着时移动按钮置灰、两条 POST 一路 403 `disabled`；打开后仍需面板上两次点击确认 |

### 6.6 清理：预演 → 移动 → 撤销（`L2`，本轮完成）

**预演（`planCleanup()`）仍然是只读的**，而它现在有了下半身：`performCleanup()` 真的移动、`undoCleanup()` 真的撤销。计划文档的第一个字段仍是 `dryRun: true`——那是**预演**的契约；真正动手的是另一个函数、另一条路由、另一个开关。`lib/cleanup.js` 的 `planCleanup()` 跑一次**只读**扫描——限定在 🟢「可以安全清理」四个类别、条目上限 `PREVIEW_ITEM_LIMIT = 500`（所以计划能列出**全部**，而不是报告里的 Top N）——然后返回一份计划：

| 字段 | 含义 |
|---|---|
| `schema` / `generatedAt` | 契约是 `dsh-disk-doctor/cleanup@1` |
| `dryRun` | 恒为 `true`，而且是文档的第一个字段 |
| `destination` | `<dshHome>/disk-doctor/quarantine/<YYYYMMDD-HHMMSS>` |
| `items[]` | 计划会移动的条目：`path` / `bytes` / `files` / `categoryId` |
| `skipped[]` | 找到了但刻意不列，附 `reason`（当前只有 `'recent'`） |
| `totalBytes` / `totalFiles` / `itemCount` | 会移动的总量 |
| `truncated` | 某一类超过 500 条时为 `true`，并附一条 warning |
| `eligible[]` | 参与的四类：`profile-logs` / `profile-market` / `plugin-cache` / `temp-spill` |
| `refused[]` | 其余**每一个**类别连同它的 `safety`，说明「为什么它们不参与」 |
| `warnings[]` | 预演自带的那几句话（只读、只绿档、跳过太新的、达到上限） |

两条规则值得单独记下：

- **只碰安静了一小时的东西**（`RECENT_USE_MS = 60 * 60 * 1000`）。判断用的是**条目内部最新的 mtime**，不是文件夹自己的时间戳——进程一直往目录里写文件时，目录的 mtime 是不动的。为此 `scan` 现在给每个 `topItems` 条目带上 `mtimeMs`（条目内最新文件时间，整数），并把它加进工具 output schema 的**必填**字段。无法检查的条目同样跳过，而不是列进计划。本机上这条规则跳过了约 466 KB 刚被写过的临时目录，而那正是「绿色档里最大的那一项通常是当前会话自己的溢出目录」的实证。
- **拒绝是有理由的，不是遗漏。** ⚪ 里是程序本体、自带运行环境与你的对话，动它等于弄坏 DSH；🟠 里是装好的插件，而「移走再重启看看」是**必然失败**的。所以 `refused[]` 会把每一类连同 `safety` 一起报出来。

#### 6.6.1 移动（`performCleanup`）

**动手之前会把计划重新画一遍**（`planCleanup` 再跑一次），所以永远不会按一份过期清单行动：你在看预演之后才被写过的条目会掉出这次移动，记进 `skippedRecent`。然后逐项：

- **归属再校验一次**（见 6.6.3），不通过就记 `reason: 'outside-root'`；扫描之后消失的记 `'missing'`。
- **目标位置**是 `<隔离目录>/<分类 id>/<条目在自己根下的相对布局>`，`mkdir` 之后 `fs.renameSync(原, 目标)`。两个 profile 都有 `.dsh-market`，所以名字被占用时加 `-2`、`-3`……后缀（`uniqueTarget`）。
- **每一项成功之后立刻重写 `manifest.json`**（`writeManifest`），所以中途被打断，盘上的记录仍然和现实一致。
- 计划为空时**一个文件夹都不建**：返回 `status: 'nothing-to-move'`、`manifestPath: null`。批次文档 `dsh-disk-doctor/quarantine@1` 的 `status` 从 `moving` 走到 `moved` / `moved-with-failures`，并带上 `bytes` / `files` / `items[]` / `skippedRecent` / `failures[]`。

`renameSync` 是清理模块里**唯一**的改动调用：不复制、不删除、不截断。

#### 6.6.2 撤销（`undoCleanup`）

`readManifest(dshHome, id)` 只认 `YYYYMMDD-HHMMSS`（可带 `-N`）这种批次 id——**会穿越的 id 什么都读不到**。`undoCleanup()` 在发生任何一次 rename 之前，逐条重新校验：

1. 记录里的每个 `target` 必须真的在那个批次目录内（`isUnder(target, batchDir)`），否则 `target-outside-batch`；
2. 每个 `original` 必须是清理有权拥有的路径（`ownsCleanupPath`），否则 `original-outside-roots`；
3. 目标不在隔离目录里 → `not-in-quarantine`；
4. **原位置已经重新出现 → `occupied`，拒绝、绝不覆盖。**

所以**手改过的清单没法把文件挪到别处去**。恢复按**倒序**进行（嵌套条目先回去，包含它们的文件夹后回去），批次状态落到 `undone` / `partly-undone`（什么都没恢复回原状态），并在记录里追加 `restored[]` 与 `failures[]`。`listQuarantine(dshHome)` 按新的在前列出所有批次（读不到清单的标 `unreadable`），供面板给每个批次一个撤销按钮。

#### 6.6.3 「归属」是怎么判的（`ownsCleanupPath`）

`lib/targets.js` 的 `ownsCleanupPath(env, candidate)` 回答「绿色档清理是否有权拥有这个路径」，而且**与它此刻是否存在无关**——这正是关键：整目录条目（`.dsh-market`、某个 `dsh-spill-*`）**自己就是根**，一移动它就不存在了；如果用「在某个**存在**的根之内」来判断，撤销就会拒绝把用户自己的文件放回去。**这是真机探针抓出来的真 bug。**

每个绿色类别各自声明 `owns` 规则，一共四种形状：

| 类别 | 规则 |
|---|---|
| `profile-logs` | `<profiles>/<真实存在的 profile>/.plugin-manager/logs`（叶子形状，正好一段，父目录必须是 profile 目录） |
| `profile-market` | `<profiles>/<真实存在的 profile>/.dsh-market`（同上） |
| `plugin-cache` | `<dshHome>/plugin-packages` 之内 |
| `temp-spill` | 父目录就是 `<tempDir>`，且名字以 `dsh-` 开头（按形状判断，因为一移动那些目录就都不存在了） |

🟠 与 ⚪ 永远不会被 `ownsCleanupPath` 认可。

#### 6.6.4 开关、二次确认与路由

新增配置项 **`allowCleanup`，默认 `false`**，它由**面板的 ⚙ 齿轮**编辑（见 6.5 第七次修订）——插件页面因此渲染 **8 个字段、2 个开关**（`allowOpenFolder` 默认开、`allowOpenFolderSensitive` 默认关）。报告路由的 `capabilities` 多出一个 `cleanup` 布尔值，面板据此决定移动按钮是否可用；齿轮里的开关改完经 `current()` 在下一次请求即生效。

`registerCleanupRoute` 现在是一个路由三种行为：

- `GET`（或 `HEAD`）→ 预演计划 **加上** `batches: listQuarantine(...)`，面板一次就能画出「会移动什么」和「把哪个批次放回去」。
- `POST ?action=move` → `performCleanup(...)`。
- `POST ?action=undo&id=<批次>` → `undoCleanup(...)`，失败回 400 并带上 `failures`。

两个 POST 在 `allowCleanup !== true` 时一律 **403 `disabled`**；其他动词 405（`allow: GET, HEAD, POST`）。两条 POST 都通过 `current()` 重读实时配置，所以开关不必重启。**没有删除动作**：清空隔离目录是用户在插件之外做的事，这也是为什么这里没有任何一条代码路径能毁数据。

**两次点击的机制（这里踩过一次真 bug）**：移动按钮的 `disabled` 只跟 `caps.cleanup` 走，**询问期间保持可点**——第一下把按钮文字换成「确定，移动」并渲染询问行（「确定移动这 N 项（共 X）吗？」＋「确定，移动」／「取消」），第二下（改过字的按钮，或询问行里的确认）才 POST `action=move`。最初的实现写成 `disabled: caps.cleanup !== true || confirming !== true`，而浏览器**不会把点击送给 disabled 按钮**，于是第一下永远无法把 `confirming` 置真、确认行永远打不开、移动彻底不可达——用户实测「点了完全没反应」，这就是原因。移动失败现在也会分三种说话，不再静默：`disabled`（权限没开）、404/405（**宿主还是旧版本**——这条 POST 路由还不存在，重启 DSH 再试）或请求本身失败（**连不上宿主**）。

#### 6.6.5 审计与面板

源码审计测试升级为：整个包禁止 `unlink`、`unlinkSync`、`rmdir`、`rmdirSync`、`rm(`、`rmSync`、`trashItem`、`Remove-Item`、`shutil.rmtree`；`renameSync` **只允许出现在一个文件里**（`lib/cleanup.js`）；`readFileSync` 从恰好 1 处放宽到恰好 **2 处**，且都必须是**有名有姓、用完即关**的文件——DSH 自己的工作区索引，和本插件自己的隔离清单。

面板的清理方框现在是完整的三段：绿色档总量及来源、「看看会移动什么」按钮（出结果后变「重新列一次」）、最多 12 条按大小倒序的计划条目（每条带「打开」）、会移动的条目数与总量、落点目录、清单 warnings 原文；然后是**移动到回收站**按钮（没有 `allowCleanup` 时置灰并写明原因，询问期间改字为「确定，移动」并保持可点）、二次确认行（「确定移动这 N 项（共 X）吗？」＋「确定，移动」／「取消」）、移动后的绿色小结（「已移动到回收站：N 项，共 X」＋「接下来：重启 DSH、用一会儿」）、**撤销**按钮、撤销结果（含没能移回的项）、失败原因（权限没开／宿主旧版本／连不上），以及**回收站里的批次**列表（每个批次一个撤销按钮，已撤销的不再列出），最后是那句「确认一切正常后，自己清空那个回收站文件夹就行——这个插件不会替你删任何东西。」一直显示的说明块标题也从「第二步会这样做（还没做）」改成了 **「第二步会这样做」**，因为现在它真的会做。

**齿轮（⚙）**：面板右上角的齿轮里，前三个是纯浏览器外观偏好（显示百分比 / 显示完整路径 / 紧凑模式），分隔线下面是**清理权限开关**（标签「允许清理（移动到回收站）」，提示「只移动、绝不删除，随时可一键撤销」）。它在写入中或被上层配置锁定时置灰，写入被拒时在开关下面直接显示原因——这是插件页面上**唯一**不出现的那个设置。

#### 6.6.6 真机证据（2026-10-07）

预演约 **45 ms**，列出 **8 项 / 3,854.8 KB**，跳过 **466,243 字节**（太新），落点 `…\quarantine\20261007-022153` 且 `exists=false`；对绿色目录里全部 **144** 个被监视条目（外加隔离目录的父目录）做指纹比对，前后**逐字节一致**。

随后真做了一次移动（对象是本机已经死掉的临时溢出目录）：**6 项 / 3,833.3 KB**（`bytes: 3925285`，`files: 10`），每一项原位置都空了，每一项目标都出现在 `quarantine/<时间戳>/temp-spill/…`，**0 失败**；`undoCleanup` 把 6 项全部移回、同样 **0 失败**，事后对所有「清理可涉及路径」的指纹**逐字节一致**，清单留在 `status: 'undone'`。隔离目录里留下的批次（`20261007-030514` 及其后几个）只剩 `manifest.json` 和一个空的分类目录，用户可以自行删除。

---

## 7. 架构与文件布局

### 7.1 插件组成

**host-only，零构建**。理由：v0.1 没有任何 UI 需求；宿主的设置页由插件自己的 `Config` schema 投影而来（见 6.5 的修订：**只有声明了 `.volatile()` 的字段会被投影**），所以省掉前端和打包两步，直接降低出错面。

### 7.2 目录结构（计划）

```
dsh-disk-doctor/
├─ package.json          # 含 dsh.bundle.patch 声明、exports、peerDependencies
├─ cordis.patch.yml      # insert 一行：id: disk-doctor, name: 'dsh-disk-doctor'
├─ lib/
│  ├─ index.js           # 插件入口：name / Config / apply(ctx) / 工具注册
│  ├─ scan.js            # 分类遍历、stat 汇总、Top N（纯函数，便于测试）
│  ├─ report.js          # Markdown + JSON 渲染
│  └─ targets.js         # 扫描目标表（路径 → 类别），集中管理便于加类别
├─ test/
│  └─ scan.test.mjs      # fixture 目录 + 断言
├─ README.md / README.zh.md
├─ LICENSE               # MIT
└─ .gitignore
```

### 7.3 关键实现约束

- **只用 `node:fs` / `node:path` / `node:os`**，不引入任何运行时依赖（体积小、审计容易、也符合"可信"叙事）
- 用 `stat`（不读文件内容）做体积统计；大文件用 `withFileTypes` 递归，避免把整个目录树载入内存
- 符号链接 / Windows junction 默认不跟随，遇到就在报告里标注
- 路径比较前先 `fs.realpath` 规范化；拒绝任何不在允许根内的写操作
- 单次扫描要有上限保护（默认最多 50 万文件 / 30 秒），超限时报告标注 `truncated: true` 而不是跑死

---

## 8. 安全规则（v0.1 写进文档，v0.2 才启用）

1. **dry-run 强制**：任何删除先输出"将删除 N 项 / 释放 X"清单，需第二次显式调用才执行
2. **路径白名单**：只允许 `$DSH_HOME` 与会话临时目录；先规范化再前缀比对（防 `..` 与符号链接穿越）
3. **永不删**：当前会话自身、有活动 job/schedule 的会话、已加载插件的运行目录、`settings.yaml`、`.credentials.yaml`、`.anonymous-user-id`
4. **可回滚**：删除前写 `undo.json`（路径、字节、时间、类别），Windows 走回收站（`Microsoft.VisualBasic.FileIO.FileSystem.DeleteDirectory` 或 Electron `shell.trashItem`，两者都要有回退路径）
5. **分级**：可再生类默认允许清理；内容类默认关闭，且删除会话时必须同时从其工作区的 `sessionIds` 里摘除 id（否则列表留幽灵行）

---

## 9. 跨平台注意点

- **Windows（首要）**：长路径（`\\?\` 前缀）、junction/reparse point、保留名（`CON`/`NUL`…）、权限拒绝（`EPERM`）要当作"跳过并记录"而不是致命错误
- **本机环境的一个已知坑**：`E:\deepseek harness test` 曾经出现过 Windows ACL 导致沙箱无法授权的问题；本插件扫描时要能容忍"读不到的目录"（记 `unreadable`，不影响其余统计）
- macOS/Linux：符号链接与硬链接去重（同一 inode 只算一次，避免虚报）

---

## 10. 实现计划（v0.1，估 1–1.5 天）

| # | 任务 | 产出 | 估时 |
|---|---|---|---|
| 1 | **抄骨架**：读 app.asar 里 `@deepseek-ai/dsh-tool-todo`（或 `dsh-tool-fs`）确认工具注册签名；产出最小可加载插件 | `lib/index.js` | 1–2 h |
| 2 | 扫描器 | `lib/scan.js` + `lib/targets.js` | 2–3 h |
| 3 | 报告器 | `lib/report.js` | 1 h |
| 4 | 工具接入 | `disk_report` + 参数校验 + 落盘报告 | 1 h |
| 5 | 配置 schema | `Config` | 0.5 h |
| 6 | 本地试装 | profile patch 行 + 验证工具出现 | 1 h |
| 7 | 测试 | `test/scan.test.mjs` | 1–2 h |
| 8 | 文档 | README 中英 + LICENSE + 安全声明 | 1–2 h |

> **完成情况（2026-10-06）**：1–8 全部完成。实际产出比计划多两处：`lib/targets.js` 里复刻了宿主的 `projectKey()` 算法（用于会话标注），以及 `test/` 下多了一套入口级测试（`plugin.test.mjs` + `test/stubs/`）。第 6 项"本地试装"因需重启 DSH 尚未执行，其余各项均有对应的自动化验证。试装的完整步骤（含把运行时自带 pnpm 接到 PATH 的方法，以及回退命令）见 `TRIAL-INSTALL.md`。

---

## 11. 测试与验收标准（v0.1 Definition of Done）

- [x] `disk_report` 返回的各类合计，与手工 `du` / PowerShell `Measure-Object -Sum Length` 的误差 **< 2%**
      → 实测**完全一致**：测试用独立的递归求和对同一 fixture 对照（逐字节相等）；并在真实 `~/.dsh` 上与
        PowerShell `Get-ChildItem -Recurse -File | Measure-Object -Sum Length`（排除 reparse point）
        交叉比对，**文件集合与字节总数双方都是 8,903 个文件 / 767,049,761 字节**
- [x] 5 GB / 5 万文件规模扫描 **< 10 秒**，且有超限保护
      → 实测 **4.6 秒 / 50,000 文件**；超限保护另有测试（到顶标 `truncated: true`）
- [x] 全仓库 `grep -E "unlink|rmdir|Remove-Item|trashItem"` **零命中**（v0.1 不删任何东西）
      → 由测试自动断言（同时断言 `lib/` 无任何网络调用）
- [x] 写操作只出现在单一白名单位置（报告目录），其余全为读
      → 由测试自动断言：只有 `index.js` 写文件，且只有 3 处写调用
      → **2026-10-07 修订**：清理下半身落地后，写入面是两处（报告目录，以及隔离批次的 `manifest.json`），另有一次 `renameSync`；审计规则相应升级为「整包禁止一切删除调用、`renameSync` 只允许出现在 `lib/cleanup.js`、`readFileSync` 恰好两处（工作区索引 + 本插件自己的隔离清单）」。见 §6.6.5。
- [x] 无网络调用（`fetch` / `http` 零命中）
- [x] 每个类别都有 Top N 明细（路径 + 字节），报告可追溯
- [x] 在作者自己的 profile 里试装成功，工具在会话中可用
      → 已装进 `desktop` profile（`link:` 到工作副本 + 选中 bundle），HMR 立即生效、**无需重启**；实测调用
        `disk_report` 成功返回摘要并写出 `.md` / `.json`
- [x] 设置页出现 5 个配置项 —— **已达成并在真实浏览器中确认**（2026-10-07 起为 8 项，见 §6.5 第四次修订与文末变更记录）
      → 原设计**无法**达成：`dsh-settings` 只为 volatile 字段投影表单，而没有任何已发布客户端按 schema 生成页面
        （`autoGenerate` 无人消费）；配置页面必须由插件**自己的浏览器半边**注册。
      → 已补 `client/client.js`（零构建），无条件注册进 `plugins.bundle.config`（键为 bundle 包名 `dsh-disk-doctor`）。
      → **确认方式**：用户重启 DSH 并打开 插件/Plugins → Installed → `dsh-disk-doctor`，页面上出现 5 个字段
        （dshHome / topN / excludeGlobs / reportDir / followSymlinks）。宿主半边也在重启后实测调用 `disk_report` 成功。
        63 项客户端测试覆盖清单接线、插槽注册、字段的 format/parse 与渲染树、三段视图与齿轮开关；其中「宿主能产出的每个分组在中英词典里都有名字」这条的类别 id **从宿主自己的 `CATEGORY_DEFS` 推导**（不再手抄——手抄的那版漏了四个新类别，`npm-global-dsh` 因此在面板上显示成原始键名 `cat_npm_global_dsh`），宿主新增类别而客户端没命名时它会直接失败。
- [x] fixture 测试在临时目录上跑通（含符号链接、不可读目录、空目录三种边界）
      → 另加了"扫描根不存在"的边界

---

## 12. 打包与发布

### 12.1 清单（清单要求可被 `dsh plugin add` 安装）

- `package.json` 必须声明 `dsh.bundle.patch` → `./cordis.patch.yml`（参考已装插件 `dshmarket`、`@michengai/dsh-archive-manager`、`dsh-cost-meter` 的写法）
- `peerDependencies` 指向 `@deepseek-ai/dsh-*` 与 `@deepseek-ai/cordis`，**范围写宽**覆盖 `0.1.x ~ 0.2.x`（生态里宿主版本很杂）
- 类型/入口：`"type": "module"`，`exports` 指向 `./lib/index.js`
- 本地安装也可用绝对路径（插件页支持"本地绝对路径"这一 spec 形式）

### 12.2 隐私与可信（这是本插件的卖点，要认真做）

- **脱敏的边界（2026-10-07 用户确认接受）**：两条输出通道刻意不同。**面板路由 `redact: false`**——面板只画在用户自己的屏幕上，路径要能复制、要能直接打开文件位置；而**凡是会离开这台机器的输出都脱敏**：工具返回值（`redactDeep`）、Markdown 报告与 JSON 报告都把主目录替换成 `~`（`redactHome` / `toJsonReport` 默认 `redact !== false`），所以 `C:\Users\<你>\.dsh\…` 对外只会是 `~\.dsh\…`。用户 2026-10-07 明确说「不脱敏也可以实施」，这条**结案**，不再是待确认的取舍。
- **「完整路径」这条也结案（2026-10-07）**：用户的原话是「完整路径的问题不是解决了吗，已经可以直接复制和打开文件位置了」。因此**不再计划**任何「展开查看完整路径」的入口——复制拿到真实路径、打开跳到文件位置，这两件事已经覆盖了需求，明细行的可读名字与图例的「显示名称／显示完整路径」切换就是最终形态。
- README 顶部放**能力声明**：会读哪些路径、会不会联网（不联网）、会不会写（只写自己的报告目录）
- ~~尽量提供~~ **已提供** `dsh.compatibility` 与 `dshhub` 能力声明；字段形状取自**已发布插件 `dsh-cost-meter@1.8.12`** 的真实清单（不是猜的）：
  - `dshhub.permissions.network` 声明为**空数组**——即"一个网络来源都不访问"，这正是本插件的卖点；
  - `dshhub.surfaces: ["host"]`（没有浏览器半边）、`dshhub.schemaVersion: 1`、`dshhub.categories`、`dshhub.summary`；
  - `dsh.compatibility.dshReleases` **只写实测过的版本**（当前仅 `0.2.0-rc.2: compatible`），不笼统声称全兼容；
  - 测试把该声明与代码**绑定**：`lib/` 里一旦出现网络调用，或声明与实测版本不符，测试即失败。
- 用 GitHub Actions + npm provenance（OIDC 签名）发布，装的时候能显示来源可信

### 12.3 发布步骤

1. GitHub 建**私有**仓库（先私有，等 README / LICENSE / 安全声明齐了再公开）
2. 打 topic `dsh-plugin`
3. npm 发布 `dsh-disk-doctor`（先 `npm view` 查重）
4. 公开后 PR 到 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)（收录标准：能装、描述属实、分类正确、在维护）
5. dsh-market 实时读那份清单 → **自动上架所有第三方客户端**

### 12.4 凭据与署名（待用户确认）

- **不需要** GitHub 账号密码，也不要把 token 贴进对话
- 推荐路径：用户自己跑 `gh auth login`（浏览器设备码），之后由我用 `gh repo create --private` + `git push` 上传；凭据保存在 gh 自己的配置里
- 提交署名用**仓库局部** `user.name` / `user.email`（不动全局 git 配置）——具体值待用户提供

---

## 13. 开放问题（已全部解决，留档）

| # | 问题 | 结论（2026-10-06 实现期实测） |
|---|---|---|
| 1 | 本版本 DSH 注册模型工具的**确切签名** | `ctx.tools.register(defineTool({ name, description, parameters, output: { schema, render }, execute(args, exec), presentCall }))`；插件导出 `name` / `inject: ['tools']` / `Config` / `apply(ctx, config)`。`parameters` 是隐式属性表（每项可带 `required: true`） |
| 2 | Config schema 用 `@deepseek-ai/schemastery` 还是 `zod` | 插件作者用 **`@deepseek-ai/schemastery`**；`zod` 只出现在官方包内部的投影校验里 |
| 3 | 是否需要构建步骤 | **不需要**。手写 ESM 直接跑通，含真实 cordis + 真实 `ToolRuntime` 端到端 |
| 4 | 只扫当前 profile 还是全部 profile | 遍历 `profiles/*` 全部，按 profile 归组 |
| 5 | 附件目录的确切位置 | 本机不存在该目录；实现为探测式，找不到记 warning 并归入 `other` |
| 6 | Windows 回收站的实现路径（v0.2） | 未实施（v0.1 无删除层） |
| 7 | "会话正在使用"的判定（v0.2） | 未实施（v0.1 无删除层） |

---

## 14. 附录：本次调研的可复用事实

### 14.1 本机关键路径（已实测存在）

```
C:\Users\<user>\.dsh\
├─ sessions\<escaped-cwd>\session-<uuid>\session.jsonl.zstd (+ session.v4.jsonl.zstd)
├─ storages\workspace.json              # workspaceIds / archivedSessionIds / tables.workspaces[].sessionIds
├─ storages\session_projcache.json      # 会话投影缓存索引
├─ storages\session_projcache\sessions\session-<uuid>.json
├─ profiles\desktop\{package.json,cordis.patch.yml,cordis.yml,pnpm-lock.yaml,pnpm-workspace.yaml}
├─ profiles\desktop\node_modules\       # 第三方插件（hoisted）
├─ profiles\desktop\.plugin-manager\logs\operation-*\pnpm.log
├─ profiles\desktop\.dsh-market\{state.json,log.ndjson}
├─ dsh-runtimes\dsh-primary-runtime\dependencies\{python,node,pnpm}
├─ settings.yaml 与 .credentials.yaml   # 永不可删
└─ .anonymous-user-id                   # 永不可删
%TEMP%\dsh-spill-*\                     # 工具输出溢出临时目录
```

### 14.2 参考实现（可直接抄写法）

| 用途 | 路径 |
|---|---|
| 插件清单/`dsh.bundle.patch` 写法 | `~/.dsh/profiles/desktop/node_modules/dshmarket/package.json` + `cordis.patch.yml`（**带完整 `src/`，是最好的模板**） |
| 声明 peer 范围的写法 | `@michengai/dsh-archive-manager/package.json`（含多版本矩阵） |
| 权限/能力声明字段 | `dsh-cost-meter/package.json` 的 `dshhub.permissions` |
| 官方工具插件源码（确认注册 API） | `E:\dsh1\resources\app.asar` 内的 `dsh/node_modules/@deepseek-ai/dsh-tool-todo/`、`dsh-tool-fs` |

读取 asar 内文件的方法：读前 8 字节得到 header 大小，解析 JSON header，文件数据偏移 = `8 + headerSize + entry.offset`。

> **实现期更正**：头部是**双重 pickle 嵌套**，偏移 0 是常量 4，偏移 4 是 headerSize，偏移 8 才是 JSON 字符串长度，**JSON 从偏移 12（即 header 缓冲区的第 8 字节）开始**。只按"前 8 字节"读会把长度字段当成 JSON 开头而 parse 失败。数据偏移公式本身是对的。

### 14.3 生态数据（2026-10-06）

- GitHub topic `dsh-plugin`：17780 个仓库
- npm 关键字 `dsh-plugin`：6922 个包
- 精选清单条目：约 4400 条（awesome-dsh-plugin）
- 头部市场：`dshmarket` 月下载 52.5 万
- 本机 DSH 运行时：`0.2.0-rc.2`（Electron 外壳 44.0.0）

### 14.4 本插件的差异化一句话（README 首段用）

> **DSH 从不删东西，所以这里总会涨。** `dsh-disk-doctor` 把 DSH 的空间构成摊开给你看：每个 GB 从哪来、哪些是可再生的、哪些是你的会话内容 —— 然后在你能回滚的前提下帮你清理。

---

### 14.5 实现期验证到的关键事实（2026-10-06）

- **asar 头部是双重 pickle 嵌套**：偏移 0 = 常量 4，偏移 4 = headerSize，偏移 8 = JSON 长度，JSON 从偏移 12 开始。详见 14.2 的更正。
- **`projectKey()` 的精确算法**（会话目录命名）已复刻进 `lib/targets.js`，所以会话能标注真实工作区标题与日期。该变换**有损**（分隔符与字面 `-` 无法区分），只能由真实路径正向算键，**不能反向猜路径**。
- **pnpm profile 的符号链接农场是计数陷阱**：`profiles/node_modules/<pkg>` 大量是指向 `%APPDATA%\npm\node_modules\@deepseek-ai\dsh\...` 的链接，连 `@deepseek-ai/dsh` 本身也是链接。跟随它们会**同时越界和重复计数**（同一批字节经链接、经真实目录各算一次）。默认不跟随链接后，本机总计从虚高的 584.9 MB 回到真实的 735 MB，扫描从 16.3 秒降到 1.07 秒。
- **`ToolRuntime` 依赖 `systemPrompt` 服务**：`static inject = ["systemPrompt"]`；缺它服务不启动，`ctx.tools` 永不出现（本地复现时会卡在"context 未 ready"）。
- **注册表公开派发入口的输入字段是 `arguments` 而不是 `args`**：`ctx.tools.execute({ name, arguments, callId, signal })`。传 `args` 会报 "tool execution arguments must be losslessly JSON-serializable"（因为 `arguments` 是 undefined）。
- **cordis 自己会解析插件导出的 `Config`**，把 volatile 字段装盒后交给 `apply`（已在真实 cordis 上断言）。
- **设置页只认 volatile 字段**：见 6.5 修订。这是本节最容易被下个会话重新踩中的一点。
- **「展开子目录」这一类漏账出现过两次**：`dsh-runtimes/<runtime>/` 的 `dependencies/` 兄弟文件，以及 `storages/session_projcache/` 的 `sessions/` 兄弟文件。这两处所在目录整体都是被 `other` 剪掉的已覆盖根，所以在那里丢掉的文件**没有任何类别能兜住**——兜底类别恰恰救不回来。第一处是"和 PowerShell 对不上 1 个文件"查出来的；第二处是按同型排查发现的（本机恰好没有这种文件，属潜在缺陷）。现已在 `test/scan.test.mjs` 增加**通用划分性质测试**：对每个类别的每个根，断言"根下可达文件集合"与"各条目覆盖文件集合"完全相等且互不重叠，一旦破坏就直接报出具体文件路径。教训：**类别内的「展开」必须仍然是对该根的划分，不能丢掉任何子项**。
- **DSH 浏览器半边的契约（`dsh-client-modules`）**：包在 `package.json` 里声明 `dsh.client`（`platform: "web"` 必填且必须是字符串；`inject` / `external` / `immediately` 可选），并让 `exports["./client"]` 指向 bundle——宿主按该导出路径读文件，经 `/plugins` 路由以**带 `rev` 的 URL** 提供（未登记的 URL 一律 404，所以不能手工拼 URL 验证）。启动时**严格校验** `dsh.client`，声明不合法会直接激活失败。
  - 基线模块表（React、Cordis、静态 UI 库）已覆盖 `react` 与 `@deepseek-ai/dsh-client-ui-primitives` 这类请求，所以它们**直接 `require` 即可，不要写进 `dsh.client.inject`**（官方 `ui-settings-*` 页面就是这么做的）；`inject` 只列你依赖其**服务或插槽**的包（本插件：locale / ui-settings / ui-plugin-manager）。
  - bundle 用的**不是 ESM**，而是 web 客户端自己的格式 `window.__ModuleLoader__.load({ id, factory: (require) => module.exports })`，所以可以手写、零构建（用 `react.createElement` 代替 JSX）。
- **`require()` 的解析与 `inject` 的容错不对称**（`dsh-client-modules` 的浏览器半边）：`require(spec)` 只认三类——平台种子表、已物化模块、已注册 factory；**都不是就抛错**（约 line 705，报 "build-time externals drift"）。而 `row.inject` 里的包名只在 boot graph 里查到才等待，**查不到就静默跳过**（约 line 656）。所以：把基线库写进 `inject` 不会报错、只是无意义；但把**非基线**库漏在 `external` 之外则会硬失败。判断依据是官方页面的清单——已发布的 `ui-settings-shell` 直接 `require("@deepseek-ai/dsh-client-ui-primitives")` 且**没有**声明任何 `external`，因此该库必在平台种子表内，本插件照做即安全。种子表本身由 shell 注入页面（`window.__DSH_BOOT__` 一带），**没法从包里静态查到**，只能这样反证。
- **全局 `dsh` CLI 与桌面应用是两套安装**：`dsh --profile desktop --dump-config` 在本机直接失败——它解析不了 profile 里列出的官方 bundle（如 `@deepseek-ai/dsh-experimental-auto-review`），那些只存在于应用自己的安装目录（`E:\dsh1\resources\app.asar`）。所以**不要用 CLI 检查组合后的 profile 树**（它是"另装了一份 dsh"）。`dsh plugin add` 仍然可用，因为它只操作 profile 目录、与安装位置无关——本插件的安装正是这样完成的，且应用随后成功热加载。
- **`dsh plugin` 要求 `pnpm` 在 `PATH` 上**：CLI 的 plugin 命令是把参数转发给 profile 目录里的 pnpm，而运行时自带的 pnpm 只有 `.mjs` 入口、没有 `.cmd` 转接文件，所以在普通 shell 里会直接报 `'pnpm' is not recognized`。用一个临时转接把运行时的 node + pnpm 接到 `PATH` 即可；只读的 `dsh plugin --profile desktop list` 可在不安装任何东西的前提下验证这条路是通的（已在 11.7.0 上实测通过）。写法见 `TRIAL-INSTALL.md`。

---

*本文件由 2026-10-06 的调研会话产出；如需修订，直接改本文件并在下方记录变更。*

## 变更记录

| 日期 | 变更 |
|---|---|
| 2026-10-06 | 初稿：定位、调研证据、v0.1 只读体检范围、实现计划、发布策略 |
| 2026-10-06 | 实现期修订：**更正 6.5 的设置页前提**（只有 `.volatile()` 字段会被投影，普通字段只能在 Cordis patch 里改）并同步 6.1 / 7.1；更正 14.2 的 asar 头部读法；§11 逐条记录验收实测结果；§13 补上全部结论；新增 14.5 实现期事实；状态改为"已实现并验证"。代码见 `lib/`、`test/`，验证方式见 README 的开发一节 |
| 2026-10-06 | 与 PowerShell 交叉比对时查出并修复一处真实漏账：`dsh-runtimes/<runtime>/` 中与 `dependencies/` 平级的文件未被任何类别统计（`other` 因该子树是已覆盖根而剪掉，兜底失效）。修复后文件集合与字节总数与 PowerShell 完全一致；新增回归测试，§14.5 记录该陷阱 |
| 2026-10-06 | 按同型排查出第二处潜在漏账：`storages/session_projcache/` 中与 `sessions/` 平级的文件同样不被统计（本机恰好没有这种文件）。已修复；并新增**通用划分性质测试**（每个类别的每个根：根下可达文件集合 == 各条目覆盖文件集合，且互不重叠），该类缺陷从此由性质测试兜住。该测试已用"故意改回旧实现"验证过确实会失败并指名文件 |
| 2026-10-06 | 补充本地试装的可执行步骤：新增 `TRIAL-INSTALL.md`（pnpm 转接写法、安装命令、重启后的三点验证、回退命令），并更正 README 里缺少 `--profile` 的安装命令。已用只读的 `dsh plugin --profile desktop list` 实测该路线可用（运行时自带 pnpm 11.7.0） |
| 2026-10-06 | 补上 §12.2 的能力声明：按已发布插件 `dsh-cost-meter@1.8.12` 的真实清单形状，加入 `dsh.compatibility`（含**只写实测版本**的 `dshReleases`）与 `dshhub`（`permissions.network` 为空数组、`surfaces: ["host"]`、`schemaVersion: 1`）。新增测试把该声明与代码绑定，声明与实现不符即失败 |
| 2026-10-06 | 试装实测完成，并**第二次更正 6.5**：volatile 只让字段「有资格」进表单，本版本没有任何客户端按 schema 生成设置页，故 host-only 插件没有设置界面。§11 相应改为「试装成功 + 工具可用」已达成、「设置页」一项确认在无前端前提下无法达成，并记下与 §6.1 的矛盾及后续选项。README 中「配置项会出现在设置表单里」的错误说法已更正 |
| 2026-10-06 | 用户选择补客户端半边：新增 `client/client.js`（零构建，web 客户端模块格式 + `react.createElement`），经 `plugins.bundle.config` 提供 5 字段设置页；`excludeGlobs`/`followSymlinks` 用自定义 spec 承载。§6.1 的「不写任何前端」明确放弃，`dshhub.surfaces` 改为 `["host","web"]`，§11 设置页一项改为已实现（视觉确认待用户）。新增 `test/client.test.mjs`（12 项）并把安全断言扩展到两个半边 |
| 2026-10-06 | 客户端半边落地后补齐浏览器父边契约（§14.5）：`dsh.client` 的严格校验、`/plugins` 带 rev 路由、基线模块表、以及 `inject` 只列服务提供者的规则。据此**修正**了 `dsh.client.inject`——原先误把 `@deepseek-ai/dsh-client-ui-primitives` 列进去，而官方页面是直接 require 的；已改为与官方一致的三个服务包。全部 52 项测试通过；浏览器内的视觉确认仍待用户 |
| 2026-10-06 | 复核浏览器半边契约的容错差异：`require()` 缺失即硬失败，而 `inject` 里查不到的包名被静默跳过——因此上一轮把 `ui-primitives` 移出 `inject` 是「对齐官方写法」而非修复故障；同时确认基线与 `external` 的正确划分依据来自已发布官方页面的清单。记入 §14.5 |
| 2026-10-06 | 修正浏览器半边的插槽注册策略：原先照搬官方 `plugins.item` 的 `whileServed` 门控，改为与 `dshmarket` 对 `plugins.bundle.config` 一致的**无条件注册**——门控会把「宿主未提供命名空间」变成整页消失；现在表单自报 `available: false`，可诊断。README/§6.5 同步更正，客户端测试增至 13 项 |
| 2026-10-06 | 记入一个排查陷阱：本机全局 `dsh` CLI 与桌面应用是**两套安装**，`--dump-config` 会因解析不了官方 bundle 而失败，不能用来检查 profile 组合树（§14.5）。TRIAL-INSTALL.md 增补「表单没出现时」的四步分层排查（插件列表的同步失败 → 浏览器控制台 → 空页面 → 不可用），并说明为何 `--dump-config` 不适用 |
| 2026-10-06 | **v0.1 全部验收通过（含浏览器确认）**：用户重启 DSH 后，`dsh-disk-doctor` 的插件页面上出现 5 个配置字段，设置页一项由「无法达成」转为「已达成」。宿主半边亦在重启后实测可用。全部 53 项测试通过 |
| 2026-10-06 | **改造为面向普通人的可视化产品**（用户反馈原版只有工程师看得懂）：新增右侧栏**常驻面板** `client/client.js` 中的 `DiskPanel`（分类横条图 + 点击展开明细 + 重新统计），宿主侧新增**只读本地路由** `lib/serve.js`（`GET /dsh-disk-doctor/report`）供面板取数；面板与设置页文案全部改写为大白话（如「要检查哪个文件夹」「每类最多列出几条」），技术性字段收进「高级选项」折叠区；分类名改为「聊天记录 / 安装的插件 / 临时文件」等，并各自附一句「删了会怎样」；新增 `USAGE.md`（中英）面向普通人，含**把插件给别人的三种安装方式**。安全断言细化为「无对外网络访问」——浏览器半边对本机路由的相对 fetch 不算联网。测试 65 项全过 |
| 2026-10-06 | 补上**宿主→面板契约测试**（`test/client.test.mjs` 的 `host to panel contract` 段）：直接调用真实的 `lib/serve.js` 路由、拿到真实 JSON、喂给真实的 `renderPanelBody` 渲染，断言 1) 宿主输出含面板读取的每个字段；2) 面板能渲染真实输出且没有缺词条；3) 宿主可能产出的**每个分类 id** 在中英词典里都有名字。这补上了原先的漏洞——客户端测试此前用的是手写的假报告，宿主改了字段名不会有人发现。测试总数 68 项，套件结束后 TEMP 零残留 |
| 2026-10-06 | 自查发现两处自身问题并修复：(1) **自动打开面板这一功能其实没被测到**——原断言只证明"不是同步打开"，等于什么都没验证；现用 setTimeout 桩真正捕获延迟回调并断言 `openTab(kind)` 被调用，另补两条：会话内已关过则不重开、存储被拒（getItem 抛异常）时不崩。(2) **USAGE.md 关于自动打开的说明是错的**——sessionStorage 在同标签页刷新后仍然存在，所以关掉后刷新并不会重开；已改为"同标签页关掉后不再自动弹，新标签页会再开一次，想手动打开点侧栏的 + 号"。测试 70 项，TEMP 零残留 |
| 2026-10-06 | **用户实机反馈后的第一轮修正**（共 5 项）：(1)【安全审计】用户要求排查仓库是否含密码/token/隐私——结论干净：全仓唯一匹配是解包到 `.reference/` 的官方源码里的 `apiKey: "API Key"` 界面文案（该目录已 gitignore，`git check-ignore` 复核过），插件内搜不到真实用户名，`npm files` 只含 lib/client/文档。并**把结论写成测试**：新增「宿主半边只读一个文件且绝不碰凭据库」断言（`readFileSync` 全包恰好 1 处、指向 workspace.json；源码不得出现 credentials/.netrc/id_rsa/.env）。(2) **修正一处真的说错了的话**：原「113 MB 可以安全清理」是错的——`regenerable`（技术上可重建，含 109 MB 插件文件）被当成了「随便删都安全」。普通人照做会删掉插件导致 DSH 起不来。改为按 `safety` 分成三个**互不重叠、相加等于总数**的桶（safe/care/keep），面板与报告都改为「4.0 MB 可以安全清理（来自…）／109 MB 需要正确操作才能省下／624 MB 请不要动」，并加测试断言三桶之和等于总数。(3) **「其他 347 MB」查明是 `~/.dsh/electron`**——DSH 自己的程序本体，不是无法分类的垃圾。新增 `runtime-app` 分类（safety=keep）并给它起了人话名字；「其他」从 347.4 MB 降到 0.1 MB。(4) 每类新增 `safety: safe|care|keep` 三级（同步进工具 output schema 的 enum，否则校验会拒绝），面板显示彩色圆点。(5) **补上统计范围说明**——用户问「统计完全吗」，诚实答案是**不完全**：只覆盖 `~/.dsh` 与临时目录，不含程序安装目录（如 `E:\dsh1`）。面板底部与 USAGE.md 都写明范围，「DSH 一共占了」改为「DSH 的数据占了」，避免暗示它统计了整个 DSH。测试 74 项 |
| 2026-10-06 | 新增三条数据模型不变量测试：每个分类的 safety 必须落在 schema enum 内；safe+care+keep 三桶之和必须等于 totals.bytes（防止将来新增分类时漏算或重复计算）；`runtime-app` 必须存在且 safety 为 keep（把「其他 347MB」那个真实回归钉住） |
| 2026-10-07 | **改造为「三个区并排」的报告 + 路径全自动探测**：(1) 报告分成 **`data`（数据文件夹）/ `app`（DSH 程序）/ `cache`（系统缓存）** 三个区，**各区独立给总数、永不相加**，也不再打印任何「总计」；旧的「头部总数」明确就是 data 区，面板文案改为「DSH 的数据占了」。不相加的理由：pnpm 内容仓库里放的是插件 `node_modules` 硬链接过去的真实文件，相加会把同一批物理字节算两遍——`pnpm-store` 因此新增 `overlapBytes`（**按 inode 量**，本机 112 MB 中约 109 MB 与 data 区重叠），cache 区也用文字写明这一点。本机实测 data 735 MB / app 1270 MB / cache 126 MB。(2) **路径全部自动选**：数据目录跟随 `DSH_HOME`（与宿主一致，取不到回落 `~/.dsh`）；程序安装目录由运行中的可执行文件探测（`process.execPath`，后备 `process.resourcesPath` 与 `DSH_DESKTOP_NODE_EXECUTABLE`），且**必须真的存在 `resources/app.asar` 才认**，所以无头 `node` 部署老实报「没找到」；**本次还查出并计入第二份安装**——npm 全局安装的 DSH（本机 254.8 MB，`detectNpmGlobalDsh`，只认真正含 `package.json` 的目录），它让 app 区比 `E:\dsh1` 大出约 255 MB；两个系统缓存按 `%APPDATA%` / `%LOCALAPPDATA%` 探测（另有 `.config` 与 `Library/Application Support` 回落）。探测不到时 app 区用大白话说明；新增 `appDir` 设置项可手动覆盖，报告里标成「来自设置」。(3) 新增模块 **`lib/locate.js`**：环境、可执行文件路径与文件系统探针全部可注入，规则因此能在不依赖本机的前提下测试；新增 `test/locate.test.mjs`。(4) **链接安装的插件不再从报告里消失**：目标在扫描范围之外的单列一节（写出真实目标路径与真实大小），测量有**每个根与整体双重预算**，渲染文档最多 10 行，撞上限的写成「至少 <size>」；反过来，**目标本身已被覆盖根包含的不再单列**（那些字节已经算在所在区里，本机 512 个链接中有 510 个指向 npm 那份安装，改用一行 warning 说明）。(5) 类别变更：新增 `app-install`（区 app、keep）、`npm-global-dsh`（区 app、keep）、`chromium-data`（区 cache、care）、`pnpm-store`（区 cache、care、带重叠探针）；`~/.dsh/electron` 那条由「DSH 程序本体」改名为 **「Electron 运行文件」**（它是整套解包 Electron，旧名会与新的程序区撞车）；每个类别新增 `area` 与 `overlapBytes` 字段，JSON 契约 `dsh-disk-doctor/report@1` **增量**扩展出 `areas`、`linkInstalls`、`capabilities`，工具的 `disk_report` 返回值同步。(6) 设置页现在渲染宿主声明的**全部 8 个字段**（3 个明面 + 5 个高级选项），见 §6.5 第四次修订；新增「打开文件夹」能力，权限拆成**总开关 `allowOpenFolder` + 敏感位置开关 `allowOpenFolderSensitive`** 两道，宿主按扫描真正覆盖的根做包含判断（取最具体的覆盖根）并拒绝其余路径，路由只接受 POST，文件只定位到所在文件夹。(7) 遍历改为并行（16 个子目录 + 64 个 `lstat` 并发），本机三个区全量约 5～6 秒（其中 npm 那份安装约 3.3 万个文件）；测试总数 **137 项**（`locate` 18 / `scan` 39 / `plugin` 36 / `client` 44，含新增的 `test/locate.test.mjs`） |
| 2026-10-07 | **用户实机反馈后的第二轮修正（打开文件夹的默认值与控件）**：(1) **`allowOpenFolder` 默认改为 `true`**——用户当初的要求就是「只把中等和高的两档默认关掉」，绿色档应当开箱可用；`allowOpenFolderSensitive` 仍默认 `false`。总开关的定位因此变成**急停开关**：关掉 = 所有「打开」按钮置灰 + 宿主以 `disabled` 拒绝；🟠⚪ 两档仍需要第二道独立同意。见 §6.5 第五次修订。(2) **两个权限在设置页上改成开关（switch）**，不再是显示字面量 `false`、要用户自己打成 `true` 的文本框（用户的原话抱怨正是这一点）；`excludeGlobs`（逗号列表）与 `followSymlinks` 仍由文本承载。开关带标签、提示行，以及**被改过之后才出现**的「恢复默认」；暂存值仍走原来的文本编码，所以写进 profile patch 的内容一字未变。(3) 新增**颜色说明**（`colorHelpTitle` / `color_*`）：同一份说明渲染在两处——面板底部、范围说明的上方（紧凑模式下隐藏），以及设置页「高级选项」里两个开关的正下方，三行分别对应 🟢/🟠/⚪，复用行上同一组彩色圆点与 `level_*` 文案。(4) **修掉「默认值只写在 schema 里」的隐患**：`normalizeConfig` 改用 `plainBoolean(value, fallback)` 读三个布尔字段，缺字段时回落到 schema 声明的默认值——否则直接归一化裸配置对象的路径会把 `undefined` 读成 `false`，对 `allowOpenFolder` 恰好与 promise 相反（面板探针就是这么发现的）。改动经 `current()` 闭包在**下一次请求**即生效，工具与两条路由都无需重启。(5) 测试总数 **146 项**（`locate` 18 / `scan` 39 / `plugin` 39 / `client` 50），新增用例钉住开关渲染、主开关默认值、恢复默认控件、两处颜色说明，以及没有宿主 schema 时的布尔默认值 |
| 2026-10-07 | **清理功能的前半：预演（`L2a`，只列清单、不动手）**：(1) 新增 `lib/cleanup.js`：`planCleanup()` 跑一次**只读**扫描（只限 🟢 四个安全类别，条目上限 `PREVIEW_ITEM_LIMIT = 500`，所以能列**全部**而不是报告里的 Top N），返回 `"schema": "dsh-disk-doctor/cleanup@1"` 的计划——`dryRun: true`、`destination`（`<dshHome>/disk-doctor/quarantine/<YYYYMMDD-HHMMSS>`，**只算不建**）、`items[]`、`skipped[]`、`totalBytes` / `totalFiles` / `itemCount`、`truncated`、`eligible[]`、`refused[]`（其余每个类别连同它的 `safety`）、`warnings[]`。**模块里没有移动、复制、删除或任何写入**——这是本里程碑刻意规定的性质，不是「施工中的阶段」。(2) **新鲜度规则**：`RECENT_USE_MS = 60 * 60 * 1000`，条目内部最新文件在一小时内被碰过就跳过（`reason: 'recent'`），完全无法检查的同样跳过；判断用的是**条目内部最新的 mtime**，不是目录自己的时间戳（进程持续往里写时目录 mtime 不动）。为此 `scan` 给每个 `topItems` 条目新增 `mtimeMs`，并把它加进工具 output schema 的**必填**字段。(3) 新增只读路由 `GET /dsh-disk-doctor/cleanup`（`CLEANUP_ROUTE` / `registerCleanupRoute`），只接受 GET / HEAD，其他动词一律 405；它是纯读取，所以不需要二次确认，也不需要任何权限开关。(4) 面板新增两个方框（在三个区之下、颜色说明之上）：「清理（预演）」（绿色档总量及来源、「看看会移动什么」→「重新列一次」、最多 12 条按大小倒序且每条带自己的「打开」、条目数与总量、落点、清单 warnings 原文，以及那句「这一步只列清单，**不会移动任何文件**」）与「想省更多空间？这样做才对」（点出最大的插件并指向插件页、pnpm 仓库的重叠量与 `pnpm store prune`、以及绝对不能动的清单）。**面板里没有任何能移动或删除文件的控件。** 见 §6.6。(5) 本机实测（02:21）：预演约 **45 ms**，计划 **8 项 / 3,854.8 KB**（插件市场缓存 17.8 KB、安装日志 3.7 KB，其余是安静够久的临时溢出），跳过 **466,243 字节**（太新），落点 `<dshHome>\disk-doctor\quarantine\<批次时间戳>` 且 `exists=false`；绿色目录里全部 144 个被监视条目加隔离目录父目录的指纹，前后**逐字节一致**。(6) **明确未做**：真正移动、落盘清单（manifest）、一键撤销，以及任何会动手的面板控件——那是 `L2b`，等用户先看过这份清单再决定。测试总数 **160 项**（`locate` 18 / `scan` 46 / `plugin` 40 / `client` 56） |
| 2026-10-07 | **用户看面板后的第三轮修正（图例的名字与灰按钮）**：(1) **名称/路径切换**：在**「按插件」「按聊天记录」**两张图的图例右上角加了一个小胶囊按钮「显示完整路径 / 显示名称」，它改的就是 ⚙ 里那个 `showPaths` 偏好（`ui.onPrefs`），所以两个控件不可能不一致；**「总览」画的是分类名，没有可切换的东西，因此刻意不显示这个按钮**（`nameChartOptions()` 只传给那两张 name 图）。(2) **聊天记录改用真实工作区名**：以前解的是会话**目录**名，于是标签长成 `E\disk-doctor · session-`（没有真名，而且同一工作区的每个会话都一样）。现在标签直接取宿主**已经从 DSH 自己的工作区索引里读到的**工作区标题（它在每个会话条目的 `note` 里，形如 `<日期> · <工作区标题>`），丢掉日期、拼上一小段会话编号——本机实测是 `disk-doctor · 8c4e6580`、`disk-doctor · 64875ca0`、`disk-doctor · 21225215`。编号会先剥掉 `session-` 前缀再截断（会话目录是 UUID，直接截原串会让每一行都以 `session-` 开头）；没有 `note`（没有工作区索引）时回落到旧的解码形式，那种形式无法恢复编码时丢掉的冒号。可展开的列表行用的是同一套名字。(3) **插件保持包名，并把它记成一条刻意的限制**：更好看的 `displayName` 在插件自己的 `package.json` 里，去读它就会破坏本插件唯一承诺的文件访问（只打开 `storages/workspace.json`，由源码审计测试断言），所以图例继续显示 `dsh-image-gen`、`@scope/pkg`；用户明确接受了这一点。(4) **整图按钮全灰时说明原因**：三个安全档把插件行（🟠）与会话行（⚪）都放在敏感位置开关之后，所以两张 name 图一开始每个「打开」按钮都是灰的。图例右上角现在会带上那句话——只差敏感开关时是「要在设置里打开『允许打开需谨慎处理的位置』才能点开」，总开关被关掉时是「要打开文件夹，得先去设置里把『允许打开文件夹』打开」——按钮一旦能用就消失（`gatedHint: canOpen(owner) ? null : openReason(owner)`）。这正是用户报告「按插件和聊天记录的打开按钮全是灰色的」的答案。(5) 测试总数 **164 项**（`locate` 18 / `scan` 46 / `plugin` 40 / `client` 60；**随后一轮再加 1 项，现为 165 项**），新增用例钉住名称/路径切换（两张 name 图有、总览没有、改的是同一个偏好、标签随状态翻转）、真实工作区名加编号（含 `session-<uuid>` → `64875ca0`）、回落标签，以及三种状态下的说明句（缺敏感开关 / 缺总开关 / 全部允许）；图相关测试改为按**类名**定位 graphic / legend / head，而不是按子节点下标，新增元素不再把它们弄坏 |
| 2026-10-07 | **第四轮修正（第二步的仪式写进面板；隐私与「完整路径」两条结案）**：(1) **清理框把第二步会怎么做写下来**：在摘要行与按钮之后、以及有计划时的清单与注意事项之后，**始终显示**（不藏在按钮后面）一个标题块「**第二步会这样做（还没做）**」，三行是 ① 先移动到回收站文件夹，不是真删；② 你重启 DSH、用一会儿，确认一切正常；③ 有问题就一键撤销、按清单移回原处；确认无碍再自己清空那个文件夹。其下仍是那句「这一步只列清单，**不会移动任何文件**。」相应的 `cleanupDryRun` 精简为这一句（原先跟在后面的「真正移动 + 一键撤销还没做」由新标题块承担）。英文标题 "What the second step would do (not built)"。这是用户的明确要求：把「隔离 → 重启观察 → 一键撤销」这套流程写在他能读到的地方，而标题里的「还没做」保证文档不会被读成「清理按钮已经能用」。见 §6.6。(2) **隐私取舍结案**：用户 2026-10-07 说「不脱敏也可以实施」。**面板路由保持 `redact: false`**（路径要能复制、要能直接打开文件位置），而**凡是会离开这台机器的输出继续脱敏**：工具返回值走 `redactDeep`，Markdown 与 JSON 报告走 `redactHome` / `toJsonReport`，主目录一律显示为 `~`。README 能力声明新增一行、USAGE 中英各新增一条 FAQ、§12.2 记为已确认的决策。(3) **「完整路径」结案**：用户确认「完整路径的问题不是解决了吗，已经可以直接复制和打开文件位置了」，因此**不再计划**任何「展开查看完整路径」入口——复制拿到真实路径、打开跳到文件位置，已经覆盖需求；§12.2 记入。(4) 测试总数 **165 项**（`locate` 18 / `scan` 46 / `plugin` 40 / `client` 61），新增的 client 用例钉住第二步那段文案 |
| 2026-10-07 | **清理功能的后半落地：移动 + 撤销（`L2b` 完成，TODO 第 2 项收尾）**：(1) **移动**（`lib/cleanup.js` 的 `performCleanup`）：动手前把计划**重新画一遍**（过期的条目掉出并记进 `skippedRecent`），逐项再校验归属、算目标 `<quarantine>/<时间戳>/<分类 id>/<根下相对布局>`、`mkdir` + `fs.renameSync`（**唯一**的改动调用，不复制、不删除），名字被占用时加 `-2`/`-3` 后缀（两个 profile 都有 `.dsh-market`），**每移动一项立刻重写 `manifest.json`**，所以中断也留下与现实一致的记录；空计划**一个文件夹都不建**（`nothing-to-move`）。(2) **撤销**（`undoCleanup`）：批次 id 必须是 `YYYYMMDD-HHMMSS`，每个 `target` 必须在批次内、每个 `original` 必须在清理可拥有的根内——**手改的清单无法把文件挪去别处**；原位置重新出现的一律 `occupied` **拒绝、绝不覆盖**；按倒序恢复，状态落 `undone`/`partly-undone`。`listQuarantine()` 按新的在前列批次，`readManifest()` 导出。(3) **归属规则**（`targets.js` 的 `ownsCleanupPath`）：**与路径此刻是否存在无关**——整目录条目自己就是根、一移动就不存在了；按形状判：两种 profile 叶子（`<profiles>/<存在的 profile>/.dsh-market`、`…/.plugin-manager/logs`）、目录前缀（`<dshHome>/plugin-packages`）、temp spill 形状（`<tempDir>/dsh-*`）。用 `resolveTargets` 的根列表会把用户自己的文件判成「不能放回去」——**真机探针抓出来的真 bug**。🟠⚪ 永远不被认可。(4) **新增 `allowCleanup`（默认 `false`）**：设置页变 **9 个字段**（3 明面 + 6 高级，其中 **3 个开关**；**下一行已推翻这条**——`allowCleanup` 随后搬进面板齿轮，页面回到 8 个字段 / 2 个开关），`capabilities` 多出 `cleanup`；清理路由变成 GET（计划 + `batches`）/ `POST ?action=move` / `POST ?action=undo&id=`，两个 POST 在开关关闭时 **403 `disabled`**，其他动词 405，且都经 `current()` 读实时配置（无需重启）；面板第一次点击只询问、第二次才执行（**注：这半句当时是坏的——按钮在询问期间被禁用，第一下根本收不到点击；见下一行**）。**没有任何删除动作**，清空隔离目录是用户自己的事。(5) **审计升级**：整包禁止 `unlink`/`unlinkSync`/`rmdir`/`rmdirSync`/`rm(`/`rmSync`/`trashItem`/`Remove-Item`/`shutil.rmtree`；`renameSync` 只允许出现在 `lib/cleanup.js` 一个文件；`readFileSync` 从恰好 1 处放宽到恰好 **2 处**（DSH 的工作区索引 + 本插件自己的隔离清单），两处都有名有姓。(6) **真机证据**：对已死掉的临时溢出目录实做一次移动——**6 项 / 3,833.3 KB**（`bytes: 3925285`、`files: 10`），原位置全空、目标都在 `quarantine/<ts>/temp-spill/…`、**0 失败**；撤销把 6 项全部移回、同样 **0 失败**，事后「清理可涉及路径」指纹**逐字节一致**，清单留 `status: 'undone'`；隔离目录里留下的批次只剩 `manifest.json` 与空分类目录，可自行删除。说明块标题也从「第二步会这样做（还没做）」改为「**第二步会这样做**」。见 §6.6。(7) 测试总数 **176 项**（`locate` 18 / `scan` 55 / `plugin` 40 / `client` 63），其中 8 项专测移动与撤销：只移动该移动的、被拒的档位一动不动、空计划不建目录、清单内容、批次新的在前、精确撤销、原位置被占时拒绝而非覆盖、被篡改的清单既出不了批次也出不了安全根 |
| 2026-10-07 | **修掉一个真 bug（两次点击）、失败不再静默、清理开关搬进面板齿轮**：(1) **真 bug，用户实测「点了完全没反应」**：移动按钮原先写成 `disabled: caps.cleanup !== true \|\| confirming !== true`，而浏览器**不会把点击送给 disabled 按钮**——第一下永远无法把 `confirming` 置真，确认行永远打不开，移动彻底不可达。现在 `disabled` 只看 `caps.cleanup`，询问期间**保持可点**：第一下把按钮文字换成「确定，移动」并弹出询问行（「确定移动这 N 项（共 X）吗？」＋「确定，移动」／「取消」），第二下（改过字的按钮，或询问行里的确认）才 POST；「取消」回到「移动到回收站」。**教训**：我自己的 client 测试把错误行为当成意图钉住了——它断言 `disabled === true` 并在注释里写「第一下只是询问」，断言的是**实现的形状**，不是**一次点击产生的行为**，所以实现错的时候测试跟着一起点头。现在改成正向断言：第一下之后 `confirming` 为真、按钮可用、询问行出现，第二下才发 POST。(2) **失败不再静默**：三种原因分别显示——`disabled`（权限没开）、404/405（**宿主还是旧版本（这个接口还不存在）——重启 DSH 之后再试一次**）、请求失败（**没能连上宿主，稍后再试**）。这对试装尤其重要：装完还没重启的人会读到一句能照做的说明，而不是一个死按钮。(3) **`allowCleanup` 从插件设置页搬进面板的 ⚙ 齿轮**（用户的明确要求），成为齿轮里的第 4 个控件（分隔线下面、三个外观偏好之后）；插件页面因此渲染 **8 个字段 / 2 个开关**，见 §6.5 第七次修订。它仍是**宿主设置**：经 `ctx.configForms.get(namespace)` 拿到**同一份共享 scope**，用 `SettingsFormModel` 暂存 + `save()` 写入，落盘与设置页保存完全等价，两个界面读到同一个值；齿轮显示宿主生效值，被 home patch 或命令行覆盖锁住时（`scope.writable === false`）开关置灰并提示「这个设置被上层配置锁定了，改不了」；改完在下一次请求即生效，无需重启。(4) 测试总数 **176 项**不变（`locate` 18 / `scan` 55 / `plugin` 40 / `client` 63）：同一个数字、不同的用例——移动按钮那条断言翻转，齿轮开关新增一条（写入确实到达假 scope，钉住第 9 个字段没有凭空消失）|
| 2026-10-07 | **发布前全仓审计与修复（面向「给别人用」）**：(1)【个人信息】实测记录里留着**真实 Windows 账户名**（`C:\Users\<真名>\…`），已换成 `<dshHome>\disk-doctor\quarantine\<批次时间戳>`；全包复查无邮箱/token/凭据/主机名，`npm pack` 白名单仍是 15 个文件（不含 `DESIGN.md`/`TODO.md`/`test/`）。(2)【测试的环境依赖，真 bug】`npm test` 下 plugin 套件必挂 1 项。真凶不是 `APPDATA`，而是 **`npm test` 自己注入的 `npm_config_prefix`**：`detectNpmGlobalDsh` 顺着它找到开发机真实的 npm 全局 DSH（254.8 MB），把它算进了 app 区（断言期望 4096，实得 267,186,507）。测试现在清掉这个变量——直接 `node --test` 之所以一直是 40/40，正是因为它没有这个变量。同时把 `npm test` 从 `&&` 串联改成**一条命令跑完四套**（`--import` + 显式文件列表），否则 plugin 一挂，client 的 63 项根本不跑；刻意不用自动发现，因为它会把 `test/stubs/*.mjs` 也当测试执行（181 vs 177）。(3)【安全加固，实测确认过】三条路由注册在 `webServer` 上，**不继承** Connection 给 `/api` 施加的浏览器信任栅栏。实测：带 `Origin: https://evil.example` 与 `sec-fetch-site: cross-site` 请求 `GET /dsh-disk-doctor/report` 返回 **200**（官方栅栏这里会 403）。现在每个 handler 先问 `connection.requestRejection(req)`（与官方 open-in-app 同一套写法），没有 Connection 服务的组合照旧跳过而不是 500。(4)【浏览器半边】`undo` 不检查 `response.ok`——400（没清单／已撤销／开关没开）会渲染成「有 0 项没能移回」，与宿主说的话正好相反，现在按宿主给的原因显示；三处未防护的宿主形状假设（`report.warnings`、`category.topItems`、`plan.items`）会抛渲染异常并卸载整棵 React 树，已加兜底；样式表补上 `data-plugin` / `data-plugin-css`，否则重载时旧 CSS 因 id 命中而不更新、还可能被别的插件 `claimStyles` 连带删除；英文词典里残留的中文档位名改成英文。(5)【文档口径】README 的「9 个配置项」改为「页面 8 个 + 面板齿轮第 9 个」；README 明确写出**尚未发布到 npm**（registry 查询：该名字未被占用）；「`0.1.x`–`0.2.x`」改为与清单一致的 `>=0.1.0-rc.2` 并注明只有 `0.2.0-rc.2` 实测过；`repository` 里那个 `github.com/<占位账号>/…` 的假地址**整个删掉**（不填假地址，npm 上该字段可选）；TRIAL-INSTALL 里写死的 `--profile desktop` 与开发机绝对路径换成占位符；USAGE 的「拷整个文件夹」改为列出真正需要拷的文件。(6) 测试总数 **177 项**（`locate` 18 / `scan` 55 / `plugin` 41 / `client` 63），新增 1 项钉住信任栅栏：跨站请求在三条路由上都被 403，且栅栏放行之后方法检查与包含规则仍然生效 |
| 2026-10-07 | **第三个安装的类别名缺失（面板显示了原始键名）**：`npm-global-dsh` 在宿主侧加进来时，两个客户端词典都没有补 `cat_npm_global_dsh`，于是 `name()` 落到键名上，面板直接显示 `cat_npm_global_dsh`（用户对着真实报告与真实中文文案渲染时才发现）。补上 `cat_npm_global_dsh: 'npm 全局安装的 DSH'` / `'DSH installed globally by npm'`。**测试教训（更值钱的那一半）**：专门管这件事的那条用例（「宿主能产出的每个分组在中英词典里都有名字」）手里是一份**手抄的类别 id 列表**，早已过期——它还列着十一个旧 id，从不提 `app-install` / `chromium-data` / `pnpm-store` / `npm-global-dsh`；现在这份列表**从宿主自己的 `CATEGORY_DEFS` 推导**（`import { CATEGORY_DEFS } from '../lib/targets.js'`），所以以后在宿主侧加类别，这条测试会直接失败，直到中英词典都给出名字。和按钮那次是同一种错：测试抄了一份实现，而不是钉住不变量。同一轮两处小清理：确认状态现在只有**一个「是」**（移动按钮自己改字）加一个「取消」，不再是两个一模一样的确认按钮；移动失败时也不再在错误下面多画一行绿色的「这次没有可移动的内容」。测试总数仍是 **176 项**——同一个数字，这条用例是被**加强**而不是新增 |
