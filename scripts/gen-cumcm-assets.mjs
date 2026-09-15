import { readFileSync, writeFileSync, statSync } from 'fs'
import { join } from 'path'

const figuresDir = 'E:/个人项目/Latex_APP/src/templates/cumcm/figures'
const files = [
  'cat.pdf',
  'f1.png',
  'gongzhonghao.jpg',
  'gongzhonghao2.png',
  'smokeblk.pdf',
  'upload.png'
]
const parts = ['// 自动生成：国赛模板示例图片 base64（勿手改）']
for (const f of files) {
  const buf = readFileSync(join(figuresDir, f))
  const key = f.replace(/\./g, '_')
  parts.push(`export const ${key} = "data:application/octet-stream;base64,${buf.toString('base64')}"`)
}
writeFileSync(
  'E:/个人项目/Latex_APP/src/templates/cumcm/assets.base64.ts',
  parts.join('\n') + '\n'
)
console.log('assets.base64 written', statSync('E:/个人项目/Latex_APP/src/templates/cumcm/assets.base64.ts').size)
