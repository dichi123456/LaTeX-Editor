// SyncTeX — 通过官方 synctex CLI 做正向/反向同步
// TeX Live 2024 生成的是压缩式 synctex，自研解析器不可靠，直接调用官方工具最稳
import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { getEnginePath } from './texlive'

export interface SyncTexForwardResult {
  success: boolean
  page: number | null
  x: number | null
  y: number | null
  error?: string
}

export interface SyncTexBackwardResult {
  success: boolean
  line: number | null
  file: string | null
  error?: string
}

function findSynctexBin(texlivePath?: string | null): string | null {
  const candidates: string[] = []
  if (texlivePath) {
    candidates.push(join(texlivePath, 'synctex.exe'))
    candidates.push(join(texlivePath, 'synctex'))
  }
  // 从 xelatex 路径推断
  const engine = getEnginePath(texlivePath ?? null, 'xelatex')
  if (engine) {
    const binDir = dirname(engine)
    candidates.push(join(binDir, 'synctex.exe'))
    candidates.push(join(binDir, 'synctex'))
  }
  // PATH 中
  candidates.push('synctex.exe')
  candidates.push('synctex')

  for (const c of candidates) {
    if (c === 'synctex' || c === 'synctex.exe') return c
    if (existsSync(c)) return c
  }
  return null
}

function runSynctex(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      { windowsHide: true, timeout: 8000, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        // synctex 有时把结果写在 stderr 或返回非零但仍有输出
        const out = (stdout || '') + (stderr || '')
        if (out.includes('SyncTeX result begin')) {
          resolve(out)
          return
        }
        if (err) {
          reject(new Error(stderr || err.message))
        } else {
          reject(new Error(out || 'synctex 无输出'))
        }
      }
    )
  })
}

/**
 * 正向同步：源码行 → PDF 位置
 * synctex view -i "line:col:file" -o pdf
 */
export async function synctexForward(
  texPath: string,
  line: number,
  pdfPath: string,
  texlivePath?: string | null
): Promise<SyncTexForwardResult> {
  try {
    const bin = findSynctexBin(texlivePath)
    if (!bin) {
      return { success: false, page: null, x: null, y: null, error: '未找到 synctex 工具' }
    }
    if (!existsSync(pdfPath)) {
      return { success: false, page: null, x: null, y: null, error: 'PDF 文件不存在' }
    }

    // synctex view -i "line:col:input" -o output
    const input = `${line}:1:${texPath}`
    const out = await runSynctex(bin, ['view', '-i', input, '-o', pdfPath])

    const pageM = out.match(/Page:(\d+)/)
    const xM = out.match(/x:([\d.-]+)/)
    const yM = out.match(/y:([\d.-]+)/)

    if (!pageM) {
      return { success: false, page: null, x: null, y: null, error: 'synctex 未返回页码' }
    }

    return {
      success: true,
      page: parseInt(pageM[1], 10),
      x: xM ? parseFloat(xM[1]) : null,
      y: yM ? parseFloat(yM[1]) : null
    }
  } catch (err: any) {
    return {
      success: false,
      page: null,
      x: null,
      y: null,
      error: err?.message || String(err)
    }
  }
}

/**
 * 反向同步：PDF 坐标 → 源码行
 * synctex edit -o "page:x:y:pdf"
 * 坐标：x 为水平位置（pt），y 为距页面顶部的距离（pt）—— synctex edit 用的是 top-origin y
 */
export async function synctexBackward(
  page: number,
  x: number,
  y: number,
  pdfPath: string,
  texlivePath?: string | null
): Promise<SyncTexBackwardResult> {
  try {
    const bin = findSynctexBin(texlivePath)
    if (!bin) {
      return { success: false, line: null, file: null, error: '未找到 synctex 工具' }
    }
    if (!existsSync(pdfPath)) {
      return { success: false, line: null, file: null, error: 'PDF 文件不存在' }
    }

    // synctex edit -o "page:x:y:file"  （y 从页面顶部算起）
    const arg = `${page}:${x.toFixed(2)}:${y.toFixed(2)}:${pdfPath}`
    const out = await runSynctex(bin, ['edit', '-o', arg])

    const lineM = out.match(/Line:(\d+)/)
    const fileM = out.match(/Input:(.+)$/m)

    if (!lineM) {
      return { success: false, line: null, file: null, error: 'synctex 未返回行号' }
    }

    return {
      success: true,
      line: parseInt(lineM[1], 10),
      file: fileM ? fileM[1].trim() : null
    }
  } catch (err: any) {
    return {
      success: false,
      line: null,
      file: null,
      error: err?.message || String(err)
    }
  }
}
