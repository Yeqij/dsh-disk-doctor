# 设计文档

`dsh-disk-doctor` 回答一个 DSH 自己不提供答案的问题：**DeepSeek Harness 占了多少磁盘，
这些字节分别是谁的，哪些可以安全回收。**

本文记录设计本身——测量什么、如何判定、遵守哪些不变式、接受哪些限制。安装与用法见
[README.md](README.md)；面向普通用户的说明见 [USAGE.md](USAGE.md)。

---

## 1. 问题

DSH 从不删除任何东西：会话、投影缓存、运行环境、插件包都会留在数据目录里，因此占用只增不减。
而数据目录动辄数十万文件，用户既无法回答「这 700 MB 都是什么」，也无法判断「删掉哪个会坏」。

插件把这个问题拆成三个可以分别回答的子问题：

1. **构成** —— 按类别、按条目，空间都花在哪；
2. **归属** —— 哪些是 DSH 可以重建的产物，哪些是用户自己的内容；
3. **回收** —— 对可以安全回收的部分，如何在失败也能退回的前提下回收。

明确的非目标：不做「一键清理」，不读取文件内容，不访问网络，不动会话与程序本体。

---

## 2. 三个区，永不相加

占用被划成三个区，各自给出独立总数，**任何情况下都不相加**：

| 区 | 内容 | 为什么单独成区 |
|---|---|---|
| `data` | DSH 数据文件夹（`$DSH_HOME`）与会话临时目录 | 用户真正拥有的那部分 |
| `app` | DSH 程序本体：桌面应用安装目录 + npm 全局安装 | 归卸载程序管，不归插件管 |
| `cache` | DSH 会写入的系统缓存：桌面端用户数据、pnpm 内容仓库 | 位于 DSH 之外 |

不相加的原因是**物理字节重叠**：pnpm 内容仓库里存放的正是插件 `node_modules` 硬链接过去的
同一批文件。把三个区相加会把同一批字节算两遍。因此：

- 报告不打印任何「总计」，只给各区自己的数字；
- `pnpm-store` 类别额外提供 `overlapBytes`（按 `dev:ino` 在同一趟扫描中实测），
  用文字说明「其中约 N 与数据区是同一批文件」；
- 头部主数字明确标注为 `data` 区，措辞是「DSH 的数据占了」，而不是「DSH 一共占了」。

---

## 3. 路径探测（`lib/locate.js`）

三个位置无法从彼此推导出来，必须探测：

```text
数据目录      $DSH_HOME  →  ~/.dsh
程序安装      process.resourcesPath  →  $DSH_DESKTOP_NODE_EXECUTABLE  →  process.execPath
              （候选目录必须真的含有 resources/app.asar 等标记才算数）
桌面端用户数据  %APPDATA%  →  ~/.config  →  ~/Library/Application Support
pnpm 内容仓库  $PNPM_HOME  →  %LOCALAPPDATA%\pnpm  →  ~/.local/share/pnpm  →  ~/Library/pnpm
npm 全局 DSH   %APPDATA%\npm\node_modules  →  $npm_config_prefix  →  ~/.npm-global
              →  /usr/local/lib/node_modules  →  /usr/lib/node_modules
              （必须真的含有 package.json 才算数）
```

设计约束：

- **每个函数都对输入纯**：环境、可执行文件路径与文件系统探针均可注入，因此规则可以在不依赖
  运行机器的前提下测试。
- **探测不到就说探测不到**。无头 `node` 部署没有 `app.asar`，报告用一句话说明「没找到程序
  安装位置，这部分没有统计，可在设置里填写」，而不是猜一个目录。
- **`appDir` 可手工覆盖**，报告里标注为「来自设置」。

---

## 4. 类别表（`lib/targets.js`）

15 个类别分属三个区。每个类别声明：所属区、安全等级（`safe` / `care` / `keep`）、
是否可再生、根目录集合与条目枚举方式。

- **条目划分恰好一次**：各类别的根互不重叠；`other` 作为数据区兜底，并排除已被其他类别覆盖的根。
  因此类别总数是条目总数的直接求和，不存在重复计数。
- **安全等级是三个互不重叠的桶**，相加恰好等于该区总数：
  `safe + care + keep = total`。报告与面板的「可以安全清理 / 需要正确操作 / 请不要动」
  就来自这三个桶，不可能与明细矛盾。
- **会话标签取真实工作区标题**：只读 `storages/workspace.json` 一个文件，用 DSH 自己的
  `projectKey()` 算法（复刻自 `@deepseek-ai/dsh-session-persistence-jsonl` 0.2.0-rc.2）
  把会话目录映射回工作区；读不到时退回解码目录名。

---

## 5. 扫描（`lib/scan.js`）

- **只 stat，不 open**：全程不读取任何文件内容，只取大小与时间戳。
- **默认不跟随符号链接与 junction**，避免越界与重复计数；开启后按 `realpath` 去重。
- **并发**：64 个 `lstat`、16 个子目录同时在途；这是把「25 万文件」从数十秒压到数秒的关键。
- **失败不中断**：无权限、条目消失、循环链接都记录计数后跳过；不可读的路径逐条写进报告。
- **上限**：50 万个文件或 30 秒，先到者截断；截断时置 `truncated` 并在报告里写明。
- **链接安装的插件**：目标在扫描范围之外的（例如用 `dsh plugin add <本地路径>` 安装的插件）
  单独列出真实目标与真实大小，受每根 6 个、整体 24 个、3 万文件、3 秒的双重预算约束，
  且**不计入任何区的总数**。
- **硬链接**按 `dev:ino` 识别；pnpm 仓库类别的重叠字节在同一次扫描中测得。

---

## 6. 报告（`lib/report.js`）

同一份扫描结果有三种投影：

| 投影 | 去向 | 说明 |
|---|---|---|
| `renderSummary` | 对话 / 工具返回值 | 三个区各一段，带可清理构成的说明句 |
| `renderMarkdownFile` | `<reportDir>/disk-report-<时间戳>.md` | 完整人类可读报告，含每类 Top N |
| `toJsonReport` | 同名 `.json` | 稳定契约 `dsh-disk-doctor/report@1`，只做加法扩展 |

**脱敏**：凡是会离开这台机器的输出（工具返回值、Markdown、JSON）都把主目录替换成 `~`，
交给 `redactHome()` / `redactDeep()` 统一处理。唯一的例外是面板的本地路由——它在本机浏览器里
显示真实路径，因为用户要在那里复制路径、直接打开文件位置。

---

## 7. 清理：预演 → 移动 → 撤销（`lib/cleanup.js`）

三步模型，每一步都可以安全中断。

### 预演

- 运行一次**只读**扫描，只取 🟢 `safe` 四类；
- 条目上限 500，目的是能说「这就是全部」而不是只列出前缀；
- 新鲜度规则：条目内部最新文件在一小时内被改动过就跳过（`reason: 'recent'`）。
  判断依据是条目内部最新 `mtime`，不是目录自身时间戳——进程持续写入时目录 mtime 不动；
- 落点**只计算不创建**：`<dshHome>/disk-doctor/quarantine/<YYYYMMDD-HHMMSS>`。

### 移动

- 动手前重新跑一次预演，因此不会作用于过期清单；
- 逐项复核归属规则 `ownsCleanupPath()`，并校验目标落在批次内；
- 目标为 `<batch>/<categoryId>/<根下相对布局>`，重名时加 `-2`/`-3` 后缀；
- `fs.renameSync` 是**整个包唯一改动文件系统的调用**——不复制、不删除；
- **每移动一项就重写一次 `manifest.json`**，因此中途断电仍留下与磁盘一致的记录；
- 计划为空时**一个文件夹都不创建**。

### 撤销

- 批次 id 必须匹配 `YYYYMMDD-HHMMSS`；
- 每个 `target` 必须落在该批次内，每个 `original` 必须落在「清理可拥有」的根内——
  手改过的清单无法把文件挪去别处；
- 原位置已被占用时**拒绝覆盖**（`reason: 'occupied'`），该条目留在隔离区；
- 按倒序恢复（先子后父）；状态从 `moving` 走到 `moved` / `moved-with-failures`，
  撤销后为 `undone` / `partly-undone`。

### 归属规则

`ownsCleanupPath()` 的判断**与路径此刻是否存在无关**——整目录条目（`.dsh-market`、某个
`dsh-spill-*`）自己就是根，一移动它就不存在了。按形状判定：两种 profile 叶子、目录前缀、
临时溢出的形状规则。若改用「扫描当前的根列表」来判断，会把用户自己的文件判成「不能放回去」。

---

## 8. HTTP 表面（`lib/serve.js`）

三条 exact 路由，注册在宿主自己的 web 服务上；没有 web 服务时不注册，无头部署照常工作。

| 路由 | 方法 | 说明 |
|---|---|---|
| `/dsh-disk-doctor/report` | GET / HEAD | 与工具同源的 JSON，**不写文件** |
| `/dsh-disk-doctor/cleanup` | GET / HEAD、POST `?action=move|undo&id=` | 预演、移动、撤销；清理开关关闭时 403 `disabled` |
| `/dsh-disk-doctor/open` | POST | 在系统文件管理器里打开一个文件夹 |

安全设计：

- **`/open` 是唯一会启动外部进程的路由**，因此只接受 POST，并且只允许扫描真正覆盖到的根；
  🟢 档开箱可用，🟠 / ⚪ 档需要第二个默认关闭的开关；传入文件时打开其所在目录。
- **每条 handler 先询问宿主的浏览器信任栅栏**（`connection.requestRejection`）：
  直接注册在 `webServer` 上的裸路由不继承 `/api` 的 Host/Origin 校验与浏览器认证，
  而其中两条会真正动作（移动文件、弹文件管理器窗口）。没有 Connection 服务的组合跳过该检查，
  而不是返回 500。
- 三个 handler 都会重新读取实时配置，因此设置改动在下一次请求生效，无需重启。

---

## 9. 浏览器半边（`client/client.js`）

零构建：使用 web 客户端自己的模块格式（`window.__ModuleLoader__.load`）与
`react.createElement`，不依赖打包器。

- **右侧栏面板**：三个区并排，三个视图（总览 / 按插件 / 按聊天记录），每行可「打开」或「复制
  路径」；⚙ 里是三个外观偏好与清理开关。
- **设置页**：8 个字段经 `plugins.bundle.config` 插槽渲染；第 9 个（`allowCleanup`）
  刻意放在面板齿轮里，紧挨它管辖的按钮。
- **本地化**：中英词典经 `ctx.locale` 注册，分类名与界面文案都走词典。
- **渲染安全**：宿主返回的字符串一律作为 React 子节点或 `title` 属性，不使用
  `innerHTML` / `dangerouslySetInnerHTML`；样式表以 `data-plugin` / `data-plugin-css`
  标记归属。

---

## 10. 由测试钉住的不变式

1. **不删除**：源码中不出现 `unlink` / `rm` / `rmdir` / `trashItem`；`renameSync` 只允许出现在
   `lib/cleanup.js`。
2. **不联网**：两半代码中都不允许出现出站调用；清单声明 `network: []`。
3. **外部文件只读一个**：`storages/workspace.json`（外加本插件自己的 `manifest.json`）。
4. **唯一可写位置**：报告目录与 `<dshHome>/disk-doctor/quarantine`。
5. **预演不产生副作用**：跑完预演，隔离目录必须不存在。
6. **三桶相加等于总数**：`safe + care + keep = total`。
7. **每条路由先过信任栅栏**：跨站请求在三条路由上都被拒绝。
8. **三个区永不相加**：报告文本中不出现「总计」。

---

## 11. 限制

- 只在 Windows 上实测；macOS / Linux 的探测回落已实现但未验证。
- 三个区的数字不能相加，这是口径而非缺陷。
- 类别路径依赖 DSH `0.2.0-rc.2` 的目录布局；DSH 更换布局时对应类别会为空，并给出提示。
- 隔离目录需要用户自己清空——插件里没有删除功能，这是刻意的。
- 扫描有上限，撞上限时结果不完整，报告会写明。

---

## 12. 代码布局

```text
package.json       npm 清单（dsh.bundle / dsh.client 声明）
cordis.patch.yml   插入 profile 分层栈的 bundle patch
lib/
  index.js         插件入口：配置、工具注册、路由装配
  locate.js        路径探测（纯函数，探针可注入）
  targets.js       类别表、区定义、归属规则
  scan.js          并发遍历与聚合
  report.js        三种投影与脱敏
  serve.js         三条 HTTP 路由
  cleanup.js       预演、移动、撤销
client/
  client.js        浏览器半边（零构建）
test/              177 项测试（locate 18 / scan 55 / plugin 41 / client 63）
```

测试不需要 DSH 宿主：`@deepseek-ai/dsh-tools` 与 `schemastery` 由 `test/stubs/` 的解析钩子
替换，文件系统部分使用临时夹具。
