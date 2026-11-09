// 用无头 Edge 把 promo/mock.html 的每个分镜截成 2x PNG
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const EDGE = process.env.EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const root = 'E:/E_个人项目/Latex_APP/promo'
const outDir = path.join(root, 'shots')
fs.mkdirSync(outDir, { recursive: true })

const scenes = [
  ['01-overview', 'DSH 全局：左会话 / 右墨灵工作台'],
  ['02-welcome', '墨灵启动页：启动 / 最近 / 模板'],
  ['03-workbench', '工作台全景：tex | pdf + 状态栏编译结果'],
  ['04-editor', '编辑器特写：语法高亮 + 行号'],
  ['05-compile', '编译分体按钮 + 方式下拉'],
  ['06-pdf-zoom', 'PDF 预览 200%'],
  ['07-context', '编辑器右键菜单'],
  ['08-synctex', 'SyncTeX：黄圈定位 + 状态栏'],
  ['09-outline', '提纲浮层'],
  ['10-tree', '文件树卡片'],
  ['11-connect', 'DSH 工作区连接胶囊'],
  ['12-send', '发送选中内容到对话框']
]

const url = 'file:///' + path.join(root, 'mock.html').replace(/\\/g, '/')

for (const [id] of scenes) {
  const target = path.join(outDir, id + '.png')
  try {
    execFileSync(EDGE, [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--hide-scrollbars',
      '--force-device-scale-factor=2',
      '--window-size=1440,900',
      '--virtual-time-budget=4000',
      '--user-data-dir=' + path.join(process.env.TEMP, 'moling-shot-profile'),
      '--screenshot=' + target,
      url + '?s=' + id
    ], { stdio: 'ignore' })
    const size = fs.existsSync(target) ? Math.round(fs.statSync(target).size / 1024) : 0
    console.log((size ? '✓ ' : '✗ ') + id.padEnd(14) + size + ' KB')
  } catch (error) {
    console.log('✗ ' + id + ' — ' + (error.message || error))
  }
}
