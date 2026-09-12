import { spawn, ChildProcess } from 'child_process'
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { basename, dirname, join, extname } from 'path'
import { getEnginePath, killProcessTree } from './texlive'

export interface CompileOptions {
  filePath: string
  engine: string
  extraArgs?: string[]
  timeout?: number
  texlivePath?: string | null
}

export interface CompileIssue {
  type: 'error' | 'warning'
  message: string
  line: number | null
  file: string | null
}

export interface CompileResult {
  success: boolean
  pdfPath: string | null
  logPath: string | null
  log: string
  errors: CompileIssue[]
  warnings: CompileIssue[]
  duration: number
}

let currentProcess: ChildProcess | null = null
let currentTimer: NodeJS.Timeout | null = null

export function isCompiling(): boolean {
  return currentProcess !== null
}

export function cancelCompile(): boolean {
  if (currentProcess) {
    if (currentTimer) clearTimeout(currentTimer)
    killProcessTree(currentProcess.pid!)
    currentProcess = null
    return true
  }
  return false
}

export async function compileDocument(
  options: CompileOptions,
  texlivePath: string | null,
  onProgress: (message: string, type: string) => void
): Promise<CompileResult> {
  const startTime = Date.now()
  const {
    filePath,
    engine,
    extraArgs = [],
    timeout = 120000
  } = options

  if (!existsSync(filePath)) {
    return {
      success: false,
      pdfPath: null,
      logPath: null,
      log: `错误：源文件不存在：${filePath}`,
      errors: [{ type: 'error', message: '源文件不存在', line: null, file: filePath }],
      warnings: [],
      duration: 0
    }
  }

  const workDir = dirname(filePath)
  const baseName = basename(filePath, extname(filePath))
  const pdfPath = join(workDir, `${baseName}.pdf`)
  const logPath = join(workDir, `${baseName}.log`)

  // 确定引擎路径
  const enginePath = getEnginePath(texlivePath, engine) || engine

  // 默认参数
  const args = [
    '-interaction=nonstopmode',
    '-file-line-error',
    '-halt-on-error',
    ...extraArgs,
    basename(filePath)
  ]

  onProgress(`正在使用 ${engine} 编译…`, 'info')
  onProgress(`命令: ${enginePath} ${args.join(' ')}`, 'debug')

  return new Promise<CompileResult>((resolve) => {
    let log = ''
    let stderr = ''

    const env = { ...process.env }
    if (texlivePath) {
      env.PATH = `${texlivePath};${env.PATH || ''}`
    }

    try {
      currentProcess = spawn(enginePath, args, {
        cwd: workDir,
        windowsHide: true,
        env
      })
    } catch (err: any) {
      currentProcess = null
      resolve({
        success: false,
        pdfPath: null,
        logPath: null,
        log: `无法启动编译器：${err.message}\n请检查 TeX Live 是否安装，或在设置中指定路径。`,
        errors: [{ type: 'error', message: `无法启动编译器: ${err.message}`, line: null, file: null }],
        warnings: [],
        duration: Date.now() - startTime
      })
      return
    }

    const proc = currentProcess

    proc.stdout?.on('data', (data: Buffer) => {
      const text = data.toString('utf-8')
      log += text
      onProgress(text, 'stdout')
    })

    proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString('utf-8')
      stderr += text
      log += text
      onProgress(text, 'stderr')
    })

    currentTimer = setTimeout(() => {
      onProgress('编译超时，正在终止…', 'error')
      cancelCompile()
      resolve({
        success: false,
        pdfPath: null,
        logPath,
        log: log + '\n\n[编译超时，已强制终止]',
        errors: [{ type: 'error', message: '编译超时（超过设定时间）', line: null, file: null }],
        warnings: [],
        duration: Date.now() - startTime
      })
    }, timeout)

    proc.on('close', (code) => {
      if (currentTimer) clearTimeout(currentTimer)
      currentProcess = null

      // 读取完整日志文件
      let fullLog = log
      if (existsSync(logPath)) {
        try {
          fullLog = readFileSync(logPath, 'utf-8')
        } catch {
          // keep streaming log
        }
      }

      const { errors, warnings } = parseLog(fullLog, filePath)
      const success = code === 0 && existsSync(pdfPath)

      if (!success && code !== 0) {
        onProgress(`编译失败（退出码 ${code}）`, 'error')
      } else if (success) {
        onProgress('编译成功', 'success')
      }

      resolve({
        success,
        pdfPath: success ? pdfPath : null,
        logPath: existsSync(logPath) ? logPath : null,
        log: fullLog || stderr,
        errors,
        warnings,
        duration: Date.now() - startTime
      })
    })

    proc.on('error', (err) => {
      if (currentTimer) clearTimeout(currentTimer)
      currentProcess = null
      resolve({
        success: false,
        pdfPath: null,
        logPath: null,
        log: `编译器启动错误：${err.message}`,
        errors: [{ type: 'error', message: err.message, line: null, file: null }],
        warnings: [],
        duration: Date.now() - startTime
      })
    })
  })
}

const ERROR_PATTERN = /^(.+?):(\d+):\s*(.+)$/m
const LATEX_ERROR_PATTERN = /^! (.+)$/m
const WARNING_PATTERN = /^Warning:\s*(.+)$/m
const PACKAGE_WARNING = /^Package (.+?) Warning:\s*(.+)$/m

export function parseLog(
  log: string,
  mainFile: string
): { errors: CompileIssue[]; warnings: CompileIssue[] } {
  const errors: CompileIssue[] = []
  const warnings: CompileIssue[] = []
  const lines = log.split(/\r?\n/)

  let currentFile: string | null = mainFile

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // file:line: message 格式（-file-line-error）
    const fileErrMatch = line.match(/^(.+?):(\d+):\s*(.+)$/)
    if (fileErrMatch && !line.startsWith(' ') && !line.startsWith('\t')) {
      const [, file, lineNum, msg] = fileErrMatch
      if (msg && !msg.startsWith('Warning')) {
        errors.push({
          type: 'error',
          message: msg.trim(),
          line: parseInt(lineNum, 10),
          file: file.trim()
        })
        continue
      }
    }

    // ! Error message
    const latexErrMatch = line.match(/^!\s+(.+)$/)
    if (latexErrMatch) {
      // 尝试从后面几行找 l.<num>
      let lineNum: number | null = null
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const lMatch = lines[j].match(/^l\.(\d+)/)
        if (lMatch) {
          lineNum = parseInt(lMatch[1], 10)
          break
        }
      }
      errors.push({
        type: 'error',
        message: latexErrMatch[1].trim(),
        line: lineNum,
        file: currentFile
      })
      continue
    }

    // Package Warning
    const pkgWarn = line.match(/^Package (.+?) Warning:\s*(.+)$/)
    if (pkgWarn) {
      warnings.push({
        type: 'warning',
        message: `[${pkgWarn[1]}] ${pkgWarn[2].trim()}`,
        line: null,
        file: currentFile
      })
      continue
    }

    // LaTeX Warning
    const latexWarn = line.match(/^LaTeX Warning:\s*(.+)$/)
    if (latexWarn) {
      warnings.push({
        type: 'warning',
        message: latexWarn[1].trim(),
        line: null,
        file: currentFile
      })
      continue
    }

    // Overfull / Underfull box
    if (/^(Overfull|Underfull) \\hbox/.test(line)) {
      warnings.push({
        type: 'warning',
        message: line.trim(),
        line: null,
        file: currentFile
      })
    }
  }

  return { errors, warnings }
}

export function cleanAuxFiles(mainPath: string): string[] {
  const dir = dirname(mainPath)
  const base = basename(mainPath, extname(mainPath))
  const extensions = [
    '.aux', '.log', '.out', '.toc', '.lof', '.lot',
    '.bbl', '.blg', '.fls', '.fdb_latexmk', '.synctex.gz',
    '.nav', '.snm', '.vrb', '.bcf', '.run.xml',
    '.xdv', '.dvi', '.idx', '.ilg', '.ind', '.glo', '.gls',
    '.nav', '.toc'
  ]

  const deleted: string[] = []
  for (const ext of extensions) {
    const p = join(dir, `${base}${ext}`)
    try {
      if (existsSync(p)) {
        unlinkSync(p)
        deleted.push(`${base}${ext}`)
      }
    } catch {
      // ignore
    }
  }
  return deleted
}

/**
 * 运行 bibtex 处理参考文献
 * 返回 { success, log }
 */
export async function runBibtex(
  mainPath: string,
  texlivePath: string | null,
  onProgress: (message: string, type: string) => void
): Promise<{ success: boolean; log: string }> {
  const dir = dirname(mainPath)
  const base = basename(mainPath, extname(mainPath))
  const auxPath = join(dir, `${base}.aux`)

  if (!existsSync(auxPath)) {
    return { success: false, log: '[bibtex] .aux 文件不存在，跳过 bibtex' }
  }

  // 检查 .aux 中是否有 \bibdata（即文档引用了 .bib）
  try {
    const auxContent = readFileSync(auxPath, 'utf-8')
    if (!auxContent.includes('\\bibdata')) {
      return { success: true, log: '[bibtex] 文档未引用 .bib 文件，跳过 bibtex' }
    }
  } catch {
    return { success: false, log: '[bibtex] 无法读取 .aux 文件' }
  }

  const bibtexPath = getEnginePath(texlivePath, 'bibtex') || 'bibtex'
  onProgress('正在运行 bibtex…', 'info')

  return new Promise((resolve) => {
    let log = ''
    const env = { ...process.env }
    if (texlivePath) {
      env.PATH = `${texlivePath};${env.PATH || ''}`
    }

    try {
      const proc = spawn(bibtexPath, [base], {
        cwd: dir,
        windowsHide: true,
        env
      })

      proc.stdout?.on('data', (data: Buffer) => {
        const text = data.toString('utf-8')
        log += text
        onProgress(text, 'stdout')
      })
      proc.stderr?.on('data', (data: Buffer) => {
        const text = data.toString('utf-8')
        log += text
        onProgress(text, 'stderr')
      })

      const timer = setTimeout(() => {
        killProcessTree(proc.pid!)
        resolve({ success: false, log: log + '\n[bibtex] 超时' })
      }, 60000)

      proc.on('close', (code) => {
        clearTimeout(timer)
        const success = code === 0
        onProgress(success ? 'bibtex 完成' : `bibtex 退出码 ${code}`, success ? 'success' : 'error')
        resolve({ success, log })
      })

      proc.on('error', (err) => {
        clearTimeout(timer)
        resolve({ success: false, log: `[bibtex] 启动失败: ${err.message}` })
      })
    } catch (err: any) {
      resolve({ success: false, log: `[bibtex] 错误: ${err.message}` })
    }
  })
}
