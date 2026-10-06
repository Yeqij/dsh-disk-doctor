# 使用说明（写给普通人）

English readers: see [English](#english) below.

---

## 这个插件是干什么的

它帮你看清楚一件事：**DSH 到底占了你多少硬盘、都占在哪。**

打开之后你会看到一张图，哪个最占地方一眼就知道。它还会告诉你哪些东西删了没关系、哪些删了就没了。

> ⚠️ **它从不删除任何东西，但可以「先搬走」。** 面板会告诉你「这 3.84 MB 可以安全清理」；如果你愿意，在**面板右上角的 ⚙ 齿轮**里打开「允许清理」并二次确认之后，它会把 🟢 档的文件夹**移动**到插件自己的回收站文件夹里（不是删除），再点一次「撤销」就能移回原处。清空那个文件夹始终是你自己的事——这个插件不会替你删。

---

## 怎么看

**打开右侧栏的「磁盘空间」**。装好之后它会**自动打开一次**；你在同一个标签页里把它关掉，就不会再自动弹出来（新开一个标签页或新窗口时会再自动开一次）。想再打开时，点侧栏标签条上的 **「+」**，选「磁盘空间」。

你会看到**三个方框**，从上到下分别是「DSH 数据」「DSH 程序」「系统缓存」：

```
──────────────────────────────
DSH 数据                          735 MB  ← DSH 的数据占了
8,903 个文件
( 3.84 MB 可以安全清理 )
（来自 临时文件 3.82 MB、插件市场缓存 17.8 KB、插件安装日志 3.7 KB）
还有 109 MB 需要正确操作才能省下——比如去卸载不用的插件，而不是手动删文件。
剩下的 622 MB 请不要动（里面是 DSH 程序本体、运行环境，还有你的对话）

[ 重新统计 ]

● 聊天记录            ██████     2.73 MB      [ 打开 ]
● DSH 自带的运行环境   ██████████ 272 MB       [ 打开 ]
● 安装的插件          ████       109 MB       [ 打开 ]

──────────────────────────────
DSH 程序                       1.24 GB
安装位置：E:\dsh1（自动找到）；npm 全局安装：~\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh；只读展示，不参与清理

● 程序安装目录        ██████████ 0.99 GB      [ 打开 ]
● npm 全局安装的 DSH   ███        0.25 GB      [ 打开 ]

──────────────────────────────
系统缓存                        126 MB
这些是 DSH 之外的位置，与上面的区不能相加：桌面端用户数据 …、pnpm 内容仓库 …
注意：其中约 109 MB 与「DSH 数据」里的插件文件是同一批物理文件（硬链接）…

● 桌面端用户数据      ██         13.9 MB      [ 打开 ]
● pnpm 内容仓库       ██████████ 112 MB       [ 打开 ]

──────────────────────────────
清理
可以安全清理 3.84 MB，来自 临时文件 3.82 MB、插件市场缓存 17.8 KB、插件安装日志 3.7 KB

[ 看看会移动什么 ]
会移动 8 项，共 3,854.8 KB
移动到：C:\Users\<你>\.dsh\disk-doctor\quarantine\20261007-022153
● 临时文件 dsh-spill-…        3,833 KB    [ 打开 ]
● 插件市场缓存                17.8 KB     [ 打开 ]
● 插件安装日志                3.7 KB      [ 打开 ]

[ 移动到回收站 ]      ← 没打开「允许清理」时，这个按钮是灰的
↓ 点一下（按钮自己改成「确定，移动」，下面多出一行问句）
[ 确定，移动 ]        ← 再点这一下才真的搬
确定移动这 8 项（共 3,854.8 KB）吗？   [ 确定，移动 ]   [ 取消 ]

已移动到回收站：6 项，共 3,833.3 KB
接下来：重启 DSH、用一会儿。有问题就点「撤销」，它会按清单把东西移回原处。
[ 撤销 ]

回收站里的批次
● 20261007-030514：6 项，共 3,833.3 KB    [ 撤销 ]
确认一切正常后，自己清空那个回收站文件夹就行——这个插件不会替你删任何东西。

第二步会这样做
① 先移动到回收站文件夹，不是真删
② 你重启 DSH、用一会儿，确认一切正常
③ 有问题就一键撤销、按清单移回原处；确认无碍再自己清空那个文件夹

──────────────────────────────
想省更多空间？这样做才对
最大的插件是 <某插件>（62.3 MB）——去插件页卸载不用的插件，别手动删文件
pnpm 仓库 112 MB，其中约 109 MB 与插件是同一批物理文件；要用 pnpm store prune 才能真省下来（删插件目录可能几乎没变化）
下面这些别动：自带运行环境、Electron 运行文件、程序安装目录、你的对话与附件

──────────────────────────────
颜色说明
🟢 可以安全清理 —— DSH 自己能重新生成的，清理不影响使用
🟠 要谨慎处理 —— 能用正确方法省下的，比如去卸载不用的插件，而不是手动删文件
⚪ 不要动 —— DSH 运行需要的，以及你自己的对话和附件，删了会出问题

（下面是统计范围说明）
```

**怎么读这张图：**

| 你看到 | 意思 |
|---|---|
| **三个方框** | 「DSH 数据」「DSH 程序」「系统缓存」，**各有各的数字**。它们之间**不能相加**，原因见下面的范围说明 |
| 最上面的数字 | 只是 **DSH 的数据**占了多少硬盘（不是 DSH 整个程序，也不是整台机器） |
| 绿色胶囊 | 这部分**随便删都安全**，DSH 会自己重建 |
| 橙色那行 | 这部分**要按正确方式**才能省下（比如去卸载插件） |
| 灰色那行 | 这部分**请不要动**（运行环境、程序文件、你的对话） |
| 每行前面的小圆点 | 🟢 可以安全清理　🟠 要谨慎处理　⚪ 不要动。面板底部有一份**颜色说明**，把这三条逐句写清楚 |
| **点一下某一行** | 展开看这一类里**最大的几个文件夹**，以及一句话说明删了会怎样 |
| 每行右边的 **打开** | 在文件管理器里定位到那个文件夹。🟢 的行**默认就能点**；🟠 和 ⚪ 的行要先在设置里打开敏感位置开关（见下一节） |

**「DSH 数据」这个方框里还有三个页签：**

- **总览**：每个分类一片，名字就是分类名——所以这里没有名称/路径切换。
- **按插件**、**按聊天记录**：图例右上角有一个小小的 **「显示完整路径」/「显示名称」** 按钮，点一下就在名称和完整路径之间切换（它改的就是设置里那个「显示完整路径」偏好，两边不会打架）。
- 聊天记录用的是**真实工作区名字**加一小段会话编号，例如 `disk-doctor · 64875ca0`；可展开的列表行也是同一套名字。插件保持包名（`dsh-image-gen`），因为更好听的名字存在插件自己的 `package.json` 里，去读它就破坏了「只打开过 workspace.json 这一个文件」的承诺。
- 这两张图的图例行同样带「打开」按钮，而它们都是 🟠 / ⚪，所以**一开始整张图的按钮都是灰的**——这时图的右上角会直接写清楚该去打开哪个开关，按钮能用之后这句话就消失。

**在「DSH 数据」这个方框里**，绿色、橙色、灰色三部分加起来正好是那个数字，不会有算不进去、或者重复计算的部分。
**但三个方框之间不能相加**：缓存里的 pnpm 仓库放的就是「DSH 数据」里那些插件文件的真实副本（硬链接指向同一批文件），加起来会把同一批字节算两遍——所以插件故意不给「一共多少」。

> 📁 **统计范围**：现在分成三个区看，各有各的数字——
> ① **DSH 数据**：DSH 自己的数据文件夹（`~/.dsh`，或你在设置里指定的位置）加上 DSH 在临时目录里的文件；
> ② **DSH 程序**：DSH 程序本身，可能有**两份**——桌面程序（比如 `E:\dsh1`）和 npm 单独装的那份全局 `dsh`；两份都是自动找到的；
> ③ **系统缓存**：DSH 用到的两个系统缓存目录（桌面端的用户数据、pnpm 内容仓库）。
> 这三个数字**不能相加**，所以最显眼的那一个只写「DSH 的数据占了」，不写「DSH 一共占了」。

**举例**：点「聊天记录」，它会说「你和 DSH 的对话记录。删掉就找不回来了，要谨慎」，下面列出最大的几个会话文件夹。

---

## 想打开某个文件夹看看

每一行右边都有一个 **打开** 按钮，点了会在文件管理器里定位到那个文件夹。**它只会打开文件夹，不会删、不会改任何东西。**

- **不用配置**：🟢「可以安全清理」的行直接就能点开——「允许打开文件夹」这个总开关**默认就是开的**。
- 🟠「要谨慎处理」和 ⚪「不要动」的行（可能是你的对话目录，也可能是程序安装目录），**还要另外打开「允许打开需谨慎处理的位置」**（默认关着）。这是故意分成两道开关的：在人家的对话文件旁边开窗口，比开一个临时目录要慎重得多。
- 如果你把总开关**关掉**，所有「打开」按钮都会变灰——出问题时可以这样一键停掉这个功能。
- 设置页上这两个权限是**开关**（拨一下就开/关），不是让你手打 `true`/`false` 的输入框；改动过之后旁边才会出现「恢复默认」。
- 如果某个位置本来就打不开，面板会直接告诉你原因；也可以用旁边的 **复制** 按钮把完整路径复制出来，自己去文件管理器里找。

---

## 清理：先列清单，再搬走，随时能撤销

面板上有一个 **「清理」** 方框，分三步，每一步都要你自己点。

**第一步：列清单。** 点 **「看看会移动什么」**，它列出「如果清理，会移动哪些东西、一共多少、会移到哪个文件夹」。

- **只列 🟢「可以安全清理」的东西。** 🟠 和 ⚪ 一律不参与（插件本体、运行环境、程序文件、你的对话都不在里面）。
- **刚刚还在动的东西不列。** 最近一小时内还被 DSH 写过的东西会跳过，清单里会写明原因。最常见的例子就是当前会话自己的临时文件——把它从正在干活的进程脚下搬走不叫清理。所以清单上的数字通常比面板上那个绿色数字小。
- 清单里每一项旁边都有 **打开**，可以先去文件管理器里看看它到底是什么。

**第二步：搬走（只在你打开开关并确认之后）。** 那个开关叫 **「允许清理（移动到回收站）」**，**默认是关的**，而且它在**面板右上角的 ⚙ 齿轮**里（不是插件设置页）——因为它管的就是面板上这个按钮。关着时「移动到回收站」按钮是灰的，面板会写明原因。打开它之后，那个按钮上就是字面意义上的两下：**第一下把按钮文字变成「确定，移动」**，下面同时出现一行「确定移动这 N 项（共 X）吗？」加「确定，移动」与「取消」；**第二下**（改过字的按钮，或问句里的「确定，移动」）才真的搬。点「取消」就回到「移动到回收站」，什么都没发生。

> ✅ **它只是「搬走」，从不删除。** 被移动的东西会被 **改名移动** 到插件自己的回收站文件夹（`~/.dsh/disk-doctor/quarantine/`）里，一步都不复制、一个字节都不删。插件里没有任何会删东西的按钮。

**第三步：撤销。** 搬完之后方框里会出现 **「撤销」**，点了就按清单把东西原样移回原处。如果原位置在这期间又被别的文件占了，它会**拒绝覆盖**，并在面板上说明哪些没能移回去——宁可不动，也不会盖掉你的东西。

几个你可能会问的点：

- **「回收站里的批次」** 列出的是还没撤销的批次，每个都有各自的「撤销」；关掉面板之后再回来，它们还在。
- **清空那个回收站文件夹是你自己的事**，在文件管理器里做——这个插件不会替你删任何东西（面板上也是这么写的）。
- **「移到哪」在预演阶段只是算出来的地址**，你不点第二步，它连文件夹都不会创建。
- **搬不动的时候它会说原因**，而不是没反应：开关没开、**宿主还是旧版本**（这个接口还不存在——重启 DSH 再试一次）、或者连不上宿主。

**「想省更多空间？这样做才对」** 那个方框是配套的：在这里删文件夹几乎不省空间（pnpm 仓库和插件目录是同一批文件的硬链接），或者会把 DSH 弄坏。所以它直接告诉你该做哪两件事——去插件页卸载不用的插件、用 `pnpm store prune` 清 pnpm 仓库——以及哪些东西绝对不能动。

---

## 想省空间怎么办

面板把可回收的部分分成三档，**按档处理**：

| 档位 | 怎么处理 |
|---|---|
| 🟢 **可以安全清理** | 对着路径删就行，DSH 会重建。这类通常只有几 MB |
| 🟠 **需要正确操作才能省下** | **不要手动删文件。** 典型是「安装的插件」——去**插件页卸载不用的插件**，让 DSH 自己清理 |
| ⚪ **请不要动** | 运行环境、程序文件、你的对话。删了 DSH 会打不开，或者丢数据 |

**最容易踩的坑**：看到「安装的插件」占了上百 MB，就手动去删那些文件——**千万别这么干**，那会让插件加载失败、DSH 可能起不来。正确做法是**卸载那个插件**。

> 💡 还有一个相关的坑：面板「系统缓存」里的 **pnpm 内容仓库** 也是 🟠。你删掉插件文件夹，空间可能几乎不释放——因为文件的真身就在这个仓库里；反过来只删仓库也一样。要省这块空间，用 pnpm 自己的命令（`pnpm store prune`），别手删。

> ⚠️ 再说一次：**它从不删除任何东西。** 面板上的「清理」最多把 🟢 档的东西**搬进它自己的回收站文件夹**，而且随时能撤销；剩下的删除动作（比如卸载插件、清空回收站文件夹）都要你自己在文件管理器里做。

---

## 设置项说明

在 **插件 / Plugins → Installed → dsh-disk-doctor** 那张卡片里，能看到这 **8 项**设置（前 3 项摆在明面上，后 5 项收在「高级选项」里；其中 2 项是开关）：

| 设置 | 大白话 | 要不要动 |
|---|---|---|
| **要检查哪个文件夹** | 统计哪个目录 | 不用动，保持默认 |
| **每类最多列出几条** | 展开某一类时最多显示几项 | 嫌列太多就改小 |
| **详细报告保存在哪里** | 详细报告存在哪个文件夹 | 不用动 |
| ▼ **高级选项** | 一般不用打开 | — |
| └ 不想统计的文件夹 | 不想让它统计的路径，逗号隔开 | 有特别大的目录不想看时用 |
| └ 跟随快捷方式 | 遇到快捷方式要不要跟进去 | **保持 false**，改了数字会重复计算 |
| └ DSH 程序装在哪里 | 桌面程序的安装目录 | 不用动，留空就自动找到；npm 那份是另外自动找的，不用填 |
| └ 允许打开文件夹 | 「打开」按钮的总开关（一个开关，不是填空） | 默认开着；不想用「打开」按钮时关掉它 |
| └ 允许打开需谨慎处理的位置 | 连「要谨慎处理／不要动」的行也能打开吗 | 默认关着；确实需要时再打开 |

**「允许清理（移动到回收站）」不在这个页面上**——它是第 9 个设置项，住在**面板右上角的 ⚙ 齿轮**里（分隔线下面的第 4 个控件，在三个外观偏好之后），因为它管的就是面板上那个按钮。它同样是宿主设置：改完立即生效，保存方式和设置页一样，两个界面看到的是同一个值。**默认关着**；打开后，清理框里的「移动到回收站」按钮才可点，而且还要再点一次确认。

---

## 给别人用，怎么装

### 情况一：你自己电脑上（已完成）
什么都不用做，右侧栏点「磁盘空间」。

### 情况二：给朋友装（插件还没发布到网上）

1. 把 `dsh-disk-doctor` 文件夹里**运行需要的东西**拷给朋友（U 盘、网盘都行）：`lib/`、`client/`、`cordis.patch.yml`、`package.json`、`README.md`、`USAGE.md`、`LICENSE`。`DESIGN.md`、`TODO.md` 和 `test/` 是开发材料，不用拷（`DESIGN.md` 里记着开发机的路径，给它反而是负担）。
2. 朋友在 DSH 里打开 **插件 / Plugins** 页。
3. 点 **「添加插件 / Add plugin」**。
4. 把**文件夹的完整路径**粘进去，例如 `D:\插件\dsh-disk-doctor`。
5. 点安装，然后**重启 DSH**。

> 关键点：那个输入框**直接支持本地文件夹路径**，不需要打命令。

### 情况三：插件发布到网上之后（推荐的最终形态）

1. 朋友打开 **插件 / Plugins** 页。
2. 点 **「添加插件」**。
3. 输入 `dsh-disk-doctor`。
4. 回车，重启。

**一步到位。** 这也是为什么要发布到 npm——对普通人最友好。

---

## 常见问题

**Q：右侧栏没有「磁盘空间」？**
重启 DSH，再刷新一下网页。还是没有的话看 **设置 → 插件 → 插件列表**，那里会列出加载失败的原因。

**Q：数字和我在文件夹属性里看到的对不上？**
正常。DSH 默认**不跟随快捷方式**，所以通过快捷方式指向外面的大文件不会被算进来。这是故意的：跟进去会重复计算。

**Q：为什么显示「未找到附件目录」？**
说明你没用过附件功能，它就把这一类并进「其他」了。不影响。

**Q：为什么面板上有三个数字，却不能加在一起？**
因为它们的范围有重叠：「系统缓存」里的 pnpm 仓库放的就是「DSH 数据」里那些插件文件的真身（硬链接指向同一批文件）。加起来会把同一批字节算两遍，所以插件故意不给「一共多少」，只让你分开看。

**Q：「打开」按钮是灰的，点不动？**
灰只有两种可能。如果你连 🟢「可以安全清理」的行都点不动，说明 **「允许打开文件夹」** 这个总开关被关掉了（它默认是开的），去 **设置** 里重新打开即可。如果你要打开的正好是 🟠 或 ⚪ 的行（比如对话目录、程序安装目录），那需要在设置里打开 **「允许打开需谨慎处理的位置」**（默认关着）。

**Q：「按插件」「按聊天记录」里的打开按钮全是灰的？**
这是正常的：这两张图里的行都是 🟠「要谨慎处理」和 ⚪「不要动」，要打开「允许打开需谨慎处理的位置」才能点。图的右上角会直接写出这句话，告诉你缺哪个开关——不用自己猜。

**Q：点「打开」会不会误删东西？**
不会。它只让文件管理器跳到那个文件夹，不删除、不移动、不改名；如果是文件，也只会定位到它所在的文件夹，不会拿它去喂别的程序。

**Q：点了「看看会移动什么」，它会不会真的动文件？**
不会。这一步只是列清单。真正搬东西要你先在**面板的 ⚙ 齿轮**里打开 **「允许清理（移动到回收站）」**，再在那个按钮上点两下（第一下只是把按钮改成「确定，移动」并弹出问句）。

**Q：为什么清单比「可以安全清理」的绿色数字少？**
主要因为「刚刚还在动的东西不列」：最近一小时内还被 DSH 写过的东西会被跳过，而那通常就是当前会话自己的临时文件，正被 DSH 用着。清单里会写清楚跳过了多少、为什么跳过。

**Q：「移动到回收站」按钮是灰的？**
因为 **「允许清理（移动到回收站）」** 默认是关的——它在**面板右上角的 ⚙ 齿轮**里，按钮旁边也写着原因。打开它之后按钮才会亮；点一下它只会变成「确定，移动」并弹出问句，再点一下才真的搬。

**Q：点了「移动到回收站」，什么都没发生？**
现在会写明原因，不会没反应：如果提示**「宿主还是旧版本（这个接口还不存在）」**，说明你装完插件还没重启 DSH，重启后再试一次；如果是「没能连上宿主」，稍后再试；如果按钮是灰的，就是上面那条——开关没开。

**Q：搬走之后我怎么恢复？**
点方框里的 **「撤销」**，它会按清单把东西移回原处。如果某个原位置在这期间被别的文件占了，它会**拒绝覆盖**那一项并告诉你，其余照常恢复。关掉面板再回来也不怕：「回收站里的批次」会列出还没撤销的批次，每个都能单独撤销。

**Q：能自动帮我删吗？**
**它从不删任何东西。** 它最多把 🟢「可以安全清理」的文件夹**搬进自己的回收站文件夹**，随时能撤销；清空那个文件夹要你自己在文件管理器里做，插件里没有任何会删除的按钮。需要「正确操作」的那些（比如卸载插件）依旧是你自己来做。

**Q：它联网吗？**
不联网。它只读你电脑上的文件大小，不会把任何东西发出去。面板上的数字是 DSH 自己算好、浏览器从本机读的。

**Q：报告里为什么把我的用户名写成了 `~`？**
因为报告是准备给别人看的：凡是会离开这台机器的输出——工具返回值、Markdown 报告、JSON 报告——都会把主目录换成 `~`，这样路径里不会带着你的账户名。**面板上显示的是真实路径**，不然你就没法复制、也没法打开文件位置了。这个区分是刻意的，2026-10-07 已确认。

---

<a id="english"></a>
# English

## What this plugin is for

It answers one question: **how much disk is DSH using, and where is it going?** The panel shows three areas one under another, each with its own figure and one bar per kind of content, so the biggest thing is obvious at a glance, and tells you what is safe to remove and what is not.

> ⚠️ **This version never deletes — but it can move things aside.** It will tell you "3.84 MB is safe to clean up", and if you want, turning on **Allow cleanup** in the panel's ⚙ gear and confirming moves those 🟢 folders into the plugin's own quarantine folder (a move, not a delete). One more click puts them back. Emptying that folder stays your job.

## Reading the panel

Open **Disk space** in the right sidebar. It opens by itself **once** after installing; if you close it in that tab it stays closed (a new tab or window opens it again). To reopen it, use the **`+`** control in the sidebar's tab strip and pick **Disk space**.

You get **three boxes**: **DSH data**, **DSH application**, **System caches** — and below them a **Cleanup** box and a short "what actually frees space" guide.

- **The big number** is how much disk **DSH's data** uses — not the whole application, and not the whole machine. See the scope note below.
- **The green pill** is the part that is safe to remove: DSH rebuilds it by itself.
- **The orange line** is the part you can only reclaim *the right way* — for example by uninstalling plugins.
- **The grey line** is the part to leave alone: the runtime, the program files, your conversations.
- **A coloured dot** on each row carries the same verdict: 🟢 safe to clean, 🟠 handle with care, ⚪ leave alone. The **colour key** at the bottom of the panel spells the three out in a sentence each.
- **Click a bar** to see the largest folders inside it, plus a sentence explaining what happens if you delete it.
- **The Open button** on the right of a row reveals that folder in your file manager. 🟢 rows work straight away; 🟠 and ⚪ rows need the sensitive-locations switch — see the next section.
- **The Cleanup** box lists what a cleanup *would* move, and — once **Allow cleanup** (in the panel's ⚙ gear) is on and you confirm a second time — moves those folders into the plugin's own quarantine, with an Undo button and a list of other batches still waiting. See two sections down.

**Inside the "DSH data" box there are three tabs:**

- **Overview** — one slice per category, named by category; there is nothing to switch here.
- **By plugin** and **By conversation** — the legend's top-right corner carries a small **"Show full paths" / "Show names"** pill that flips between names and full paths. It sets the same preference the ⚙ switch does, so the two controls cannot disagree.
- Conversations use their **real workspace title** plus a short session tag (`disk-doctor · 64875ca0`); the expandable list rows use the same labels. Plugins keep their package name (`dsh-image-gen`), because a prettier name lives in each plugin's own `package.json` and reading it would break the promise that only `workspace.json` is ever opened.
- Every legend row in those two charts also has an **Open** button, and those rows are 🟠 and ⚪ — so both charts start with every button greyed out. The chart's corner says which switch would light them up, and the sentence disappears once they work.

**Inside the "DSH data" box**, the green, orange and grey parts add up to that box's figure, so nothing is unaccounted for or counted twice. **The three boxes never add up to one another**, though: the pnpm store under "System caches" holds the real files behind the plugin folders in "DSH data", so adding them would count the same bytes twice. That is why the plugin deliberately shows no grand total.

> 📁 **Scope.** Three areas, each with its own figure: ① **DSH data** — DSH's own data folder (`~/.dsh`, or wherever you point it) plus the DSH files in the temporary directory; ② **DSH application** — the application itself, which a machine can have **twice**: the desktop app (for example `E:\dsh1`) and a separate global `dsh` installed by npm; both are found automatically; ③ **System caches** — the two system cache folders DSH feeds (desktop user data, pnpm content store). These three numbers **cannot be added together**, so the headline reads "DSH data is using", not "DSH is using in total".

## Opening a folder

Every row has an **Open** button on its right. It jumps to that folder in your file manager, and **it only opens the folder — it never deletes, moves or renames anything.**

- **Nothing to configure:** 🟢 "Safe to clean up" rows open straight away — the master switch, **"Allow opening folders"**, is **on by default**.
- 🟠 "Handle with care" and ⚪ "Leave alone" rows — your conversation folders, the application files — need **"Allow opening sensitive locations"** as well, which is **off by default**. The two switches are deliberately separate: opening a window next to someone's conversations is a bigger favour than opening a temp folder.
- Turning the master switch **off** greys out every Open button — a one-click way to stop the feature if you ever want to.
- Both permissions are **switches** on the settings page, not boxes where you type `true`; a small "Reset" control appears beside one only once you have changed it.
- If a location cannot be opened, the panel says why, and the **Copy** button beside it puts the full path on the clipboard so you can go there yourself.

## Cleanup — list it, move it aside, undo it

The cleanup box has three stages, and each one needs a click from you.

**1. List it.** Press **"Show what would move"** and it lists what a cleanup *would* move, how much that is, and where it would go.

- **Only 🟢 "Safe to clean up" content is listed.** 🟠 and ⚪ never take part (the plugins, the runtime, the program files and your conversations are not in it).
- **Anything touched recently is left out.** Content DSH wrote to within the last hour is skipped, and the list says so ("still changing within the last hour, possibly in use"). The usual example is the current session's own temporary files — moving those out from under a live process is not a cleanup. That is why the listed figure is usually smaller than the green total.
- Every listed item has its own **Open** control, so you can look at it in your file manager first. At this stage "Into" is only an address that was computed — that folder is not created.

**2. Move it aside — only after you switch it on and confirm.** The setting **"Allow cleanup (move to quarantine)"** is **off by default**, and it lives in the panel's own **⚙** gear (top-right of the panel, not the plugin's settings page) because that is where the button it governs is. While it is off, the **Move to quarantine** button is greyed out and says why. Once it is on, that button takes literally two clicks: the first **relabels it** to **"Yes, move them"** and opens a question line — "Move these N items?" with "Yes, move them" and "Cancel" — and the second click (either the relabelled button or the line's yes) moves. Press Cancel and the button goes back to "Move to quarantine" with nothing done.

> ✅ **It moves; it never deletes.** What moves is **renamed** into the plugin's own quarantine folder (`~/.dsh/disk-doctor/quarantine/`): nothing is copied and not one byte is deleted. There is no button anywhere in the plugin that deletes.

**3. Undo it.** After a move the box shows **Undo**, which puts everything back according to the manifest. If an original spot has been taken by something else in the meantime, it **refuses to overwrite** that item and tells you which ones could not go back — the rest are restored.

A few things you may wonder about:

- **"Batches in quarantine"** lists the batches that have not been undone, each with its own Undo; they survive closing the panel.
- **Emptying that quarantine folder is your job**, done in your file manager — this plugin never deletes anything for you (the panel says so too).
- **The move happens on a freshly drawn-up plan**, so an item that started being written to after you looked simply drops out of the move and is reported instead.
- **A move that cannot happen says why** rather than doing nothing: the switch is off, **the host is still an older version** (this endpoint does not exist yet — restart DSH and try again), or the host could not be reached.

The **"What actually frees space"** box goes with it: deleting folders here frees almost nothing (the pnpm store and the plugin folders are hard links to the same files) or breaks DSH. So it names the two operations that work — uninstall the plugins you no longer use, and run `pnpm store prune` for the pnpm store — and lists what must not be touched.

## Freeing space

The panel sorts the reclaimable space into three tiers — act by tier:

| Tier | What to do |
|---|---|
| 🟢 **Safe to clean up** | Delete the listed paths directly; DSH rebuilds them. Usually only a few MB. |
| 🟠 **Reclaimable the right way** | **Do not delete files by hand.** The usual case is "Installed plugins" — uninstall the plugins you no longer use from the Plugins page and let DSH clean up. |
| ⚪ **Leave alone** | The runtime, the program files, your conversations. Delete these and DSH will not start, or you lose data. |

**The trap to avoid:** seeing "Installed plugins" at a few hundred MB and deleting those files by hand. That breaks plugin loading and can stop DSH from starting. Uninstall the plugin instead.

> 💡 A related trap: the **pnpm content store** under "System caches" is 🟠 too. Deleting a plugin folder may free almost nothing, because the real files live in that store — and the reverse is true as well. Reclaim that space with pnpm's own command (`pnpm store prune`), not by hand.

> ⚠️ To repeat: **it never deletes anything.** The cleanup moves 🟢 content into its own quarantine folder and can undo that at any time; the removals above — uninstalling plugins, emptying the quarantine — are yours to do in your file manager.

## The settings

These **eight** live on the plugin's own card; the first three are plain, the other five sit behind **Advanced**, and two of them are switches.

| Setting | In plain words | Change it? |
|---|---|---|
| **Which folder to look at** | Which folder gets measured | No — leave the default |
| **How many items to list** | How many entries appear when you open a group | Lower it if the lists are too long |
| **Where the full report is saved** | Folder the detailed report goes to | No |
| **▼ Advanced** | You normally do not need this | — |
| └ Folders to leave out | Paths to skip, comma separated | Only if a huge folder is noise to you |
| └ Follow shortcuts | Whether to follow shortcuts into other folders | **Keep false** — turning it on double-counts |
| └ Where DSH is installed | The desktop app's install folder | No — leave it blank and it is detected; the npm installation is found on its own |
| └ Allow opening folders | The master switch for the Open buttons (a switch, not a text box) | On by default; switch it off if you do not want the Open buttons |
| └ Allow opening sensitive locations | Also opens 🟠 and ⚪ rows | Off by default; only when you really need it |

**"Allow cleanup (move to quarantine)" is not on this page.** It is the ninth field and it lives in the panel's own **⚙** gear (the fourth control there, below a divider, under the three appearance preferences), because that is where the button it governs is. It is still a host setting: it takes effect immediately, it is saved the same way a settings-page save is, and both surfaces read the same value. It is **off by default**; once it is on, the cleanup box's **Move to quarantine** button becomes clickable — and it still asks a second time.

## Installing it for someone else

**Their own machine:** nothing to do — open **Disk space** in the right sidebar.

**Handing it to a friend before it is published:** copy the files it needs at runtime — `lib/`, `client/`, `cordis.patch.yml`, `package.json`, `README.md`, `USAGE.md`, `LICENSE` — then have them open **Plugins → Add plugin**, paste the **full folder path**, install, and restart DSH. The dialog accepts a local folder path directly — no commands needed. `DESIGN.md`, `TODO.md` and `test/` are development material and need not travel with it.

**Once it is published:** open **Plugins → Add plugin**, type `dsh-disk-doctor`, press Enter, restart. That is the whole thing, and it is why publishing matters: it is the only version a non-technical user can do on their own.

## Common questions

**The panel is not in the sidebar.** Restart DSH and reload the page. If it is still missing, **Settings → Plugins → Plugin list** reports loading failures per entry.

**The numbers differ from the folder's own size.** Expected: DSH does not follow shortcuts by default, so files reached only through one are not counted. Following them would double-count.

**Does "Show what would move" actually move anything?** No — that step only builds a list. Moving needs **"Allow cleanup (move to quarantine)"** switched on in the panel's ⚙ gear, and then two clicks on the move button (the first one only relabels it and opens the question).

**Why is the list smaller than the green "safe to clean up" figure?** Mostly because recently touched content is left out: anything DSH wrote to within the last hour is skipped, and that is usually the current session's own temporary files. The list says how much was skipped and why.

**The "Move to quarantine" button is grey.** Because **"Allow cleanup (move to quarantine)"** is **off by default** — the button says so beside itself, and the switch is in the panel's **⚙** gear. Turn it on and the button lights up; it will still ask "Move these N items?" (by relabelling itself) before doing anything.

**I clicked "Move to quarantine" and nothing happened.** It now says why instead of going quiet: if it reports **"The host is still an older version"**, you have not restarted DSH since installing the plugin — restart and try again. If it reports that the host could not be reached, try again in a moment. A grey button means the switch above is off.

**How do I put things back after a move?** Press **Undo** in the cleanup box; it restores everything from the manifest. If an original spot has since been taken, that item is **refused rather than overwritten** and the panel tells you which ones those were. Batches survive closing the panel — "Batches in quarantine" lists them with their own Undo.

**Can it delete things for me?** **It never deletes anything.** At most it moves 🟢 content into its own quarantine folder, and you can undo that at any time; emptying that folder is yours to do in your file manager. There is no delete button anywhere in the plugin.

**Every Open button in "By plugin" and "By conversation" is grey.** That is expected: those rows are all 🟠 and ⚪, so they need **"Allow opening sensitive locations"**. The chart's own corner states that, so you do not have to guess which switch is missing.

**Why does the report show `~` instead of my user name?** Because a report is meant to be shareable: everything that leaves the machine — the tool result, the Markdown report, the JSON report — replaces your home directory with `~`. The **panel** shows real paths, because that is where you copy them and reveal the location. The split is deliberate and was confirmed on 2026-10-07.

**Does it use the network?** No. It only reads file sizes on your machine, and the panel reads its numbers from your own DSH process.
