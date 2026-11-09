// 用 Windows SAPI（Microsoft Huihui zh-CN）给每个分镜合成旁白 WAV
// 用法：node promo/narration.mjs
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const videoRoot = 'E:/E_个人项目/车辆动力学软件/remotion-demo'
const voiceDir = path.join(videoRoot, 'public', 'voice')
fs.mkdirSync(voiceDir, { recursive: true })

// 场景 → 旁白（每个场景一个 WAV，时长要能塞进分镜时长）
const LINES = [
  ['01', 'DSH 右侧栏，直接开一个 LaTeX 工作台。左边写 tex，右边看 PDF。'],
  ['02', '打开就是启动页。最近的项目、最近的文件，点一下就进。'],
  ['03', '编译结束后，底部状态栏给你结果。几秒、几趟，一眼看清。'],
  ['04', '编辑器是 CodeMirror 六。虚拟化渲染，几千行文档打字也不卡。'],
  ['05', '编译方式合成一个按钮。选完整、快速、从头，只点一下就开始。'],
  ['06', 'PDF 不走浏览器阅读器，而是逐页预渲染。Control 加滚轮，随手缩放。'],
  ['07', '右键菜单，复制粘贴都还在。多了两项：发进对话，或者定位到 PDF。'],
  ['08', '双击式定位换成右键。黄圈落在页面上，状态栏告诉你第几行到第几页。'],
  ['09', '提纲浮在左下角。章节层级和行号，点一条就跳过去。'],
  ['10', '文件树也是卡片，浮在编辑区上。过滤、拖宽度，不打断写作。'],
  ['11', '顶部胶囊告诉你，这个项目有没有进 DSH 工作区。灰的点一下就加进去。'],
  ['12', '选中一段公式，右键发给 AI。行号和代码块自动带上，接着就能改。']
]

function psEscape(text) {
  return text.replace(/'/g, "''")
}

for (const [id, text] of LINES) {
  const target = path.join(voiceDir, 'scene-' + id + '.wav')
  const script = [
    'Add-Type -AssemblyName System.Speech',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    "$s.SelectVoice('Microsoft Huihui Desktop')",
    '$s.Rate = 1',
    '$s.Volume = 100',
    "$s.SetOutputToWaveFile('" + target.replace(/'/g, "''") + "')",
    "$s.Speak('" + psEscape(text) + "')",
    '$s.Dispose()'
  ].join('; ')
  try {
    execFileSync('powershell', ['-NoProfile', '-Command', script], { stdio: 'ignore' })
    const size = fs.existsSync(target) ? fs.statSync(target).size : 0
    console.log((size ? '✓ ' : '✗ ') + id + '  ' + Math.round(size / 1024) + ' KB')
  } catch (error) {
    console.log('✗ ' + id + ' — ' + (error.message || error))
  }
}
