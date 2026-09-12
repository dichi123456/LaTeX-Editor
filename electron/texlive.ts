import { exec, spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { promisify } from 'util'

const execAsync = promisify(exec)

export interface TexLiveDetection {
  found: boolean
  path: string | null
  engine: string | null
}

const COMMON_PATHS = [
  'C:\\texlive\\2024\\bin\\windows',
  'C:\\texlive\\2024\\bin\\win32',
  'C:\\texlive\\2023\\bin\\windows',
  'C:\\texlive\\2023\\bin\\win32',
  'C:\\texlive\\2022\\bin\\windows',
  'C:\\texlive\\2022\\bin\\win32',
  'C:\\Program Files\\MiKTeX\\miktex\\bin\\x64',
  'C:\\texlive\\2024\\bin\\x64-windows'
]

export async function detectTexLive(): Promise<TexLiveDetection> {
  // 1. 检查 PATH 中的 xelatex
  try {
    const { stdout } = await execAsync('where xelatex', { windowsHide: true })
    const firstLine = stdout.trim().split(/\r?\n/)[0]
    if (firstLine && existsSync(firstLine)) {
      const binDir = firstLine.replace(/[\\/]+xelatex(\.exe)?$/i, '')
      return { found: true, path: binDir, engine: firstLine }
    }
  } catch {
    // not in PATH
  }

  // 2. 检查常见安装路径
  for (const p of COMMON_PATHS) {
    const xelatexPath = join(p, 'xelatex.exe')
    if (existsSync(xelatexPath)) {
      return { found: true, path: p, engine: xelatexPath }
    }
  }

  // 3. 检查用户目录
  const userData = process.env.USERPROFILE || process.env.HOME || ''
  if (userData) {
    for (const year of ['2024', '2023', '2022']) {
      const p = join(userData, 'texlive', year, 'bin', 'windows')
      const xelatexPath = join(p, 'xelatex.exe')
      if (existsSync(xelatexPath)) {
        return { found: true, path: p, engine: xelatexPath }
      }
    }
  }

  return { found: false, path: null, engine: null }
}

export function getEnginePath(texlivePath: string | null, engine: string): string | null {
  if (texlivePath) {
    const exePath = join(texlivePath, `${engine}.exe`)
    if (existsSync(exePath)) return exePath
  }
  return null
}

export async function verifyEngine(
  texlivePath: string | null,
  engine: string
): Promise<boolean> {
  const enginePath = getEnginePath(texlivePath, engine)
  if (enginePath) return true
  try {
    await execAsync(`where ${engine}`, { windowsHide: true })
    return true
  } catch {
    return false
  }
}

export function killProcessTree(pid: number): void {
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
    } else {
      process.kill(-pid, 'SIGTERM')
    }
  } catch {
    // process already dead
  }
}
