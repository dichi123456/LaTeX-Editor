<div align="center">

# 墨灵TeX

**本地 · 轻量 · AI 驱动的 Windows LaTeX 桌面编辑器**

编辑 · 编译 · 预览 · AI 助手 — 一体化工作流，无需浏览器

![Version](https://img.shields.io/badge/version-2.0.0-blue)
![Platform](https://img.shields.io/badge/platform-Windows-lightgrey)
![Electron](https://img.shields.io/badge/Electron-33-black)
![Vue](https://img.shields.io/badge/Vue-3-green)
![License](https://img.shields.io/badge/license-MIT-green)

</div>

---

## 为什么选择 墨灵TeX？

对比 Overleaf、TeXstudio 等主流工具，本编辑器在以下方面提供了独特价值：

| 特性 | 墨灵TeX | Overleaf | TeXstudio |
|------|---------|----------|-----------|
| **完全本地运行** | ✅ 数据不出本机 | ❌ 云端存储 | ✅ |
| **无需注册/联网** | ✅ 开箱即用 | ❌ 需账号+网络 | ✅ |
| **AI 助手集成** | ✅ 内置「墨灵」 | ⚠️ 付费功能 | ❌ |
| **AI 可读写项目文件** | ✅ Agent 模式 | ❌ | ❌ |
| **中文开箱优化** | ✅ ctex + 系统字体 | ⚠️ 需手动配置 | ⚠️ |
| **安装包体积** | ~97 MB | — | ~80 MB |
| **内存占用** | < 200 MB | 浏览器标签页 | ~300 MB |
| **SyncTeX 同步** | ✅ 双击双向 | ✅ | ✅ |
| **免费开源** | ✅ MIT | ❌ 部分收费 | ✅ |

### 核心优势

- **真正本地**：所有文件、编译、AI 对话均在本机完成，适合涉密论文和离线场景
- **AI 深度集成**：内置「墨灵」AI 助手，可直接读取、修改项目文件，编译验证，而非仅聊天
- **中文友好**：默认 XeLaTeX + ctex 宏集 + Windows 系统字体，中文论文开箱即用
- **极简界面**：VS Code 风格菜单栏 + 四区域面板化布局（工作区 / 编辑器 / PDF 预览 / AI）

---

## 功能特性

### 编辑器
- CodeMirror 6 驱动，LaTeX 语法高亮、行号、语义代码折叠
- 智能缩进：`\begin{}` 自动缩进、`\end{}` 自动回退
- 智能补全：命令、环境、`\cite{}` 引用键、`\ref{}` 标签、`\includegraphics{}` 项目图片
- 多光标：Alt+Click、Ctrl+D、矩形选择
- 查找替换：正则、区分大小写、匹配计数、双向导航
- 多标签页，支持拖拽排序、中键关闭
- 双击 / Ctrl+Click 双向 SyncTeX 跳转 PDF

### 编译
- 一键编译（F5），支持 XeLaTeX / pdfLaTeX / LuaLaTeX / latexmk
- 三种编译模式：快速编译、完整编译（bibtex 四次流程）、从头编译
- TeX Live 自动检测，未找到时引导手动配置
- 编译日志面板：错误/警告过滤、点击跳转源码行
- 重编译后 PDF 预览自动刷新

### PDF 预览
- 内嵌 PDF.js，垂直连续滚动，Ctrl+滚轮缩放
- 目录/大纲导航、适应宽度/页面、页码跳转、页面旋转
- SyncTeX 正反向同步：双击或 Ctrl+Click 互相跳转
- 多 PDF 标签页，支持从文件树直接打开

### 墨灵 AI 助手
- 对接 DeepSeek / OpenAI / Moonshot 等兼容 API
- **Agent 模式**：AI 可自主读写项目文件、搜索内容、编译文档
- **局部编辑**：`replace_text` 精准替换，无需重写整个文件
- **行号定位**：选中文本自动附带行号，AI 直接定位不重读全文
- **实时刷新**：AI 修改文件后编辑器立即更新
- 支持中断生成、多模型切换、Markdown/LaTeX 渲染

### 其他
- 品牌名「墨灵TeX」，自定义应用图标
- VS Code 风格顶部菜单（文件下拉 / 命令 / 设置）
- 自动保存、关窗未保存警告、窗口标题跟随文件名
- 深色/浅色/跟随系统主题
- 命令面板（Ctrl+Shift+P）
- 大纲导航、BibTeX 引用扫描、项目图片扫描
- 5 套内置中文模板（论文/实验报告/简历/Beamer/英文论文）
- 无边框窗口，自定义标题栏

---

## 快速开始

### 下载安装

从 [Releases](../../releases) 下载最新版本：

- **安装版**：`MolingTeX-Setup-2.0.0.exe` — 双击安装
- **便携版**：`MolingTeX-2.0.0-win.zip` — 解压即用
- 直达：[Release v2.0.0](https://github.com/dichi123456/LaTeX-Editor/releases/tag/v2.0.0)

### 环境要求

| 组件 | 要求 |
|------|------|
| 操作系统 | Windows 10 / 11 (x64) |
| TeX 发行版 | **TeX Live 2024**（或 2022/2023、MiKTeX） |
| AI 功能 | 可选，需自备 DeepSeek / OpenAI 等 API Key |

### 配置 TeX Live

启动后右上角会显示 TeX Live 检测状态：

- **TeX Live ✓**：已自动检测到
- **TeX Live ✗**：点击「设置」→ 手动指定路径，如 `C:\texlive\2024\bin\windows`

### 配置墨灵 AI（可选）

设置 → 墨灵 AI 助手：
1. 填入 API 地址（如 `https://api.deepseek.com/v1`）
2. 填入 API Key
3. 点击「获取模型」→ 勾选要启用的模型
4. 保存设置

---

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| `F5` | 编译文档 |
| `Ctrl+S` | 保存 |
| `Ctrl+O` | 打开文件 |
| `Ctrl+N` | 新建文件 |
| `Ctrl+K` | 打开文件夹 |
| `Ctrl+B` | 切换文件树 |
| `Ctrl+J` | 切换底部面板 |
| `Ctrl+F` | 查找 |
| `Ctrl+H` | 替换 |
| `Ctrl+Shift+P` | 命令面板 |
| `Ctrl+,` | 设置 |
| `F11` | 全屏编辑 |
| 双击 / `Ctrl+Click` | SyncTeX 双向跳转 |
| `Alt+Click` | 添加多光标 |
| `Ctrl+D` | 选中相同词 |
| `Ctrl+/` | 注释切换 |
| `Ctrl+滚轮` | 缩放字号 / PDF |

---

## 开发

```bash
# 克隆仓库
git clone https://github.com/dichi123456/LaTeX-Editor.git
cd LaTeX-Editor

# 安装依赖
pnpm install

# 开发模式
pnpm dev

# 构建
pnpm build

# 打包 (exe + zip)
pnpm build:win
```

### 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | Electron 33 |
| 前端框架 | Vue 3 + TypeScript |
| 代码编辑器 | CodeMirror 6 |
| PDF 预览 | PDF.js |
| SyncTeX | 官方 synctex CLI |
| 状态管理 | Pinia |
| 构建工具 | electron-vite |

---

## 常见问题

**Q: 编译报「未找到 xelatex」？**
确认已安装 TeX Live，且 `xelatex` 在 PATH 中，或在设置中手动指定 bin 目录。

**Q: 中文编译乱码？**
默认使用 XeLaTeX + ctex，需确保系统安装了宋体/雅黑/仿宋。可在导言区修改 `\setCJKmainfont`。

**Q: 双向同步不工作？**
需先编译一次生成 `.synctex.gz`。编辑器/PDF 双击即可跳转；若仍失败，检查编译日志中是否有 `[SyncTeX]` 提示。

---

## 许可证

[MIT](LICENSE)

---

<div align="center">
  <sub>Built with ❤️ for LaTeX writers · 墨灵TeX</sub>
</div>
