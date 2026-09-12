// 墨灵 AI 工具定义与执行器（参考 DeepSeek Harness 设计）
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs'
import { join, basename, dirname, extname } from 'path'

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
      name: 'read_file',
      description: '读取指定路径文件的完整文本内容。当需要查看、分析或修改文件内容时，必须先调用此工具。',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '要读取的文件的绝对完整路径。例如: E:\\project\\main.tex'
          }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: '将完整内容写入指定文件。会覆盖原文件（自动备份为.bak）。必须提供文件的完整新内容，不是差异或补丁。修改前应先用 read_file 读取原文件。',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '目标文件的绝对完整路径'
          },
          content: {
            type: 'string',
            description: '文件的完整新内容（包含所有原有内容和修改）'
          }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'replace_text',
      description: '在文件中查找并替换指定文本片段。比 write_file 更高效，只需提供要替换的部分，无需重写整个文件。适合修改特定段落、句子或命令。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '目标文件的绝对路径' },
          find: { type: 'string', description: '要查找的原文本（必须与文件中的内容完全匹配）' },
          replace: { type: 'string', description: '替换后的新文本。留空则删除 find 匹配的内容。' },
          replace_all: { type: 'boolean', description: '是否替换所有匹配项，默认只替换第一个' }
        },
        required: ['path', 'find', 'replace']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: '列出指定目录中的文件和子目录。用于了解项目结构或查找文件。',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '目录的绝对路径。留空则列出工作区根目录。'
          }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_project',
      description: '在工作区的所有文本文件中搜索关键词，返回匹配的文件名、行号和内容片段。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '要搜索的关键词或短语'
          },
          file_extension: {
            type: 'string',
            description: '可选，按扩展名过滤，如 .tex、.bib'
          }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_outline',
      description: '解析 .tex 文件的文档结构，返回章节标题列表及其行号。',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '.tex 文件的绝对完整路径'
          }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'compile_document',
      description: '使用 XeLaTeX 编译指定的 .tex 文档，返回编译结果和错误信息。',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '要编译的 .tex 文件的绝对完整路径'
          }
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
      case 'read_file': return execReadFile(call.id, args.path)
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

function execReadFile(id: string, path: string): ToolResult {
  if (!path) {
    return { toolCallId: id, name: 'read_file', result: '错误: 缺少 path 参数', success: false }
  }
  if (!existsSync(path)) {
    return { toolCallId: id, name: 'read_file', result: `文件不存在: ${path}\n\n提示: 请确认路径是否正确。可使用 list_files 或 search_project 查找文件。`, success: false }
  }
  const content = readFileSync(path, 'utf-8')
  const lines = content.split('\n')
  const truncated = content.length > 20000
    ? content.slice(0, 20000) + `\n\n... (文件共 ${lines.length} 行，已显示前 ${Math.min(lines.length, 20000)} 字符，使用行号定位后续内容)`
    : content

  return {
    toolCallId: id,
    name: 'read_file',
    result: `文件: ${path}\n共 ${lines.length} 行\n\n${truncated}`,
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
      return { toolCallId: id, name: 'write_file', result: `错误: 目录不存在: ${dir}`, success: false }
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
    if (!content.includes(find)) {
      // 提供相似文本帮助调试
      const firstLine = find.split('\n')[0].slice(0, 60)
      return {
        toolCallId: id,
        name: 'replace_text',
        result: `未在文件中找到要替换的文本。查找内容首行: "${firstLine}..."\n\n提示: find 必须与文件中的内容完全匹配（包括空格、换行、特殊字符）。请用 read_file 确认准确内容。`,
        success: false
      }
    }
    // 备份
    writeFileSync(path + '.bak', content, 'utf-8')

    let newContent: string
    let count: number
    if (replaceAll) {
      const parts = content.split(find)
      count = parts.length - 1
      newContent = parts.join(replace)
    } else {
      const idx = content.indexOf(find)
      newContent = content.slice(0, idx) + replace + content.slice(idx + find.length)
      count = 1
    }
    writeFileSync(path, newContent, 'utf-8')

    // 计算修改位置的行号
    const beforeMatch = content.slice(0, content.indexOf(find))
    const lineNum = beforeMatch.split('\n').length

    return {
      toolCallId: id,
      name: 'replace_text',
      result: `已在 ${path} 第 ${lineNum} 行处替换${count > 1 ? `了 ${count} 处` : ''}文本。\n原文件已备份为 .bak`,
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
  if (!workspaceRoot || !existsSync(workspaceRoot)) {
    return { toolCallId: id, name: 'search_project', result: '错误: 未设置工作区目录', success: false }
  }
  if (!query) {
    return { toolCallId: id, name: 'search_project', result: '错误: 缺少 query 参数', success: false }
  }

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
                const relativePath = full.replace(workspaceRoot, '').replace(/^[\\/]/, '')
                results.push(`${relativePath}:${i + 1}: ${lines[i].trim().slice(0, 150)}`)
                if (results.length >= 80) return
              }
            }
          } catch { /* skip binary */ }
        }
      }
    } catch { /* skip */ }
  }

  walk(workspaceRoot)
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
