# 项目记忆（AGENTS.md）

> 给在本目录工作的 agent：这里是「墨灵TeX」桌面版 + 其 **DSH 插件**所在项目。
> 只记结论与坑；实现细节以各自 README 为准。本文件由 DSH 的 workspace instructions 自动注入。

## 1. 项目构成

| 路径 | 是什么 | 状态 |
| --- | --- | --- |
| `src/` `electron/` `index.html` | 墨灵TeX 桌面版：Electron 33 + Vue 3 + CodeMirror 6 + PDF.js | v2.0.2；远端 `dichi123456/LaTeX-Editor`（本仓库 origin 经 ghproxy 中转） |
| `dsh-plugin-moling-latex/` | 墨灵TeX 的 **DSH 插件**，**独立 git 仓库** | v0.3.0；已推到 `dichi123456/dsh-molingTex`（Public，main） |

父仓库 `.gitignore` 已忽略 `dsh-plugin-moling-latex/`，避免把它当嵌套仓库提交。
插件源码目录本身也是 DSH profile 里 `link:` 安装的目标目录。

## 2. 插件形态（v0.3.0，重做后的确定设计）

**两个半侧**

- 宿主半侧：`lib/index.js`（5 个 Agent 工具 + 注册路由）、`lib/server.js`（与传输无关的操作表 `createPanelCore` + `/moling/api` 适配器）、`lib/latex.js`（引擎探测/编译流程/日志解析/清理/大纲）、`lib/synctex.js`。
- 浏览器半侧：`lib/client.js`（经典脚本，`window.__ModuleLoader__.load` 注册；除 `react` 外不 require 任何模块）。

**界面位置：DSH 右侧栏标签页**（不是左栏图标，也不是主面板）

```js
ctx.sidebarRightTabs.register({ id, kind: 'moling', title, guide: [{ order: 40, title, description }], keepMounted: true })
ctx.slots.register({ name: 'sidebar.right.pane.tab', key: ID }, Body)
```

- 启动页（每次进入先落这里）：大标题 + 「启动」动作行（新建文档 Ctrl+N / 打开文件夹 Ctrl+K / 打开文件 Ctrl+O）+「最近」列表（工作区/文件，带类型标签与右对齐路径）+ 模板卡片 + 右侧提示栏；**不自动打开任何工作区**。
- 工作台：左 tex（高亮 + 行号 + 软换行）| 右 日志/PDF，中间**分隔条可拖**（20%–80%）；文件树是浮层抽屉，右边框**可拖**（30%–100%）；编译状态与错误显示在**预览区底部**。
- 状态放**模块级 store**（组件卸载/重建不丢）+ localStorage（只存最近打开/引擎/模式/过滤词/两个分栏宽度）。

**通道：同源 `fetch('/moling/api/<endpoint>')`**，11 个端点：
`ping status workspaces open-root open-file tree read-file write-file compile clean pdf`，
一律返回 `{ ok: true, value }` / `{ ok: false, error }`。

**工具**：`latex_compile`、`latex_status`、`latex_synctex`、`latex_clean`、`latex_outline`。

## 3. 安装、生效与自测

```
plugin_manager install_bundle  E:\E_个人项目\Latex_APP\dsh-plugin-moling-latex
```

- 同版本已装会返回 `already-installed`：先 `remove_bundle`（同名）再 `install_bundle`。
- **改动生效规则**：`lib/client.js` 走 HMR，刷新页面即可；`lib/index.js`、`lib/server.js`、`package.json`、`cordis.patch.yml` **必须重开 DSH**。
- 验收看 `install_bundle` 的 `application`（要 `applied`）+ `warnings`，并用 `cordis_inspect_query` 查 Tool / `Slots.listSubTree(root='sidebar.right.pane.tab')` 看 occupant 是否 `active`。**不要**用 `list_plugins` 日志或页面猜测。

自测（当前基线 **12 + 21 + 64 = 97 项全绿**）：

```
cd dsh-plugin-moling-latex
node test/smoke.mjs            # 工具：注册/引擎识别/status/outline/quick/失败路径（12）
node test/server-smoke.mjs     # 宿主 /moling/api：11 端点 + 白名单 + 读写 + 编译 + PDF（21）
node test/client-smoke.mjs     # 浏览器半侧：bundle/槽位/传输/SSR/词法/路径（64）
node test/live-api.mjs         # 对正在运行的 DSH 真实 HTTP（端口取 DSH_WEB_URL）
```

## 4. 已踩过的坑（改之前先读，别再犯）

1. **profile 的 `dsh.profile.bundles` 会被重写**：用 `dsh plugin add`（或插件市场）装别的插件后，手写进去的 bundle 行会丢，插件"突然消失"（症状：右栏没卡片、`/moling/api/ping` 404）。→ 先看 `~/.dsh/profiles/desktop/package.json` 的 `bundles`，缺了就重装。`dsh-plugin-novel-studio` 就这样中过招。
2. **不要用 `ctx.get('connection').rpc` 传面板数据**：第三方文件插件没有 Connection RPC 的注册入口（`host.call` 只给动态插件）。同机 `dsh-drawai` 用 `fetch('/drawai/api/save')`，本插件照此实现，实测可用。
3. **主题 token 名字要对**：真实变量是 `--dsw-alias-{bg-base,bg-layer-1,bg-layer-2,bg-overlay,border-l1,border-l2,brand-primary,label-primary,label-secondary,state-{error,warn,success,idle}-primary}`。`--dsw-alias-line`、`--dsw-alias-label-tertiary` **不存在**，写了会静默落到硬编码兜底色 → 不跟深色主题。
4. **不要写死 `color:#fff` 或实心 accent 填充**：深色主题下 accent 可能是浅色，白底白字会看不清。主按钮用「中性底 + accent 边框 + 主题文字色」。
5. **`open-file` 只认绝对路径**：相对路径会按 DSH 进程 cwd 解析（`…\profiles\desktop\xxx.tex`）而报"文件不存在"。最近文件记录里同时存 `value`（相对）与 `abs`（绝对），老记录用 `root + value` 补全。
6. **编辑器是「透明 textarea 叠在高亮层上」**：两层必须同字体/同字号/同行高/同 `pre-wrap`；行号画在高亮层里（行 `paddingLeft:56 + textIndent:-48`、行号 span 宽 48、textarea `padding-left:56`），否则软换行后对不齐。大文件用行级缓存（`buildHighlight`）避免每敲一键全量重排。
7. **`keepMounted: true` 的双刃**：切走再回来不会丢编辑位置，但也意味着"每次进来先看启动页"只在首次挂载/刷新后发生；要回启动页点「首页」。
8. **不要把令牌写进任何文件**：`.gh_token` 从不落盘；`.git/config`、remote URL 里都不能出现 `ghp_`。

## 5. Git / 发布

- 插件仓库：`https://github.com/dichi123456/dsh-molingTex`（Public，`main`），本地 `origin` 已连，`main` 跟踪 `origin/main`。
- 推送免登录已配好：`git config --global credential.helper manager`（+ `credential.https://github.com.helper manager`），凭据在 Windows 凭据管理器里，账号 `dichi123456`。**换账号**：`"protocol=https`nhost=github.com`n`n" | git credential reject`。
- 日常：`cd dsh-plugin-moling-latex && git add -A && git commit -m "…" && git push`。
- 提交署名用 `dichi123456 <dichi123456@users.noreply.github.com>`；许可证 MIT（版权 `dichi123456`）。
- 仓库里不要放：`node_modules`、编译产物、`*.token`、`.gh_token`（`.gitignore` 已覆盖）。

## 6. 尚未完成 / 下一步

- **SyncTeX 双击跳转**（源码行 ↔ PDF 位置）：工具侧 `latex_synctex` 已可用，只差前端绑定（编辑器双击 → 取 `page`；PDF 点击 → 取 `line`）。
- **模板库**：把 `src/templates/` 那批 `.tex` 通过宿主端点暴露给启动页的「模板」卡片（现在只有 ctexart 骨架）。
- **编辑器**：目前是纯 `<textarea>` + 自研词法高亮，没有 CodeMirror 的折叠/多光标；如需升级要把 CodeMirror 打进 client bundle（不能 import 其它 `@deepseek-ai/dsh-client-*`，bundle 纯净门禁止）。

## 7. 约定

- 注释、UI 文案、提交信息用中文；提交信息一句一行、`feat:/fix:/docs:` 前缀。
- 插件以 `link:` 装在 `~/.dsh/profiles/desktop`，**不要手改 profile 的 `package.json`/`cordis.patch.yml`，也不要在 profile 目录跑 pnpm**——一律走 `plugin_manager`。
- 桌面版（`src/`、`electron/`）与插件是两套代码：改插件不要动桌面版；反之亦然。
