# 墨灵 LaTeX DSH 插件 · 宣传片（90s / 16:9 / 旁白 + 字幕）

- 工程：`E:\E_个人项目\车辆动力学软件\remotion-demo`（Remotion 4.0.542）
- 合成：`MolingPromo`（1920×1080，30fps，2699 帧 ≈ 89.97s）
- 素材：`public/shots/*.png`（来自 `Latex_APP/promo/shots`，2880×1800）
- 旁白：`public/voice/scene-01..12.wav`（Windows SAPI，Microsoft Huihui zh-CN）
- 输出：`out/moling-promo.mp4`

## 分镜（时长跟旁白走，画面切入切出各 8 帧淡入淡出）

| # | 秒 | 场景 | 字幕 / 旁白 |
| --- | --- | --- | --- |
| 01 | 8.06 | DSH 全局 | DSH 右侧栏，直接开一个 LaTeX 工作台。左边写 tex，右边看 PDF。 |
| 02 | 6.60 | 启动页 | 打开就是启动页。最近的项目、最近的文件，点一下就进。 |
| 03 | 7.21 | 工作台 | 编译结束后，底部状态栏给你结果。几秒、几趟，一眼看清。 |
| 04 | 6.75 | 编辑器 | 编辑器是 CodeMirror 6。虚拟化渲染，几千行文档打字也不卡。 |
| 05 | 7.86 | 编译 | 编译方式合成一个按钮。选完整、快速、从头，只点一下就开始。 |
| 06 | 7.99 | PDF 预览 | PDF 不走浏览器阅读器，而是逐页预渲染。Ctrl 加滚轮，随手缩放。 |
| 07 | 8.11 | 右键菜单 | 右键菜单，复制粘贴都还在。多了两项：发进对话，或者定位到 PDF。 |
| 08 | 7.90 | 双向定位 | 双击式定位换成右键。黄圈落在页面上，状态栏告诉你第几行到第几页。 |
| 09 | 6.52 | 提纲 | 提纲浮在左下角。章节层级和行号，点一条就跳过去。 |
| 10 | 7.36 | 文件树 | 文件树也是卡片，浮在编辑区上。过滤、拖宽度，不打断写作。 |
| 11 | 7.84 | DSH 联动 | 顶部胶囊告诉你，这个项目有没有进 DSH 工作区。灰的点一下就加进去。 |
| 12 | 7.75 | 发给 AI | 选中一段公式，右键发给 AI。行号和代码块自动带上，接着就能改。 |

## 画面版式

- 前层：截图 `object-fit: contain`，Ken Burns 缓慢推近（1.03→1.10）+ 交替平移
- 底层：同图 `cover` + `blur(30px)` 压暗，补 16:10 截图进 16:9 画幅的两侧
- 底部居中字幕（42px），左下「序号 + 场景名 + 产品名」，右下仓库地址，最底进度条

## 重新出片

```bash
cd "E:\E_个人项目\车辆动力学软件\remotion-demo"
npx remotion studio                 # 预览
npx remotion render src/index.jsx MolingPromo out/moling-promo.mp4
```

改旁白：编辑 `E:\E_个人项目\Latex_APP\promo\narration.cjs` 的 `LINES` → `node narration.cjs` 重新合成 WAV，
再把新时长填进 `src/MolingPromo.jsx` 的 `seconds`。
