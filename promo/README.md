# 宣传片素材（mock 截图）

用途：给 `dsh-molingTex` 插件做 Remotion / HTML 视频的宣传素材。
**全部是 mock**：`mock.html` 用 CSS 复刻插件真实样式（颜色、圆角、字号、卡片阴影、状态栏排版都取自 `lib/client.js`），
再用无头 Edge 以 2x 渲染成 PNG，因此不含任何真实文件/路径/隐私内容。

## 重新生成

```bash
cd promo
node shoot.cjs       # 输出到 promo/shots/*.png（1440x900 @2x = 2880x1800）
```

单张预览：`file:///<repo>/promo/mock.html?s=03-workbench`（`s=` 见下表）。

## 已成素材

| 文件 | 场景 | 画面 |
| --- | --- | --- |
| `01-overview.png` | DSH 全局 | 左会话 + 右墨灵工作台，标题栏显示 `A-DSH-molingTex-illustration` |
| `02-welcome.png` | 启动页 | 启动动作行 / 最近列表（含演示项目）/ 模板卡片 / 右侧提示 |
| `03-workbench.png` | 工作台全景 | 左 tex 右 PDF，顶栏全按钮 + 连接胶囊 + 分体编译，底部绿字编译结果 |
| `04-editor.png` | 编辑器特写 | 15px 放大字号、行号、注释/命令/环境/数学着色 |
| `05-compile.png` | 编译控件 | 分体按钮（快速编译）+ 展开的方式菜单 |
| `06-pdf-zoom.png` | 预览缩放 | 200% 放大裁切 + 右下 `200%` |
| `07-context.png` | 右键菜单 | 撤销/重做 → 剪切…全选 → 发送选中内容 → 定位到 PDF |
| `08-synctex.png` | 双向定位 | PDF 页上黄圈 + 状态栏 `第 16 行 → 第 1 页` |
| `09-outline.png` | 提纲 | 左下角提纲卡片（层级缩进 + 行号） |
| `10-tree.png` | 文件树 | 卡片式文件树（过滤框 + `18 个` + 选中 main.tex） |
| `11-connect.png` | 连接状态 | `已连接 DSH 工作区`（绿）与 `未连接`（灰）两种胶囊放大对比 |
| `12-send.png` | 发给 AI | 对话输入框里出现 `来自 main.tex 第 16–18 行` + latex 代码块 |

## 规格

- 2880×1800（1440×900 的 2x），16:9；深色主题；PNG
- 演示项目统一叫 `A-DSH-molingTex-illustration`，论文内容为虚构的 platoon 控制论文
- 需要竖屏（9:16）版本时，改 `mock.html` 的 `html,body{width/height}` 与 `shoot.cjs` 的 `--window-size` 即可

## 分镜到镜头的对应建议

| 视频段落 | 用哪几张 |
| --- | --- |
| 开场 hook | `01` → `03` |
| 开局体验 | `02` |
| 编辑与编译 | `04` → `05` → `03`（绿字） |
| 预览 | `06` |
| 双向定位 | `07` → `08` |
| 结构与导航 | `09` → `10` |
| AI 联动 | `11` → `12` |
