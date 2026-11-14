# 项目记忆（AGENTS.md）

> 给在本目录工作的 agent：这里是「墨灵TeX」桌面版 + 其 **DSH 插件**所在项目。
> 只记结论与坑；实现细节以各自 README 为准。本文件由 DSH 的 workspace instructions 自动注入。

## 1. 项目构成

| 路径 | 是什么 | 状态 |
| --- | --- | --- |
| `src/` `electron/` `index.html` | 墨灵TeX 桌面版：Electron 33 + Vue 3 + CodeMirror 6 + PDF.js | v2.0.2；远端 `dichi123456/LaTeX-Editor`（本仓库 origin 经 ghproxy 中转） |
| `dsh-plugin-moling-latex/` | 墨灵TeX 的 **DSH 插件**，**独立 git 仓库** | v0.8.3 已发布；工作区另有未发版改动（**会话隔离** + 文件树自适应宽度 + 主 tex 判定改为「最近优先」 + One Dark 配色 + 内核换自写 LaTeX 词法 + 工具收相对路径不只认会话 cwd + 模板落地按目录是否非空决定子目录）；远端 `dichi123456/dsh-molingTex`（Public，main） |

父仓库 `.gitignore` 已忽略 `dsh-plugin-moling-latex/`，避免把它当嵌套仓库提交。
插件源码目录本身也是 DSH profile 里 `link:` 安装的目标目录。

## 2. 插件形态（v0.6.2，重做后的确定设计；v0.6.2 起移除面板互换）

**两个半侧**

- 宿主半侧：`lib/index.js`（5 个 Agent 工具 + 注册路由）、`lib/server.js`（与传输无关的操作表 `createPanelCore` + `/moling/api` 适配器）、`lib/latex.js`（引擎探测/编译流程/日志解析/清理/大纲）、`lib/synctex.js`。
- 浏览器半侧：`lib/client.js`（经典脚本，`window.__ModuleLoader__.load` 注册；除 `react` 外不 require 任何模块）。

**界面位置：DSH 右侧栏标签页**（不是左栏图标，也不是主面板）

```js
ctx.sidebarRightTabs.register({ id, kind: 'moling', title, guide: [{ order: 40, title, description }], keepMounted: true })
ctx.slots.register({ name: 'sidebar.right.pane.tab', key: ID }, Body)
```

- 启动页（每次进入先落这里）：**标题区 = 内联 SVG 墨灵 logo（`BrandMark`，44×44、圆角 11，渐变 id `ml-brand-grad`，跟桌面版 `src/assets/logo.svg` 同款；浏览器侧不能 import 图片，只能用 React 元素重画）+ 右侧大标题/副标题** + 「启动」动作行（新建文档 Ctrl+N / 打开文件夹 Ctrl+K / 打开文件 Ctrl+O）+「最近」列表（工作区/文件，带类型标签与右对齐路径）+ 模板卡片 + 右侧提示栏；**不自动打开任何工作区**。
- 工作台：左 tex（**CodeMirror 6**，虚拟化）| 右 日志/PDF，中间**分隔条可拖**（20%–80%）；文件树是浮层抽屉，右边框**可拖**（30%–100%）。**进入项目文件夹自动打开主 tex**：`enterRoot` 在 `loadTree` 后调 `pickMainTex(state.files, { root, recents })` —— ① `main.tex`（不区分大小写、根目录优先、浅的优先）；② **最近在这个项目里打开过的 .tex**（用户上次看的那个）；③ 项目里唯一一个 .tex；④ 根目录唯一的 .tex；⑤ 兜底选**体积最大**的 .tex（论文章节/片段通常远小于主文件）。只有"一个 .tex 都没有"才不打开。**踩过的坑：最早只要「没 main.tex 且不止一个 .tex」就放弃，于是用户那些没有 main.tex 的论文项目全都进不去主文件 —— 看着像"只认某一个文件夹"**。开完**不自动展开抽屉**（用户 2026-11-14 要求：进项目别一上来就顶出文件树，要看再点顶栏「文件树」；`enterRoot` 里是 `treeOpen: settings.treeOpen === true`）；「打开具体文件」与「新建文档」传 `autoOpen:false` 不被抢。**切到另一个项目文件夹时同步关闭上一个项目的东西**：`enterRoot` 发现 root 变了就先调 `closeProjectFiles()` —— 关掉全部 tex 标签、清空 PDF 预览（回退 blob 会 revoke）、编译日志、提纲/右键菜单/定位提示与旧文件树；同一个项目重进（含大小写不同）不动。另在 `refreshPdf` / `loadPdfBlob` / `compileActive` 里加了「取图或编译期间切了项目就丢弃结果」的护栏，免得旧 PDF/旧日志又自己冒出来。**底部状态栏**里：左侧通道/忙闲/TeX/文件名，最右 `日志`/`PDF` 切换，**正中**是编译结果（成功绿 / 失败红，绝对定位居中）。
- 顶栏按钮：`首页` `工作区…`（下拉）→ **分组一** `文件树｜文件大纲`、**分组二** `换行｜保存｜新建｜自编`（**`保存` 是分体按钮**：左边「手动保存/自动保存」点一下立刻存（Ctrl+S 同效），右边小三角切档；**自动保存** = 标签变脏后停手 1.2 秒存一次，切到自动时立刻把脏标签存一次；**`自编` = 自动编译开关**：开着时保存成功 / 外部同步（大模型改完）之后**防抖 900ms 自动编一次**，`busy` 时跳过不排队；两者默认都关/手动，状态存 localStorage；换项目会清掉待触发的定时器）（每组各自包在一个同底色圆角矩形里：几何走 `S.btnGroup`，配色走 `S.btnGroupBlue`（文件树｜文件大纲，蓝，token=brand-primary）/ `S.btnGroupAmber`（换行｜保存｜新建，橙，token=state-warn-primary）—— 颜色都是「行内 rgba 兜底 + `color-mix` token 增强层」两层，**不依赖 `<style>`/class**；组内按钮 `S.btnFlat` 无边框、激活才用 accent 描边，按钮之间用 `S.btnSep` 竖分隔线（1×14px）隔开），右端是**连接状态胶囊 + 分体编译按钮**（左 3/4 显示当前编译方式、点击即编译；右 1/4 小三角改方式）。**顶栏所有圆角矩形外高统一 24px**（`boxSizing:border-box + height:24`：btn / 工作区下拉 / 两个按钮组 / 连接胶囊 / 编译按钮；组内按钮 18px = 24 − 组内边距 4 − 组边框 2）；**工具栏所有矩形圆角统一 6px**（btn/select/btnGroup/linkPill/splitWrap/paneTab 全是 6，分体按钮内角 5 = 6 − 边框 1；浮层菜单 8、抽屉/提纲 10、PDF 页 2 不在此列）；面板内**左右两条顶栏同高 28px**（`S.tabsBar` 文件标签条 / `S.rightHead` pdf·日志工具栏，都是 `boxSizing:border-box + height:28`，标签条 `alignItems:flex-end` 贴底）。**`目录` 按钮已移除**：打开目录走启动页「打开文件夹…」（Ctrl+K）或顶栏「工作区…」下拉。`日志`/`PDF` 切换在**底部状态栏最右**。`新建` 复用 `newDocument()`（当前项目里建 `untitled[-n].tex` 的 ctexart 骨架并打开，`Ctrl+N` 同效）。
- **连接状态胶囊**：把 `store.root` 与 `/moling/api/workspaces` 的路径比对 → 已连接（绿）/ 同名不同路径（黄）/ 未连接（灰）；**只认 `kind === 'workspace'`**（`kind: 'opened'` 是插件自己打开过的目录，不算连接）。未连接时点一下调客户端服务 `workspaces.create({path})` 直接加进左侧工作区，已连接时点一下是刷新，窗口重新获得焦点自动刷新。
- **发送选中内容到对话框**（编辑器右键）：送进输入框的是**真 `@` 引用 chip**（圆角方框，如 `Safety_MARL框架.tex:20`）—— v0.6.6 起做实，早先"插件造不出 chip"的结论是错的。做法链（少一环都失败，别乱简化）：① `inject` 里必须声明 `'sessions'`；② 注入面在 `props.props` 里（`Workbench` 收的是 `{props,store}` 包装层，**直接读 `props.inputActions` 永远 undefined** → 统一走 `injected(props)`）；③ 草稿/draftRev 从 `useInput` 桥接的 `store.inputSnap` 读（`inputActions` 上**没有** `state`）；④ `useInput` 是 React hook，只能在渲染期调 → 用 `InputBridge` 桥组件；⑤ `setDraft` 之后**必须等一帧**（16ms，最多 6 次）让 React 把新草稿喂回来再取 `draftRev`，同帧读必是旧值 → span 的 CAS 必被拒；⑥ 有了新 rev 才 `actx.bail(actx, 'slash/input-insert-reference', { reference, span })`；⑦ 任何一步失败都退回纯文本（`formatSelectionCompact`）并在状态栏写原因、`setDraft 撤回`不留半截。**已知未做**：DSH 的 `@` 语法只能表达「文件:行」，**表达不了行内片段**，所以 chip 只覆盖整行，选中的那部分文字不在 chip 里。**别再改回**「> 来自 … 第 N 行（…）」或 ```latex 全文（用户否决过）。**右键那一刻就把选区快照进 `store.menu.selection`**（菜单期间丢了还有备份）。项目不在工作区时先拦住提示连接。
- **文件大纲**：顶栏 `文件大纲` → 编辑区左下角浮出章节列表（按层级缩进 + 行号），点一条跳到该行。解析在**浏览器里**做（`parseOutlineText`，不请求宿主），所以刷新即生效；宿主另有 `outline` 端点供工具/调试用。顶栏两个开关的按钮文案是「文件树」「文件大纲」（2026-11-14 用户要求，别写回「树」「提纲」）。
- **SyncTeX 双向**：编辑器**右键**菜单（含 撤销/重做/剪切/复制/粘贴/全选 + 「定位到 PDF 位置」）→ 源码行 → PDF 页 + 黄圈；**单击 PDF 页面** → 反向定位（跳到源码行）。两层都走宿主 `synctex` 端点。定位结果显示在**底部状态栏**，**两条路径都不许静默失败**（没打开 tex / 没有 PDF / 失败原因都会写出来）；`jumpTo` 会置 `suppressRestoreUntil = now+600ms`（这 600ms 内外同步不还原视口），并且**跳转要看得见**：自动收起文件树/提纲/右键菜单浮层，并把目标行**绿闪一下**（`store.flashLine/flashAt` → 编辑器 effect → `startFlash`）——「跳了但被树抽屉盖住 / 肉眼看不出」曾被当成"同步失效"。判断链路是否正常可以只跑 `node` + jsdom 把面板真挂起来点 PDF（见 `%TEMP%/moling-debug/domtest.mjs` 的做法）。面板接管了原生右键菜单，所以基础编辑项得自己补（内核 `runCommand`）。
- **PDF 预览**是降分辨率图片（不是内置阅读器）：宿主用 poppler `pdftoppm` 按 dpi 栅格化成「一页一张 PNG」，前端 `<img loading="lazy">` 等比缩放；清晰度三档 72/96/144（右栏头部下拉，存 localStorage）；**Ctrl+滚轮缩放** 0.5×–3×（普通滚轮照常滚动），**以鼠标为锚点**（wheel 记指针/滚动量/缩放比 → 渲染后按 `scrollLeft'=(sl+px)*ratio-px` 补滚动，所以放大是朝指针方向长的，不再锚在页顶）；右栏头部有 **`适应` 按钮**（一键整页适应当前窗口）：量 `.ml-pdf-scroll` 可视宽高 → `fitZoomFor(w,h,pageSize)` = `min(1, h/(w×页高宽比))` 夹 0.5–3（页宽是相对值、100% 本来就贴满面板宽，所以适应只会往下缩）；poppler 缺失或取图失败才退回 blob + iframe。
- 编辑器内核 = `lib/vendor/cm6.js`（CodeMirror 6 打包产物，395 KB，挂 `window.__molingCM`），**已内联进 `lib/client.js` 末尾**（`node lib/vendor/inline-kernel.cjs`），所以刷新页面就生效、不用重开 DSH；只渲染视口内的行（1435 行文档 DOM 里 ~29 行），实测**每次按键 1 ms**。加载失败自动退回旧的「透明 textarea + 高亮层」实现。`lib/vendor/entry.js` 是内核源码，`BUILD.md` 是重建步骤。
- **LaTeX 自动补全（v0.8.0）**：词表在浏览器侧（`lib/client.js` 的 `LATEX_COMMANDS` 107 条 / `LATEX_ENVIRONMENTS` 51 条 / `LATEX_PACKAGES` 65 个），匹配逻辑是纯函数 `completeLatex({text,pos})`，五种触发：`\begin{`/`\end{`（环境名，`\begin` 顺手补 `\end{...}` 把光标放中间）、`\ref{` 系列（扫文档内 `\label`）、`\cite{` 系列（扫 `\bibitem`，逗号多引用只补最后一段）、`\usepackage{`/`\documentclass{`（宏包/文档类）、`\` 前缀（命令）。内核侧 `entry.js` 的 `completionExtension(options)` 把它挂进 `EditorState.languageData` 的 `autocomplete` 字段 —— **basicSetup 里已含 `autocompletion()`，不要再装一次**。**致命坑（踩了一整轮才定位）：languageData 的 provider 每次读 facet 都会被调用，若在 `of(() => [{ autocomplete: (ctx) => ... }])` 里现造函数，CM 会认为「补全源换了」→ 每帧重启补全 → 弹窗永远不出现（jsdom 里 `.cm-tooltip` 恒为 0，但 source 被调了十几次）。修法：源函数与数组都在 `completionExtension()` 里**只造一次**，provider 返回同一个 `data` 引用。回归断言在 client-smoke 第 28 节（「补全源只造一次」「不在 provider 里现造函数」）。补全弹窗配色复用 `molingTheme` 里已有的 `.cm-tooltip` / `.cm-tooltip-autocomplete` 规则，不额外写 CSS。改词表只动 client.js（刷新即可）；改内核要重建 cm6.js + 内联 + `KERNEL_VERSION` 加一。
- 状态放**模块级 store**（组件卸载/重建不丢）+ localStorage（只存最近打开/引擎/模式/过滤词/两个分栏宽度/换行开关/预览清晰度）。

**通道：同源 `fetch('/moling/api/<endpoint>')`**，17 个端点：
`ping status workspaces open-root open-file tree read-file write-file stat compile clean pdf pdf-page asset synctex outline templates use-template`，
除 `pdf-page`（PNG）与 `asset`（JS/CSS）直接回二进制外，一律返回 `{ ok: true, value }` / `{ ok: false, error }`。

**模板库（v0.7.0）**：素材在 `lib/templates/`（21 个模板目录 + `index.json`，共 1.1 MB / 50 文件），由 `tools/sync-templates.mjs` 从桌面版 `src/templates/` 同步生成（改模板后重跑；脚本自写 `copyOne` 递归拷贝，**别用 `fs.cpSync`** —— Windows 上覆盖已有文件会报 `Error: , The operation completed successfully.`）。`index.json` 每项 = `{ id,name,category,engine,description,accent,layout,main:'main.tex',files:[相对路径…],bytes }`。
- `templates` 端点**只回元数据**（不含正文/文件列表）——1.1 MB 塞进首屏会慢，内容由宿主按需读盘；
- `use-template` 端点 `{root, template}` 落地：主文件统一 `main.tex`，`.cls/.sty/.bib/.bst` 与图片按原相对路径逐字节 `copyFileSync`（`figures/`、`figs/` 子目录会建）；**目标里已有 `main.tex` 就改落 `<root>/<模板id>[-n]/`**，绝不覆盖用户项目；返回 `{template,root,main,files}`；
- **启动页不再罗列模板**（v0.8.1，用户要求）：只留两张 `.ml-card` —— `浏览模板库`（`openTemplates()`）与 `新建中文文档`（ctexart 骨架）。模板清单移到**二级弹窗** `TemplateDialog`（挂在 `Body` 层，启动页与工作台都能弹，`store.templatesOpen` 控制）：
  - 第一步 `templateStep:'list'`：左侧分类导航 `.ml-tpl-nav`（全部模板 + 5 类，带计数）+ 右侧搜索框 `.ml-tpl-search` + 卡片网格 `.ml-tpl-grid/.ml-tpl-card`（**不是 `.ml-row`**，所以启动页行数断言不受影响）；空清单与「搜索无结果」各有文案；
  - 第二步 `templateStep:'target'`（标题变「新建文件」）：显示模板名/引擎/文件数 + **存放位置**行；`选择文件夹…` 走 `state.ctx.get('uiWorkspace').pickDirectory()`（取消返回 null → 不动已选目录、不发请求），选中后**先 `api('open-root')` 把目录登记进白名单**（`acceptRoot` 只认已登记目录，少了这步 `use-template` 必被拒）再 `patch({templateTarget})`；`创建` 才调 `newFromTemplate(template, target)`。`返回` 回列表、`Esc` 逐级退、点遮罩关闭；`closeTemplates()` 要清掉 `templateStep/templatePick/templateTarget`，否则下次打开会停在第二步；
  - 落地 `newFromTemplate(template, targetRoot)`：`api('use-template')` → 引擎跟着模板走（`xelatex`/`pdflatex`）→ `enterRoot(target,{treeOpen:false,autoOpen:false})` → `openTab(target,'main.tex')`；无 target 且无当前项目/最近目录时报「先选一个存放位置」不发请求；`{blank:true}` 走 `newDocument(root)`；
  - **坑**：`TemplateDialog` 里 Esc 的 `React.useEffect` 必须在 `if (!store.templatesOpen) return null` **之前**，否则打开弹窗时 hook 数变化 → React #310 整块崩（回归断言在 client-smoke 第 27 节）；`.ml-tpl-cats/.ml-tpl-cat` 胶囊样式已随旧启动页模板区一起删掉，分类改用竖排 `.ml-tpl-navitem`。
  - **弹窗尺寸固定**（v0.8.2 后续，用户要求「窗口不随模板数量变化」）：`.ml-modal` 用 **`height:min(620px,88%)`**（不是 `max-height`），`.ml-modal-body` 改 `display:flex;flex-direction:column;overflow:hidden`，只有 `.ml-tpl-grid` 内部 `overflow:auto` 滚；左导航 `.ml-tpl-nav` 与 `.ml-tpl-layout` 用 `align-items:stretch` 撑满，`.ml-tpl-main` 加 `min-height:0`；「新建中文文档」入口挪出网格到 `.ml-tpl-footcard`（`flex:none`）不随滚动跑。第二步内容短 → `.ml-modal-body-target` 覆盖成 `display:block;overflow:auto` 从顶部排（**别用 flex 居中**，620px 高的壳里会显得空）。**踩过的坑**：给网格加 `flex:1 + overflow:auto` 后，默认 `grid-auto-rows:auto` 在「网格自身有高度约束」时会把行压到均分容器高（63px），卡片里的 flex 子项跟着被压 → **模板名只剩 8px 被裁掉半截**（看着像字体渲染坏了，实际是行高被压）。修法：`.ml-tpl-grid` 必须写 **`grid-auto-rows:max-content`** + `.ml-tpl-card>*{flex:none}` + `.ml-tpl-name{line-height:18px;flex:none}`。诊断手法：`msedge --headless --dump-dom` 里注入 probe 读 `getBoundingClientRect`/`getComputedStyle().gridTemplateRows`，比盯截图快得多。

**外部改动自动同步（大模型改 tex → 编辑区自己刷新）**：面板每 2 秒打一次 **`tree`**（不是专门的 `stat` 端点！`tree` 是文件树本来就在用的通道，一定能通；一次请求同时给出每个文件的 `mtime` 和目录里增删了谁），拿 **`mtime`** 当版本戳比对（**别带 size**：`read-file` 与 `tree` 的口径一旦不同就会互相打架、每 2 秒白重读一次）：
- 已打开的 tex 变了 → 重新 `read-file` 读进标签（CodeMirror 的 `[tab.text]` effect 会 `setDoc`，光标 clamp 不跳走），状态栏提示「已同步 xxx」；**标签脏（有未保存改动）→ 只红色提醒绝不覆盖**；文件从清单里消失 → **只提示、绝不关标签**（删文件是少见操作，误判一次就会把自动打开/正在看的主 tex 关掉；清单被截断时更不判定）；
- 正在预览的 PDF mtime 变了 → `refreshPdf` 换图（大模型跑完 `latex_compile` 就是这条路径）；
- 文件清单（rel 列表）变了 → 用同一份快照直接换 `files/tree`（新建/删除/重命名立刻可见；只改内容不动树，避免每 2 秒重画）；
- **改动行标绿 → 几秒后渐隐**：`reloadTab` 先用 `diffLineRanges(old,new)` 算出「新文档里哪几行变了」（掐公共前后缀 + 中间块按行做多重集比对，所以第 10 行和第 500 行各改一处只会得到两段、不刷绿中间 490 行），`pendingFlash` 交给编辑器的 `[tab.text]` effect 消费 → 往行元素上涂内联 `background`（CM 的 `.cm-line` 用 `lineReaderFor` 换算行号：**主路 `getBoundingClientRect` + `posAtCoords`**，兜底「视口首行 + DOM 序号」——早先拿 `posAtDOM` 当主路，实际一行都没涂上；回退高亮层的 `[data-line]` 直接读属性），停 4 秒后摘掉（`transition: background-color 900ms` → 渐隐），窗口期内视口滚出新行由 `onViewport` 补涂。**不动内核**：`entry.js`/`cm6.js` 一字未改，刷新页面即生效。
- **同步不跳页**：`setDoc` 是整篇替换，CM 会把视口带到光标处（观感就是"页面滑走了"）。`captureViewport` 记下「视口首行行号 + 行内像素偏移」，替换后 `restoreViewport` 挪回去，并在 `requestAnimationFrame` 里再补一次（等高度/换行重排稳定）。
- **可观测**：状态栏「同步●」绿=通道通 / 红✗=失败（`syncError` 是原因，悬停可看、60 秒内还会在中间红字报一次）/ 灰…=还没跑过。轮询在 `boot()` 和 `Body` 挂载 effect 里各起一次（`startWatch` 幂等）；**不再用 `document.hidden` / `state.view` 做闸门**（那会把轮询整段跳过却毫无提示），`watchBusy` 带 6 秒看门狗（一次卡死的请求不会把轮询永久锁死）。
- 版本戳在 `read-file`/`write-file`/`refreshPdf` 成功后盖章；`setDoc` 前记 `suppressDirtyText` 防止把自己标脏（见坑 15）；换项目 `closeProjectFiles()` 全清。
- **进项目期间（`enteringRoot`）暂停轮询**，并且轮询**永远不关标签**：这两条是"自动打开主 tex 失效"的两次教训 —— 同步一旦拿旧/不全的快照去比对，就会把刚打开的主 tex 判成"已删除"。

**会话隔离（待发版）：每个对话各看各的项目**。面板的模块级 `state` 被切成「按会话分片」——`sessionShards[sessionId]` 存项目现场，全局 `state` 只是「当前屏幕那个会话」的视图。
- 分片字段 `SESSION_FIELDS`（35 项，全是项目/界面现场：`view/root/tree/files/total/skipped/truncated/expanded/treeOpen/filter/tabs/activeId/log/pane/pdf*/syncMark/syncNotice/outline/outlineOpen/menu/compileMenu/notice/noticeOk/syncOk/syncError/error`）；**设置类字段不隔离**（`mode/engine/split/treeW/wrap/autoCompile/saveMode/pdfDpi/pdfZoom/recents` 是这台机器的偏好，切会话保留）。
- `switchSession(id)`：同 id 空操作返回 `false`；否则存旧分片 → 装新分片（没有就 `blankSession()`）→ `patch` → 恢复 `stamps`/`treeSignature` → 清 `watchWarned`/`missingNoticed`/`autoCompileTimer`/`autoSaveTimer`/`pendingFlash`/`enteringRoot`，并清 `busy/syncBusy/outlineBusy/dragging`（忙闲是「某请求在跑」，不跟项目走，不清会让新会话永久卡「忙」）。**别在这里 revoke 旧会话的 PDF blob**：那段属于刚被摘走的会话，回收了切回去就是破图。
- 谁有权切：`Body` 里 `sessionId` 取自注入面 `face.sessionId || face.session || face.session.id`；`visible` 先看 `props.useTabInfo().tab.visible !== false`，**再用 `sidebarRight.mounted` 兜一层**（`useMountedSession()` 读 `state.ctx.get('sidebarRight').mounted`，服务比面板晚就绪 → 50ms 重试最多 20 次；浮动面板下多个会话的 `tab.visible` 可能同时为真，只有 `mounted` 是权威）。**非当前会话的右栏子树是 `hidden` 隐藏而非卸载**（`RightbarRoot` 逐会话 `SessionView`），所以这道闸门必须有，否则后台会话会抢全局 store。
- 异步回包护栏（切会话/切项目后旧请求的结果不许灌进来）：`loadTree` 回包比对 `normalizePath(target) !== normalizePath(state.root)` 就丢；`openTab` 的 `read-file`、`saveTab` 的 `write-file` 回包先 `findTabById(id)` 还在才继续；`applySyncSnapshot` 把 `reloadTab`/`refreshPdf` 收进 `pending` 数组并 `Promise.all`（**否则 `await syncExternalChanges()` 只等到「快照比完」，编辑区文本还没换 → 自编抢跑**）。
- 诊断导出：`__switchSession` / `__currentSession` / `__sessionShards` / `__SESSION_FIELDS` / `__syncProbe`（返回 `enteringRoot/watchBusy/busyMs`，查「同步为什么被跳过」）。回归在 client-smoke 第 31 节。
- **测试坑**：`test/client-smoke.mjs` 的 `ok()` 现在按第二参数类型分派（布尔=断言、其他=detail）。v0.8.3 之前它是无条件打勾的，导致历史上一批 `ok(label, 布尔)` 断言全是假绿 —— 写新断言一律 `cond ? ok(label) : bad(label)`。

**工具**：`latex_compile`、`latex_status`、`latex_synctex`、`latex_clean`、`latex_outline`。

## 3. 安装、生效与自测

```
plugin_manager install_bundle  E:\E_个人项目\Latex_APP\dsh-plugin-moling-latex
```

- 同版本已装会返回 `already-installed`：先 `remove_bundle`（同名）再 `install_bundle`。
- **改动生效规则**：`lib/client.js` 走 HMR，刷新页面即可；`lib/index.js`、`lib/server.js`、`package.json`、`cordis.patch.yml` **必须重开 DSH**。
- 验收看 `install_bundle` 的 `application`（要 `applied`）+ `warnings`，并用 `cordis_inspect_query` 查 Tool / `Slots.listSubTree(root='sidebar.right.pane.tab')` 看 occupant 是否 `active`。**不要**用 `list_plugins` 日志或页面猜测。

自测（当前基线 **13 + 59 + 455 = 527 项全绿**）：

```
cd dsh-plugin-moling-latex
node test/smoke.mjs            # 工具：注册/引擎识别/status/outline/quick/失败路径 + 相对路径不依赖会话 cwd（13）
node test/server-smoke.mjs     # 宿主 /moling/api：17 端点 + 白名单 + 读写 + 编译 + PDF + asset + synctex + outline + stat 外部改动探测 + 辅助文件进树 + 模板清单/落地（含二进制与重名换目录）（59）
node test/client-smoke.mjs     # 浏览器半侧：bundle/槽位/SSR/词法/路径/PDF/编辑器/顶栏分组与统一高度/分组配色/分隔线/开关两态样式/保存分体按钮（手动·自动）/自编/文件大纲/连接状态/主 tex 判定（main/最近/唯一/根目录/最大）/切换项目关闭旧文件/外部改动自动同步（tree 通道/指示灯/失败可见）/改动行标绿 diff/同步不被标绿拖垮/视口不跳与行号换算/回归（自动打开不被轮询关掉、发送选区、跳转可见）/适应窗口/圆角统一/hook 顺序/模板库（清单/搜索/分类/落地/弹窗固定尺寸）/LaTeX 自动补全（命令/环境/引用/宏包 + 补全源只造一次）/启动页墨灵 logo/文件树自适应尺寸/**会话隔离**/文件树·文件大纲改名与进项目不开树/**行号列收窄**（455）
node test/live-api.mjs         # 对正在运行的 DSH 打真实 HTTP（端口取 DSH_WEB_URL）
```

## 4. 已踩过的坑（改之前先读，别再犯）

1. **profile 的 `dsh.profile.bundles` 会被重写**：用 `dsh plugin add`（或插件市场）装别的插件后，手写进去的 bundle 行会丢，插件"突然消失"（症状：右栏没卡片、`/moling/api/ping` 404）。→ 先看 `~/.dsh/profiles/desktop/package.json` 的 `bundles`，缺了就重装。`dsh-plugin-novel-studio` 就这样中过招。
2. **不要用 `ctx.get('connection').rpc` 传面板数据**：第三方文件插件没有 Connection RPC 的注册入口（`host.call` 只给动态插件）。同机 `dsh-drawai` 用 `fetch('/drawai/api/save')`，本插件照此实现，实测可用。
3. **主题 token 名字要对**：真实变量是 `--dsw-alias-{bg-base,bg-layer-1,bg-layer-2,bg-overlay,border-l1,border-l2,brand-primary,label-primary,label-secondary,state-{error,warn,success,idle}-primary}`。`--dsw-alias-line`、`--dsw-alias-label-tertiary` **不存在**，写了会静默落到硬编码兜底色 → 不跟深色主题。
4. **不要写死 `color:#fff` 或实心 accent 填充**：深色主题下 accent 可能是浅色，白底白字会看不清。主按钮用「中性底 + accent 边框 + 主题文字色」。
5. **`open-file` 只认绝对路径**：相对路径会按 DSH 进程 cwd 解析（`…\profiles\desktop\xxx.tex`）而报"文件不存在"。最近文件记录里同时存 `value`（相对）与 `abs`（绝对），老记录用 `root + value` 补全。
6. **编辑器主路径是 CodeMirror 6**（`lib/vendor/cm6.js`，宿主 `asset` 端点发出来，浏览器动态加载；只渲染视口内的行）。**别再回到纯 `<textarea>` 全量渲染**：1435 行文档实测每次按键 17–23 ms，一打字全机卡。回退实现（透明 textarea 叠高亮层）仍在，只在核载不出来时兜底；回退路径里两层宽度**必须恒等**：textarea 用 `scrollbar-gutter: stable` 永久预留滚动条槽，高亮层按探测量补 `padding-right`（差异 = 两成换行点不同 → 光标与字形错位、删错字）。
7. **`keepMounted: true` 的双刃**：切走再回来不会丢编辑位置，但也意味着"每次进来先看启动页"只在首次挂载/刷新后发生；要回启动页点「首页」。
8. **不要把令牌写进任何文件**：`.gh_token` 从不落盘；`.git/config`、remote URL 里都不能出现 `ghp_`。
9. **PDF 预览走栅格化图片，不是内置阅读器**：`pdf-page` 返回 `{ __bytes, __type }`，由 handler 直接写二进制（加新二进制端点照这个约定）；PNG 在 `%TEMP%\dsh-moling-pdf`，键 = 绝对路径 + PDF mtime + dpi + 页码 —— 改了 PDF 不换 mtime 就会看到旧图。`pdf` 端点带 `meta: true` 时**不要**再回 base64（48MB 的 PDF 转 base64 是 64MB 字符串）。poppler 缺失或取图失败自动退回 iframe，所以「预览空白」先看预览区底部状态条。
10. **别用 PowerShell 的 `Get-Content`/`Set-Content` 改带中文的文件**：本机 `Get-Content -Raw` 会按 GBK 解码 UTF-8，写回就是双重编码的乱码（`澧ㄧ伒TeX`）。改文件一律用编辑工具（读写 UTF-8）；被写坏就用 `git checkout -- <file>` 还原再重改。
11. **副作用里抛异常 = 右栏整块空白**：React 会把整棵子树卸掉，症状就是「插件界面没了」（标签页还在、下面空的）。真实案例：`ResizeObserver.observe(textareaRef.current)` 在没打开 tex 时传的是 `null` → 抛 `parameter 1 is not of type 'Element'`。规矩：effect 里访问 ref 一律先判空；`Body` 外面套了 `PaneBoundary`，出错会画出错误文本而不是空白 —— 看到那段文字就把它贴给 agent。
12. **hook 必须写在组件所有提前 `return` 之前**（React #310「Rendered more hooks than during the previous render」）。真实案例：`PdfPane` 的 Ctrl+滚轮 `useEffect` 原本写在 `if (!store.pdfRel) return` 之后 → 首次编译「没 PDF → 有 PDF」时 hook 从 3 变 4，整块崩（PaneBoundary 画出 #310，回首页重进就好）。已挪到顶部并加了源码扫描回归（client-smoke 第 16 节）。
13. **PDF 页容器（`pdfPageBox`）不能加 `maxWidth:'100%'`**：它会把 `width:(100*zoom)%` 卡死在容器宽 → 100% 之后再放大只有百分比数字在涨、页面纹丝不动。放大要能溢出容器（`pdfScroll` 是 `overflow:auto`，横向拖动即可），回归断言见 client-smoke「不再被 maxWidth 卡死」。
14. **Windows 目录 mtime 粒度约 15ms，别拿它当「目录变没变」的唯一依据**：`stat` 端点的目录指纹一开始只算 `rel:mtime`，结果同一毫秒里「建了又删」算出同一个指纹 → server-smoke 的「删除后指纹没变」间歇性红。现在指纹里还带**这一层的名字表**（`rel:mtime:名字,…`）：增删改名看名字、同名替换看 mtime、只改文件内容指纹不变（不白刷文件树）。
15. **内核 `setDoc` 会照常触发 `onChange`（entry.js 注释写"不触发"是错的）**：外部同步推文档 → `onChange` → `setTab({dirty:true})` → **第一次同步就把标签弄脏** → 之后每次外部改动都被 `reloadTab` 的「有未保存改动」拦住，症状是**"同步突然不工作了、标绿也没了"**。修法：`setDoc` 前把预期文本记进 `suppressDirtyText`，`onChange` 撞上同一份文本就只更新不标脏（`suppressDirtyText` 在 [lib/client.js](dsh-plugin-moling-latex/lib/client.js)）。同理，**标绿这类配菜必须排在 `setTab` 之后并自带 try**，别让它反过来吞掉同步主链路。
16. **别用「移除 longhand」来关高亮**：`S.btnFlat` 是 `border` 简写，`S.btnOn` 只给 `borderColor` 长写 → 两态切换靠 React 删 `borderColor`，React 直接警告 "Removing a style property during rerender (borderColor) when a conflicting property is set (border)"，实际表现就是**开关关了、那圈"开着"的框不消失**。现在统一走 `toggleBtnStyle(on)`：开/关都显式写完整 `border` + `color`；`btnFlat` 另加 `outline:'none'`（否则点过的开关会留浏览器焦点白圈）。回归断言在 client-smoke 第 26 节。

## 5. Git / 发布

- 插件仓库：`https://github.com/dichi123456/dsh-molingTex`（Public，`main`），本地 `origin` 已连，`main` 跟踪 `origin/main`。
- 推送免登录已配好：`git config --global credential.helper manager`（+ `credential.https://github.com.helper manager`），凭据在 Windows 凭据管理器里，账号 `dichi123456`。**换账号**：`"protocol=https`nhost=github.com`n`n" | git credential reject`。
- 日常：`cd dsh-plugin-moling-latex && git add -A && git commit -m "…" && git push`。
- **发版**（本机没装 `gh`，走 GitHub API；token 用 `git credential fill` 现取、**不落盘**）：
  1. 改 `package.json` 的 `version`，README 的「指定版本」链接同步到新版本；
  2. `git add -A && git commit -m "release: vX.Y.Z（一句话摘要）"` → `git push`；
  3. `git tag vX.Y.Z <提交> && git push origin vX.Y.Z`；
  4. `npm pack --pack-destination $env:TEMP` 出 `dsh-plugin-moling-latex-X.Y.Z.tgz`（340 KB / 13 文件）；
  5. `POST /repos/…/releases`（tag_name/name/body）→ `POST <upload_url>?name=…tgz`（`Content-Type: application/octet-stream` + `-InFile`）；
  6. 复核：`GET /repos/…/releases/tags/vX.Y.Z` 看资产，再对下载链接发 HEAD（要 200 且字节数一致）。**发版后要改 AGENTS/README 就得再提交一次**，别让文档落后于已发的版本。
- 提交署名用 `dichi123456 <dichi123456@users.noreply.github.com>`；许可证 MIT（版权 `dichi123456`）。
- 仓库里不要放：`node_modules`、编译产物、`*.token`、`.gh_token`（`.gitignore` 已覆盖）。

## 6. 尚未完成 / 下一步

- **编辑器**：已经是 CodeMirror 6（虚拟化、行号、搜索、撤销、**LaTeX 自动补全**都有）；还差的只有 **代码折叠**（`foldGutter`/`foldKeymap` 已在 basicSetup 里，缺的是按 `\begin{...}\end{...}` 生成 foldable range 的 `foldService`，要改 `lib/vendor/entry.js` 重建 cm6.js）。

## 7. 约定

- **回复风格：`/caveman ultra` 常驻**（用户 2026-11-11 明确要求，**任何新窗口/新会话都照此**）：极简——砍冠词/连接词/客套/垫话，用箭头表因果（X → Y），一个词够就别写两个；**技术内容不砍**，代码块、报错原文、提交信息、破坏性操作确认照常写全。仅当用户说「stop caveman」或「normal mode」才恢复。
- 注释、UI 文案、提交信息用中文；提交信息一句一行、`feat:/fix:/docs:` 前缀。
- 插件以 `link:` 装在 `~/.dsh/profiles/desktop`，**不要手改 profile 的 `package.json`/`cordis.patch.yml`，也不要在 profile 目录跑 pnpm**——一律走 `plugin_manager`。
- 桌面版（`src/`、`electron/`）与插件是两套代码：改插件不要动桌面版；反之亦然。
