// 墨灵 AI 工具定义与执行器（参考 DeepSeek Harness 设计）
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs'
import { join, basename, dirname, extname, relative } from 'path'

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, any>
      required: string[]
    }
  }
}

export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface ToolResult {
  toolCallId: string
  name: string
  result: string
  success: boolean
}

// 工具权限等级：read=只读自动执行，write=写操作需确认
type ToolPermission = 'read' | 'write'

const TOOL_PERMISSIONS: Record<string, ToolPermission> = {
  read_file: 'read',
  list_files: 'read',
  search_project: 'read',
  get_outline: 'read',
  compile_document: 'read',
  write_file: 'write'
}

// ========== 工具定义（JSON Schema） ==========
export const TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'replace_text',
      description: 'Replace exact text in a file. This is the PRIMARY tool for modifying files. find must match the file content character-for-character including whitespace and newlines. Do NOT call read_file first unless you are unsure of the exact original text. Do NOT use write_file for partial edits.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path to the target file' },
          find: { type: 'string', description: 'Exact text to find (must match file content precisely)' },
          replace: { type: 'string', description: 'Replacement text. Empty string deletes the find content.' },
          replace_all: { type: 'boolean', description: 'Replace all occurrences (default: first only)' }
        },
        required: ['path', 'find', 'replace']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write complete file content (overwrites the file, auto-backs up as .bak). ONLY use when rewriting the ENTIRE file. For partial edits, use replace_text instead. Must read_file first to confirm original content.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path to the target file' },
          content: { type: 'string', description: 'Complete new file content' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a file with optional line paging. Use offset/limit for large files. Only call when: (1) you are unsure of the exact original text for a replace_text, (2) user asks to view/analyze a file, or (3) before write_file. Do NOT call when user already provided line numbers or you already know the content.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path to the file' },
          offset: { type: 'number', description: '1-based line number to start reading from (default: 1)' },
          limit: { type: 'number', description: 'Max number of lines to read (default: all)' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_project',
      description: 'Search project files for a keyword. ONLY call when the file path is unknown. Do NOT call when the user already provided a path or selected text with line numbers.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Keyword to search for' },
          file_extension: { type: 'string', description: 'Optional file extension filter, e.g. .tex' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List files in a directory. ONLY call as fallback when search_project also cannot find the target. Do NOT call when the user already provided a path or selected text.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path (optional, defaults to workspace root)' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_outline',
      description: 'Get chapter outline of a .tex file. ONLY call when the user explicitly asks to view or modify the document structure/sections. Do NOT call for content edits.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path to the .tex file' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'compile_document',
      description: 'Compile a LaTeX document with XeLaTeX. Only call when the user asks to compile or check errors.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path to the .tex file' }
        },
        required: ['path']
      }
    }
  }
]

// ========== 全局状态 ==========
let workspaceRoot: string | null = null
let texlivePath: string | null = null

export function setWorkspace(root: string | null): void {
  workspaceRoot = root
}

export function setTexlivePath(path: string | null): void {
  texlivePath = path
}

export function getToolPermission(name: string): ToolPermission {
  return TOOL_PERMISSIONS[name] || 'read'
}

// ========== 工具执行器 ==========
export async function executeTool(call: ToolCall): Promise<ToolResult> {
  let args: any
  try {
    args = JSON.parse(call.function.arguments)
  } catch {
    return { toolCallId: call.id, name: call.function.name, result: '错误: 参数 JSON 解析失败。请确保 arguments 是有效的 JSON 字符串。', success: false }
  }

  try {
    switch (call.function.name) {
      case 'read_file': return execReadFile(call.id, args.path, args.offset, args.limit)
      case 'write_file': return execWriteFile(call.id, args.path, args.content)
      case 'replace_text': return execReplaceText(call.id, args.path, args.find, args.replace, args.replace_all)
      case 'list_files': return execListFiles(call.id, args.path || workspaceRoot || '')
      case 'search_project': return execSearch(call.id, args.query, args.file_extension)
      case 'get_outline': return execGetOutline(call.id, args.path)
      case 'compile_document': return await execCompile(call.id, args.path)
      default:
        return { toolCallId: call.id, name: call.function.name, result: `未知工具: ${call.function.name}`, success: false }
    }
  } catch (err: any) {
    return { toolCallId: call.id, name: call.function.name, result: `执行错误: ${err.message}`, success: false }
  }
}

function execReadFile(id: string, path: string, offset?: number, limit?: number): ToolResult {
  if (!path) {
    return { toolCallId: id, name: 'read_file', result: '错误: 缺少 path 参数', success: false }
  }
  if (!existsSync(path)) {
    return { toolCallId: id, name: 'read_file', result: `文件不存在: ${path}\n\n提示: 可用 list_files 或 search_project 查找正确路径。`, success: false }
  }
  const content = readFileSync(path, 'utf-8')
  const allLines = content.split('\n')
  const totalLines = allLines.length

  // 分页读取：Kilo Code 风格 offset/limit
  const start = Math.max(0, (offset || 1) - 1)
  const end = limit ? Math.min(totalLines, start + limit) : totalLines
  const pageLines = allLines.slice(start, end)
  const pageContent = pageLines.join('\n')

  const truncated = end < totalLines
  const header = truncated
    ? `文件: ${path}\n共 ${totalLines} 行，当前显示第 ${start + 1}-${end} 行。使用 offset=${end + 1} 继续读取。\n\n`
    : `文件: ${path}\n共 ${totalLines} 行\n\n`

  // 截断保护
  const display = pageContent.length > 30000
    ? pageContent.slice(0, 30000) + `\n\n... (本页内容过长已截断，共 ${pageLines.length} 行)`
    : pageContent

  return {
    toolCallId: id,
    name: 'read_file',
    result: header + display,
    success: true
  }
}

function execWriteFile(id: string, path: string, content: string): ToolResult {
  if (!path || content === undefined) {
    return { toolCallId: id, name: 'write_file', result: '错误: 缺少 path 或 content 参数', success: false }
  }
  try {
    const dir = dirname(path)
    if (!existsSync(dir)) {
      try {
        require('fs').mkdirSync(dir, { recursive: true })
      } catch (e: any) {
        return { toolCallId: id, name: 'write_file', result: `错误: 无法创建目录 ${dir}: ${e.message}`, success: false }
      }
    }
    // 备份
    if (existsSync(path)) {
      const backup = path + '.bak'
      writeFileSync(backup, readFileSync(path, 'utf-8'), 'utf-8')
    }
    writeFileSync(path, content, 'utf-8')
    const lines = content.split('\n').length
    return { toolCallId: id, name: 'write_file', result: `已写入 ${path}\n共 ${lines} 行, ${content.length} 字符${existsSync(path + '.bak') ? '\n原文件已备份为 .bak' : ''}`, success: true }
  } catch (err: any) {
    return { toolCallId: id, name: 'write_file', result: `写入失败: ${err.message}`, success: false }
  }
}

function execReplaceText(id: string, path: string, find: string, replace: string, replaceAll?: boolean): ToolResult {
  if (!path || !find) {
    return { toolCallId: id, name: 'replace_text', result: '错误: 缺少 path 或 find 参数', success: false }
  }
  if (!existsSync(path)) {
    return { toolCallId: id, name: 'replace_text', result: `文件不存在: ${path}`, success: false }
  }
  try {
    const content = readFileSync(path, 'utf-8')

    // Kilo Code 风格：行尾规范化 + BOM 处理
    const normalize = (t: string) => t.replace(/\r\n/g, '\n')
    const hasBom = content.startsWith('﻿')
    const body = hasBom ? content.slice(1) : content
    const normBody = normalize(body)

    // 尝试精确匹配
    let idx = normBody.indexOf(normalize(find))
    if (idx === -1) {
      // 尝试原样匹配（未规范化）
      idx = content.indexOf(find)
      if (idx === -1) {
        const firstLine = find.split('\n')[0].slice(0, 80)
        return {
          toolCallId: id,
          name: 'replace_text',
          result: `未找到匹配文本。首行: "${firstLine}..."\n提示: find 必须与文件内容完全一致（含空格、换行、缩进）。建议先 read_file 确认。`,
          success: false
        }
      }
      // 用原文匹配结果
      const origContent = content
      writeFileSync(path + '.bak', origContent, 'utf-8')
      let newContent: string
      let count: number
      if (replaceAll) {
        const parts = origContent.split(find)
        count = parts.length - 1
        newContent = parts.join(replace)
      } else {
        newContent = origContent.slice(0, idx) + replace + origContent.slice(idx + find.length)
        count = 1
      }
      writeFileSync(path, (hasBom ? '﻿' : '') + newContent, 'utf-8')
      const lineNum = origContent.slice(0, idx).split('\n').length
      return {
        toolCallId: id,
        name: 'replace_text',
        result: `已替换 ${count} 处（第 ${lineNum} 行附近）\n文件: ${path}`,
        success: true
      }
    }

    // 规范化匹配成功
    writeFileSync(path + '.bak', content, 'utf-8')
    let newNorm: string
    let count: number
    const nFind = normalize(find)
    if (replaceAll) {
      const parts = normBody.split(nFind)
      count = parts.length - 1
      newNorm = parts.join(replace)
    } else {
      newNorm = normBody.slice(0, idx) + replace + normBody.slice(idx + nFind.length)
      count = 1
    }
    writeFileSync(path, (hasBom ? '﻿' : '') + newNorm, 'utf-8')
    const lineNum = normBody.slice(0, idx).split('\n').length

    return {
      toolCallId: id,
      name: 'replace_text',
      result: `已替换 ${count} 处（第 ${lineNum} 行附近）\n文件: ${path}`,
      success: true
    }
  } catch (err: any) {
    return { toolCallId: id, name: 'replace_text', result: `替换失败: ${err.message}`, success: false }
  }
}

function execListFiles(id: string, path: string): ToolResult {
  if (!path || !existsSync(path)) {
    return { toolCallId: id, name: 'list_files', result: `目录不存在: ${path || '(空)'}`, success: false }
  }
  const entries = readdirSync(path, { withFileTypes: true })
  const ignore = new Set(['node_modules', '.git', '.vs', '__pycache__', 'bin', 'obj', '.idea'])
  const lines = entries
    .filter((e) => !ignore.has(e.name))
    .map((e) => {
      const icon = e.isDirectory() ? '📁' : getFileIcon(e.name)
      return `${icon} ${e.name}${e.isDirectory() ? '/' : ''}`
    })

  return {
    toolCallId: id,
    name: 'list_files',
    result: `目录: ${path}\n${lines.join('\n') || '(空目录)'}`,
    success: true
  }
}

function getFileIcon(name: string): string {
  const ext = extname(name).toLowerCase()
  const map: Record<string, string> = {
    '.tex': '📄', '.bib': '📚', '.sty': '⚙️', '.cls': '📦',
    '.pdf': '📕', '.png': '🖼️', '.jpg': '🖼️', '.md': '📝', '.txt': '📃'
  }
  return map[ext] || '📄'
}

function execSearch(id: string, query: string, fileExt?: string): ToolResult {
  const ws = workspaceRoot
  if (!ws || !existsSync(ws)) {
    return { toolCallId: id, name: 'search_project', result: '错误: 未设置工作区目录', success: false }
  }
  if (!query) {
    return { toolCallId: id, name: 'search_project', result: '错误: 缺少 query 参数', success: false }
  }

  const rootPath: string = ws
  const results: string[] = []
  const ext = fileExt?.startsWith('.') ? fileExt : fileExt ? `.${fileExt}` : null

  function walk(dir: string, depth = 0) {
    if (depth > 6 || results.length >= 80) return
    try {
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(full, depth + 1)
        } else if (!ext || entry.name.toLowerCase().endsWith(ext.toLowerCase())) {
          try {
            const content = readFileSync(full, 'utf-8')
            const lines = content.split('\n')
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].toLowerCase().includes(query.toLowerCase())) {
                const relativePath = relative(rootPath, full)
                results.push(`${relativePath}:${i + 1}: ${lines[i].trim().slice(0, 150)}`)
                if (results.length >= 80) return
              }
            }
          } catch { /* skip binary */ }
        }
      }
    } catch { /* skip */ }
  }

  walk(rootPath)
  return {
    toolCallId: id,
    name: 'search_project',
    result: results.length > 0
      ? `搜索 "${query}" 找到 ${results.length} 处匹配:\n\n${results.join('\n')}`
      : `在工作区中未找到 "${query}"`,
    success: true
  }
}

function execGetOutline(id: string, path: string): ToolResult {
  if (!path || !existsSync(path)) {
    return { toolCallId: id, name: 'get_outline', result: `文件不存在: ${path}`, success: false }
  }
  const content = readFileSync(path, 'utf-8')
  const lines = content.split('\n')
  const outline: string[] = []
  const re = /\\(chapter|section|subsection|subsubsection)\*?\{([^}]*)\}/g

  for (let i = 0; i < lines.length; i++) {
    let m: RegExpExecArray | null
    re.lastIndex = 0
    while ((m = re.exec(lines[i])) !== null) {
      const level = { chapter: 0, section: 1, subsection: 2, subsubsection: 3 }[m[1]] || 0
      const indent = '  '.repeat(level)
      const labelMatch = lines[i].match(/\\label\{([^}]+)\}/)
      const label = labelMatch ? ` [${labelMatch[1]}]` : ''
      outline.push(`${indent}${m[1]}: ${m[2]}${label} (行 ${i + 1})`)
    }
  }

  return {
    toolCallId: id,
    name: 'get_outline',
    result: outline.length > 0
      ? `文件大纲 (${path}):\n\n${outline.join('\n')}`
      : `(未在 ${path} 中找到章节结构)`,
    success: true
  }
}

async function execCompile(id: string, path: string): Promise<ToolResult> {
  if (!path || !existsSync(path)) {
    return { toolCallId: id, name: 'compile_document', result: `文件不存在: ${path}`, success: false }
  }
  return new Promise((resolve) => {
    const { spawn } = require('child_process')
    const dir = dirname(path)
    const base = basename(path, extname(path))
    const args = ['-interaction=nonstopmode', '-file-line-error', '-halt-on-error', basename(path)]

    const env = { ...process.env }
    if (texlivePath) env.PATH = `${texlivePath};${env.PATH || ''}`

    try {
      const proc = spawn('xelatex', args, { cwd: dir, windowsHide: true, env })
      let log = ''
      proc.stdout?.on('data', (d: Buffer) => { log += d.toString('utf-8') })
      proc.stderr?.on('data', (d: Buffer) => { log += d.toString('utf-8') })

      const timer = setTimeout(() => {
        try { proc.kill() } catch { /* */ }
        resolve({ toolCallId: id, name: 'compile_document', result: '编译超时（120秒）', success: false })
      }, 120000)

      proc.on('close', (code: number) => {
        clearTimeout(timer)
        const pdfPath = join(dir, `${base}.pdf`)
        const success = code === 0 && existsSync(pdfPath)

        if (success) {
          resolve({ toolCallId: id, name: 'compile_document', result: `编译成功 ✓\nPDF: ${pdfPath}`, success: true })
        } else {
          const errLines = log.split('\n')
            .filter((l: string) => l.startsWith('!') || l.includes(': error') || l.includes('Error'))
            .slice(0, 15)
          const errMsg = errLines.length > 0 ? errLines.join('\n') : `退出码 ${code}\n${log.slice(-300)}`
          resolve({ toolCallId: id, name: 'compile_document', result: `编译失败:\n${errMsg}`, success: false })
        }
      })

      proc.on('error', (err: Error) => {
        clearTimeout(timer)
        resolve({ toolCallId: id, name: 'compile_document', result: `启动编译器失败: ${err.message}\n请确认 TeX Live 已安装并在设置中正确配置路径。`, success: false })
      })
    } catch (err: any) {
      resolve({ toolCallId: id, name: 'compile_document', result: `编译错误: ${err.message}`, success: false })
    }
  })
}
