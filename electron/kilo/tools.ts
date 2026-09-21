// MoLing AI tools — Kilo Code tool semantics ported from:
// packages/opencode/src/tool/edit.ts + edit.txt
// packages/opencode/src/tool/read.ts + read.txt
// plus LaTeX compile_document using the app's TeX Live path.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs'
import { join, basename, dirname, extname, relative, isAbsolute } from 'path'
import { getEnginePath, pickLatexEngine, killProcessTree } from '../texlive'
import { parseLog } from '../compiler'

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

type ToolPermission = 'read' | 'write'

const TOOL_PERMISSIONS: Record<string, ToolPermission> = {
  read: 'read',
  read_file: 'read',
  list_files: 'read',
  search_project: 'read',
  get_outline: 'read',
  compile_document: 'read',
  write: 'write',
  write_file: 'write',
  edit: 'write',
  replace_text: 'write'
}

/** Kilo edit.txt — exact replace is the primary edit tool */
const EDIT_DESCRIPTION = `Performs exact string replacements in files.

Usage:
- You must use the read tool at least once in the conversation before editing if you are unsure of the exact original text.
- When editing text from read tool output, preserve the exact indentation (tabs/spaces) AFTER the line number prefix. Prefix format: line number + colon + space (e.g. \`17: \`). Everything after that space is the file content.
- ALWAYS prefer editing existing files. NEVER write new files unless required.
- The edit will FAIL if oldString is not found in the file.
- The edit will FAIL if oldString is found multiple times. Provide more surrounding lines in oldString to identify the correct match, or use replaceAll.
- Use replaceAll for renaming the same string across the file.
- oldString must be different from newString.
- Empty oldString only creates a new file.`

/** Kilo read.txt */
const READ_DESCRIPTION = `Read a file from the local filesystem.

Usage:
- filePath should be an absolute path (or relative to the workspace root).
- Returns up to 2000 lines from the start by default.
- offset is 1-based line number to start from.
- To read later sections, call again with a larger offset.
- Contents are returned with each line prefixed by its line number as \`<line>: <content>\`.
- Call this tool in parallel when you know there are multiple files you want to read.
- Avoid tiny repeated slices. If you need more context, read a larger window.`

export const TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'edit',
      description: EDIT_DESCRIPTION,
      parameters: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: 'The absolute path to the file to modify'
          },
          oldString: {
            type: 'string',
            description: 'The text to replace (must match file content exactly)'
          },
          newString: {
            type: 'string',
            description: 'The text to replace it with (must be different from oldString)'
          },
          replaceAll: {
            type: 'boolean',
            description: 'Replace all occurrences of oldString (default false)'
          }
        },
        required: ['filePath', 'oldString', 'newString']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read',
      description: READ_DESCRIPTION,
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Absolute path to the file' },
          offset: { type: 'number', description: '1-based line number to start from (default: 1)' },
          limit: { type: 'number', description: 'Max number of lines to read (default: all / 2000)' }
        },
        required: ['filePath']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write',
      description:
        'Write complete file content (overwrites the file, auto-backs up as .bak). ONLY use when rewriting the ENTIRE file. For partial edits, use edit instead.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Absolute path to the target file' },
          content: { type: 'string', description: 'Complete new file content' }
        },
        required: ['filePath', 'content']
      }
    }
  },
  // legacy aliases (models that still emit old names)
  {
    type: 'function',
    function: {
      name: 'replace_text',
      description: 'Deprecated alias of edit. Prefer edit.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          filePath: { type: 'string' },
          find: { type: 'string' },
          oldString: { type: 'string' },
          replace: { type: 'string' },
          newString: { type: 'string' },
          replace_all: { type: 'boolean' },
          replaceAll: { type: 'boolean' }
        },
        required: ['find', 'replace']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Deprecated alias of write. Prefer write.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          filePath: { type: 'string' },
          content: { type: 'string' }
        },
        required: ['content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Deprecated alias of read. Prefer read.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          filePath: { type: 'string' },
          offset: { type: 'number' },
          limit: { type: 'number' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_project',
      description: 'Search project files for a keyword. ONLY call when the file path is unknown.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Keyword to search for' },
          file_extension: { type: 'string', description: 'Optional extension filter, e.g. .tex' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List files in a directory. ONLY as fallback when search_project cannot find the target.',
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
      description: 'Get chapter outline of a .tex file. ONLY when the user asks for document structure.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          filePath: { type: 'string' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'compile_document',
      description:
        'Compile a LaTeX document. Engine auto-selected from documentclass (pdflatex for IEEE/elsarticle/article, xelatex for Chinese/ctex). Uses TeX Live from settings.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          filePath: { type: 'string' }
        },
        required: []
      }
    }
  }
]

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

function resolvePath(p: string | undefined | null): string {
  if (!p) return ''
  const s = String(p).trim()
  if (!s) return ''
  if (isAbsolute(s) || /^[A-Za-z]:[\\/]/.test(s) || s.startsWith('\\\\')) return s
  if (workspaceRoot) return join(workspaceRoot, s)
  return s
}

function normalizeNewlines(t: string): string {
  return t.replace(/\r\n/g, '\n')
}

function detectLineEnding(text: string): '\n' | '\r\n' {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let idx = 0
  while (true) {
    const hit = haystack.indexOf(needle, idx)
    if (hit === -1) break
    count += 1
    idx = hit + needle.length
  }
  return count
}

export async function executeTool(call: ToolCall): Promise<ToolResult> {
  let args: any
  try {
    args = JSON.parse(call.function.arguments || '{}')
  } catch {
    return {
      toolCallId: call.id,
      name: call.function.name,
      result: 'Error: tool arguments are not valid JSON. arguments must be a valid JSON string.',
      success: false
    }
  }

  try {
    switch (call.function.name) {
      case 'read':
      case 'read_file':
        return execRead(call.id, resolvePath(args.filePath || args.path), args.offset, args.limit)
      case 'edit':
        return execEdit(
          call.id,
          resolvePath(args.filePath || args.path),
          args.oldString ?? args.find,
          args.newString ?? args.replace,
          args.replaceAll ?? args.replace_all
        )
      case 'replace_text':
        return execEdit(
          call.id,
          resolvePath(args.filePath || args.path),
          args.oldString ?? args.find,
          args.newString ?? args.replace,
          args.replaceAll ?? args.replace_all
        )
      case 'write':
      case 'write_file':
        return execWrite(call.id, resolvePath(args.filePath || args.path), args.content)
      case 'list_files':
        return execListFiles(call.id, resolvePath(args.path || args.filePath) || workspaceRoot || '')
      case 'search_project':
        return execSearch(call.id, args.query, args.file_extension)
      case 'get_outline':
        return execGetOutline(call.id, resolvePath(args.path || args.filePath))
      case 'compile_document':
        return await execCompile(call.id, resolvePath(args.path || args.filePath))
      default:
        return {
          toolCallId: call.id,
          name: call.function.name,
          result: `Unknown tool: ${call.function.name}`,
          success: false
        }
    }
  } catch (err: any) {
    return {
      toolCallId: call.id,
      name: call.function.name,
      result: `Tool execution error: ${err.message}`,
      success: false
    }
  }
}

/** Kilo read: line-prefixed output */
function execRead(id: string, path: string, offset?: number, limit?: number): ToolResult {
  if (!path) {
    return { toolCallId: id, name: 'read', result: 'Error: filePath is required', success: false }
  }
  if (!existsSync(path)) {
    return {
      toolCallId: id,
      name: 'read',
      result: `File not found: ${path}\n\nHint: use search_project or list_files to find the correct path.`,
      success: false
    }
  }
  const content = readFileSync(path, 'utf-8')
  const allLines = content.split('\n')
  const totalLines = allLines.length
  const start = Math.max(0, (offset || 1) - 1)
  const hardLimit = limit && limit > 0 ? limit : totalLines
  const end = Math.min(totalLines, start + hardLimit)
  const pageLines = allLines.slice(start, end)
  // Kilo format: `<line>: <content>`
  const numbered = pageLines
    .map((line, i) => `${start + i + 1}: ${line}`)
    .join('\n')

  const truncated = end < totalLines
  const header = truncated
    ? `File: ${path}\n${totalLines} lines total, showing ${start + 1}-${end}. Use offset=${end + 1} to continue.\n\n`
    : `File: ${path}\n${totalLines} lines\n\n`

  const display =
    numbered.length > 28000
      ? numbered.slice(0, 28000) + `\n\n... (truncated this page, ${pageLines.length} lines requested)`
      : numbered

  return {
    toolCallId: id,
    name: 'read',
    result: header + display,
    success: true
  }
}

/** Kilo edit.ts: exact replace + multiple-match error + empty-oldString policy */
function execEdit(
  id: string,
  path: string,
  oldString: string | undefined,
  newString: string | undefined,
  replaceAll?: boolean
): ToolResult {
  if (!path) {
    return { toolCallId: id, name: 'edit', result: 'Error: filePath is required', success: false }
  }
  if (oldString === undefined || newString === undefined) {
    return {
      toolCallId: id,
      name: 'edit',
      result: 'Error: oldString and newString are required',
      success: false
    }
  }
  if (oldString === newString) {
    return {
      toolCallId: id,
      name: 'edit',
      result: 'No changes to apply: oldString and newString are identical.',
      success: false
    }
  }

  const exists = existsSync(path)

  // empty oldString → create new file only
  if (oldString === '') {
    if (exists) {
      return {
        toolCallId: id,
        name: 'edit',
        result:
          'oldString cannot be empty when editing an existing file. Provide the exact text to replace, or use write for an intentional full-file replacement.',
        success: false
      }
    }
    try {
      const dir = dirname(path)
      if (!existsSync(dir)) {
        require('fs').mkdirSync(dir, { recursive: true })
      }
      const eol = detectLineEnding(newString)
      const body = eol === '\r\n' ? normalizeNewlines(newString).replace(/\n/g, '\r\n') : normalizeNewlines(newString)
      writeFileSync(path, body, 'utf-8')
      return {
        toolCallId: id,
        name: 'edit',
        result: `Created new file: ${path}\n${body.split('\n').length} lines`,
        success: true
      }
    } catch (err: any) {
      return { toolCallId: id, name: 'edit', result: `Failed to create file: ${err.message}`, success: false }
    }
  }

  if (!exists) {
    return { toolCallId: id, name: 'edit', result: `File not found: ${path}`, success: false }
  }

  try {
    const original = readFileSync(path, 'utf-8')
    const hasBom = original.startsWith('\uFEFF')
    const rawBody = hasBom ? original.slice(1) : original
    const eol = detectLineEnding(rawBody)
    const bodyLf = normalizeNewlines(rawBody)
    const findLf = normalizeNewlines(oldString)
    const replaceLf = normalizeNewlines(newString)

    let count = countOccurrences(bodyLf, findLf)
    let working = bodyLf
    let find = findLf
    let replace = replaceLf

    // fallback: match against original CRLF form
    if (count === 0 && eol === '\r\n') {
      const bodyCrlf = bodyLf.replace(/\n/g, '\r\n')
      const findCrlf = findLf.replace(/\n/g, '\r\n')
      count = countOccurrences(bodyCrlf, findCrlf)
      if (count > 0) {
        working = bodyCrlf
        find = findCrlf
        replace = replaceLf.replace(/\n/g, '\r\n')
      }
    }

    if (count === 0) {
      const firstLine = oldString.split('\n')[0].slice(0, 80)
      return {
        toolCallId: id,
        name: 'edit',
        result:
          `The edit will FAIL if oldString is not found in content.\n` +
          `oldString not found in content. First line: "${firstLine}"\n` +
          `Hint: oldString must match the file character-for-character (including whitespace and newlines). Call read first if unsure.`,
        success: false
      }
    }

    if (count > 1 && !replaceAll) {
      return {
        toolCallId: id,
        name: 'edit',
        result:
          `The edit will FAIL if oldString is found multiple times in the file.\n` +
          `Found ${count} matches for oldString. Provide more surrounding lines in oldString to identify the correct match, or use replaceAll=true.`,
        success: false
      }
    }

    const lineBefore = working.slice(0, working.indexOf(find)).split('\n').length
    let next: string
    let applied: number
    if (replaceAll) {
      applied = count
      next = working.split(find).join(replace)
    } else {
      const idx = working.indexOf(find)
      applied = 1
      next = working.slice(0, idx) + replace + working.slice(idx + find.length)
    }

    const outBody = eol === '\r\n' ? normalizeNewlines(next).replace(/\n/g, '\r\n') : next
    const out = (hasBom ? '\uFEFF' : '') + outBody
    writeFileSync(path + '.bak', original, 'utf-8')
    writeFileSync(path, out, 'utf-8')

    return {
      toolCallId: id,
      name: 'edit',
      result: `Edit applied ✓\nFile: ${path}\nReplaced ${applied} occurrence(s) near line ${lineBefore}\nBackup: ${basename(path)}.bak`,
      success: true
    }
  } catch (err: any) {
    return { toolCallId: id, name: 'edit', result: `Edit failed: ${err.message}`, success: false }
  }
}

const ALLOWED_WRITE = /\.(tex|bib|sty|cls|md|txt|bbl|bst|dtx|ins|json|yml|yaml)$/i

function execWrite(id: string, path: string, content: string): ToolResult {
  if (!path || content === undefined) {
    return { toolCallId: id, name: 'write', result: 'Error: filePath and content are required', success: false }
  }
  if (!ALLOWED_WRITE.test(path)) {
    return {
      toolCallId: id,
      name: 'write',
      result: `Error: unsupported file type: ${path}\nAllowed: .tex/.bib/.sty/.cls/.md/.txt etc.`,
      success: false
    }
  }
  try {
    const dir = dirname(path)
    if (!existsSync(dir)) {
      try {
        require('fs').mkdirSync(dir, { recursive: true })
      } catch (e: any) {
        return { toolCallId: id, name: 'write', result: `Error: cannot create directory ${dir}: ${e.message}`, success: false }
      }
    }
    if (existsSync(path)) {
      writeFileSync(path + '.bak', readFileSync(path, 'utf-8'), 'utf-8')
    }
    writeFileSync(path, content, 'utf-8')
    const lines = content.split('\n').length
    return {
      toolCallId: id,
      name: 'write',
      result: `Wrote ${path}\n${lines} lines, ${content.length} chars${existsSync(path + '.bak') ? '\nBackup: .bak' : ''}`,
      success: true
    }
  } catch (err: any) {
    return { toolCallId: id, name: 'write', result: `Write failed: ${err.message}`, success: false }
  }
}

function execListFiles(id: string, path: string): ToolResult {
  if (!path || !existsSync(path)) {
    return { toolCallId: id, name: 'list_files', result: `Directory not found: ${path || '(empty)'}`, success: false }
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
    result: `Directory: ${path}\n${lines.join('\n') || '(empty)'}`,
    success: true
  }
}

function getFileIcon(name: string): string {
  const ext = extname(name).toLowerCase()
  const map: Record<string, string> = {
    '.tex': '📄',
    '.bib': '📚',
    '.sty': '⚙️',
    '.cls': '📦',
    '.pdf': '📕',
    '.png': '🖼️',
    '.jpg': '🖼️',
    '.md': '📝',
    '.txt': '📃'
  }
  return map[ext] || '📄'
}

function execSearch(id: string, query: string, fileExt?: string): ToolResult {
  const ws = workspaceRoot
  if (!ws || !existsSync(ws)) {
    return { toolCallId: id, name: 'search_project', result: 'Error: workspace root not set', success: false }
  }
  if (!query) {
    return { toolCallId: id, name: 'search_project', result: 'Error: query is required', success: false }
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
          } catch {
            /* skip binary */
          }
        }
      }
    } catch {
      /* skip */
    }
  }

  walk(rootPath)
  return {
    toolCallId: id,
    name: 'search_project',
    result:
      results.length > 0
        ? `Search "${query}" found ${results.length} matches:\n\n${results.join('\n')}`
        : `No matches for "${query}" in workspace`,
    success: true
  }
}

function execGetOutline(id: string, path: string): ToolResult {
  if (!path || !existsSync(path)) {
    return { toolCallId: id, name: 'get_outline', result: `File not found: ${path}`, success: false }
  }
  const content = readFileSync(path, 'utf-8')
  const lines = content.split('\n')
  const outline: string[] = []
  const re = /\\(chapter|section|subsection|subsubsection)\*?\{([^}]*)\}/g
  for (let i = 0; i < lines.length; i++) {
    let m: RegExpExecArray | null
    re.lastIndex = 0
    while ((m = re.exec(lines[i])) !== null) {
      const level = ({ chapter: 0, section: 1, subsection: 2, subsubsection: 3 } as Record<string, number>)[m[1]] || 0
      const indent = '  '.repeat(level)
      const labelMatch = lines[i].match(/\\label\{([^}]+)\}/)
      const label = labelMatch ? ` [${labelMatch[1]}]` : ''
      outline.push(`${indent}${m[1]}: ${m[2]}${label} (line ${i + 1})`)
    }
  }
  return {
    toolCallId: id,
    name: 'get_outline',
    result: outline.length > 0
      ? `Outline (${path}):\n\n${outline.join('\n')}`
      : `(No section structure in ${path})`,
    success: true
  }
}

async function execCompile(id: string, path: string): Promise<ToolResult> {
  if (!path || !existsSync(path)) {
    return {
      toolCallId: id,
      name: 'compile_document',
      result: `File not found: ${path || '(empty)'}\nHint: relative paths resolve against the workspace root.`,
      success: false
    }
  }

  const { spawn } = require('child_process')
  const dir = dirname(path)
  const base = basename(path, extname(path))
  const pdfPath = join(dir, `${base}.pdf`)
  const logPath = join(dir, `${base}.log`)

  let engine = 'xelatex'
  try {
    const head = readFileSync(path, 'utf-8').slice(0, 2500)
    engine = pickLatexEngine(head, 'xelatex')
  } catch {
    /* default */
  }

  const enginePath = getEnginePath(texlivePath, engine) || engine
  const args = ['-interaction=nonstopmode', '-file-line-error', '-halt-on-error', '-synctex=1', basename(path)]
  const env = { ...process.env }
  if (texlivePath) {
    env.PATH = `${texlivePath};${join(texlivePath, 'bin', 'windows')};${env.PATH || ''}`
  }

  return new Promise((resolve) => {
    let log = ''
    let proc: any
    try {
      proc = spawn(enginePath, args, { cwd: dir, windowsHide: true, env })
    } catch (err: any) {
      resolve({
        toolCallId: id,
        name: 'compile_document',
        result: `Failed to start compiler: ${err.message}\nEngine: ${enginePath}\nPlease set TeX Live bin path in settings.`,
        success: false
      })
      return
    }

    proc.stdout?.on('data', (d: Buffer) => {
      log += d.toString('utf-8')
    })
    proc.stderr?.on('data', (d: Buffer) => {
      log += d.toString('utf-8')
    })

    const timer = setTimeout(() => {
      try {
        if (proc.pid) killProcessTree(proc.pid)
      } catch {
        try {
          proc.kill()
        } catch {
          /* ignore */
        }
      }
      resolve({
        toolCallId: id,
        name: 'compile_document',
        result: `Compile timeout (120s)\nEngine: ${enginePath}`,
        success: false
      })
    }, 120000)

    proc.on('close', (code: number) => {
      clearTimeout(timer)
      let fullLog = log
      if (existsSync(logPath)) {
        try {
          fullLog = readFileSync(logPath, 'utf-8')
        } catch {
          /* keep stream log */
        }
      }
      const success = code === 0 && existsSync(pdfPath)
      const { errors, warnings } = parseLog(fullLog, path)

      if (success) {
        const warnNote = warnings.length > 0 ? `\n${warnings.length} warning(s)` : ''
        resolve({
          toolCallId: id,
          name: 'compile_document',
          result: `Compile success ✓\nEngine: ${engine}\nPDF: ${pdfPath}${warnNote}`,
          success: true
        })
        return
      }

      const structured = errors.slice(0, 12).map((e) => {
        const loc = e.line != null ? `${e.file || path}:${e.line}` : e.file || path
        return `${loc}: ${e.message}`
      })
      const errText =
        structured.length > 0
          ? structured.join('\n')
          : fullLog
              .split('\n')
              .filter((l: string) => l.startsWith('!') || /:\d+:/.test(l))
              .slice(0, 12)
              .join('\n')
      const fallback = errText || `Exit code ${code}\n${fullLog.slice(-400)}`
      resolve({
        toolCallId: id,
        name: 'compile_document',
        result: `Compile failed ✗\nEngine: ${engine}\nExit code: ${code}\n\n${fallback}\n\nUse file:line with edit to fix.`,
        success: false
      })
    })

    proc.on('error', (err: Error) => {
      clearTimeout(timer)
      resolve({
        toolCallId: id,
        name: 'compile_document',
        result: `Failed to start compiler: ${err.message}\nEngine path: ${enginePath}\ntexlivePath: ${texlivePath || '(unset)'}`,
        success: false
      })
    })
  })
}
