import { exec, spawn } from 'child_process'
import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { promisify } from 'util'

const execAsync = promisify(exec)

export interface TexLiveDetection {
  found: boolean
  path: string | null
  engine: string | null
}

const COMMON_PATHS = [
  'D:\\A_Professional_Program\\texlive\\2024\\bin\\windows',
  'D:\\A_Professional_Program\\texlive\\2023\\bin\\windows',
  'C:\\texlive\\2025\\bin\\windows',
  'C:\\texlive\\2025\\bin\\win32',
  'C:\\texlive\\2024\\bin\\windows',
  'C:\\texlive\\2024\\bin\\win32',
  'C:\\texlive\\2023\\bin\\windows',
  'C:\\texlive\\2023\\bin\\win32',
  'C:\\texlive\\2022\\bin\\windows',
  'C:\\texlive\\2022\\bin\\win32',
  'C:\\Program Files\\MiKTeX\\miktex\\bin\\x64',
  'C:\\Program Files\\MiKTeX\\miktex\\bin\\x64\\internal',
  'C:\\texlive\\2024\\bin\\x64-windows',
  'C:\\texlive\\2025\\bin\\x64-windows'
]

function hasEngine(binDir: string, engine = 'xelatex'): boolean {
  return existsSync(join(binDir, `${engine}.exe`)) || existsSync(join(binDir, engine))
}

/** Scan common TeX install roots for year/bin/xelatex.exe layouts. */
function scanTexRoots(): string[] {
  const found: string[] = []
  const roots = ['C:\\', 'D:\\', 'E:\\', join(process.env.USERPROFILE || '', '')]
  const years = new Set<string>(['2022', '2023', '2024', '2025', '2026'])

  for (const drive of roots) {
    if (!drive || !existsSync(drive)) continue
    try {
      const texRoot = join(drive, 'texlive')
      if (!existsSync(texRoot)) continue
      for (const year of readdirSync(texRoot, { withFileTypes: true })) {
        if (!year.isDirectory() || !years.has(year.name)) continue
        for (const binName of ['windows', 'win32', 'x64-windows']) {
          const binDir = join(texRoot, year.name, 'bin', binName)
          if (hasEngine(binDir)) found.push(binDir)
        }
      }
    } catch { /* skip drive */ }
  }

  const userData = process.env.USERPROFILE || process.env.HOME || ''
  if (userData) {
    try {
      const texRoot = join(userData, 'texlive')
      if (existsSync(texRoot)) {
        for (const year of readdirSync(texRoot, { withFileTypes: true })) {
          if (!year.isDirectory()) continue
          for (const binName of ['windows', 'win32', 'x64-windows']) {
            const binDir = join(texRoot, year.name, 'bin', binName)
            if (hasEngine(binDir)) found.push(binDir)
          }
        }
      }
    } catch { /* skip */ }
  }

  return found
}

/**
 * Detect TeX Live / MiKTeX.
 * preferredPath (from app config) is checked first so a manual setting always wins.
 */
export async function detectTexLive(preferredPath?: string | null): Promise<TexLiveDetection> {
  // 0. Saved config path first
  if (preferredPath) {
    const candidates = [
      preferredPath,
      join(preferredPath, 'bin', 'windows'),
      join(preferredPath, 'bin', 'win32'),
      join(preferredPath, 'bin', 'x64-windows')
    ]
    for (const p of candidates) {
      if (hasEngine(p)) {
        return { found: true, path: p, engine: join(p, 'xelatex.exe') }
      }
    }
  }

  // 1. PATH
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

  // 2. Hard-coded common paths
  for (const p of COMMON_PATHS) {
    if (hasEngine(p)) {
      return { found: true, path: p, engine: join(p, 'xelatex.exe') }
    }
  }

  // 3. Scan drives / user profile
  for (const p of scanTexRoots()) {
    return { found: true, path: p, engine: join(p, 'xelatex.exe') }
  }

  return { found: false, path: null, engine: null }
}

/**
 * Resolve engine executable under a TeX bin dir.
 * Accepts either the bin directory itself or a TeX Live root (…/texlive/2024).
 */
export function getEnginePath(texlivePath: string | null, engine: string): string | null {
  if (!texlivePath) return null
  const candidates = [
    join(texlivePath, `${engine}.exe`),
    join(texlivePath, engine),
    join(texlivePath, 'bin', 'windows', `${engine}.exe`),
    join(texlivePath, 'bin', 'win32', `${engine}.exe`),
    join(texlivePath, 'bin', 'x64-windows', `${engine}.exe`)
  ]
  // Path may point at a TeX Live root (…/texlive) that contains year folders
  try {
    if (existsSync(texlivePath)) {
      for (const entry of readdirSync(texlivePath, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        for (const binName of ['windows', 'win32', 'x64-windows']) {
          candidates.push(join(texlivePath, entry.name, 'bin', binName, `${engine}.exe`))
        }
      }
    }
  } catch { /* ignore */ }

  for (const c of candidates) {
    if (existsSync(c)) return c
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

/** Pick compile engine from document head (shared by UI compile and AI tools). */
export function pickLatexEngine(headContent: string, fallback = 'xelatex'): string {
  const head = (headContent || '').slice(0, 2500)
  if (
    /\\documentclass[^%]*\{[^}]*IEEEtran\}/i.test(head) ||
    /\\documentclass[^%]*\{[^}]*elsarticle\}/i.test(head) ||
    /\\usepackage(\[[^\]]*\])?\{elsarticle\}/i.test(head)
  ) {
    return 'pdflatex'
  }
  if (
    /\\documentclass[^%]*\{[^}]*ctex/i.test(head) ||
    /cumcmthesis/i.test(head) ||
    /\\setCJKmainfont/i.test(head) ||
    /\\usepackage(\[[^\]]*\])?\{ctex\}/i.test(head) ||
    /ctexbeamer/i.test(head)
  ) {
    return 'xelatex'
  }
  if (/\\documentclass[^%]*\{[^}]*article\}/i.test(head) || /Wiley/i.test(head)) {
    return 'pdflatex'
  }
  return fallback
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
