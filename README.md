# LaTeX编辑器

本地 LaTeX 文档**编辑 · 编译 · 预览**一体化 Windows 桌面应用。

基于 Electron + Vue 3 + CodeMirror 6 + PDF.js，调用本机 TeX Live 2024 进行编译，不内置 TeX 发行版。

## 功能特性

- **代码编辑**：LaTeX 语法高亮、行号、括号匹配、自动补全（命令 / 环境 / 引用 / 标签 / 宏包）
- **一键编译**：F5 调用 XeLaTeX / pdfLaTeX / LuaLaTeX / latexmk，实时日志
- **错误定位**：编译错误按行高亮，点击跳转到源码对应行，中文友好错误解释
- **PDF 预览**：内嵌 PDF.js，缩放 / 翻页 / 适应宽度 / 适应页面，外部打开 / 导出
- **文件管理**：多标签页、文件树、新建 / 重命名 / 删除、最近文件
- **中文模板**：内置中文论文、实验报告、中文简历、Beamer 幻灯片、英文论文模板
- **TeX Live 检测**：自动检测 PATH 与常见安装路径，支持手动指定
- **深色 / 浅色主题**，设置持久化到用户目录

## 环境要求

| 组件 | 要求 |
|------|------|
| 操作系统 | Windows 10 / 11（x64） |
| TeX 发行版 | **TeX Live 2024**（或 2022/2023、MiKTeX），需包含 `xelatex` |
| Node.js | 18+（仅开发构建需要） |

## 快速开始（开发）

```powershell
# 1. 安装依赖
pnpm install

# 2. 开发模式（热更新）
pnpm dev

# 3. 生产构建
pnpm build

# 4. 打包 Windows 安装包 / 便携版
pnpm build:win
```

> 也可使用 `npm run dev` / `npm run build`（需先安装 pnpm 或改用 npm）。

## 打包产物

`pnpm build:win` 后在 `release/` 目录生成：

- **NSIS 安装包**（`.exe`）：支持选择安装路径、创建桌面/开始菜单快捷方式
- **绿色便携版**（`.zip`）：解压即用

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| `F5` | 编译文档 |
| `Ctrl+S` | 保存 |
| `Ctrl+O` | 打开文件 |
| `Ctrl+N` | 新建文件 |
| `Ctrl+K` | 打开文件夹 |
| `Ctrl+B` | 切换文件树 |
| `Ctrl+J` | 切换编译日志 |
| `Ctrl+,` | 设置 |
| `F11` | 专注模式（全屏编辑） |
| `Ctrl+F` / `Ctrl+H` | 查找 / 替换（编辑器内） |

## TeX Live 配置

1. 安装 [TeX Live 2024](https://tug.org/texlive/)
2. 启动应用后自动检测；若未检测到，在 **设置 → 编译 → TeX Live 路径** 中手动指定，例如：
   ```
   C:\texlive\2024\bin\windows
   ```
3. 留空则使用系统 `PATH` 中的编译器

## 项目结构

```
latex-editor/
├── electron/              # Electron 主进程
│   ├── main.ts            # 窗口、菜单、IPC
│   ├── preload.ts         # contextBridge 暴露 API
│   ├── compiler.ts        # xelatex 等编译调用与日志解析
│   ├── texlive.ts         # TeX Live 路径检测
│   ├── config.ts          # 用户配置持久化
│   └── file.ts            # 文件读写 / 目录 / 最近文件
├── src/                   # Vue 渲染进程
│   ├── components/        # 编辑器、预览、文件树、日志等
│   ├── stores/            # Pinia（文档 / 编译 / 配置）
│   ├── utils/             # LaTeX 补全
│   ├── templates/         # 内置中文模板
│   └── App.vue
├── electron.vite.config.ts
└── package.json
```

## 常见问题

**Q: 提示「未检测到 TeX Live」？**  
确认已安装 TeX Live，且 `xelatex` 在 PATH 中，或在设置中手动指定 `bin\windows` 路径。

**Q: 编译中文文档乱码 / 字体错误？**  
默认模板使用 XeLaTeX + `ctex`，并指定 Windows 系统字体（宋体/雅黑/仿宋）。请确认系统已安装这些字体，或在导言区修改 `\setCJKmainfont`。

**Q: PDF 预览空白？**  
先确认编译成功（日志面板显示「编译成功」）。若仍空白，尝试「外部 PDF」按钮用系统阅读器打开。

## 许可证

MIT
