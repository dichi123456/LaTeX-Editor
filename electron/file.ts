import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync, unlinkSync, renameSync } from 'fs'
import { join, basename, extname } from 'path'
import { app } from 'electron'

export interface DirEntry {
  name: string
  path: string
  isDirectory: boolean
  children?: DirEntry[]
}

const MAX_RECENT = 20

function getRecentPath(): string {
  return join(app.getPath('userData'), 'recent.json')
}

function getRecentWorkspacesPath(): string {
  return join(app.getPath('userData'), 'recent-workspaces.json')
}

export async function readTextFile(filePath: string): Promise<{ content: string; encoding: string }> {
  const buf = readFileSync(filePath)
  let encoding = 'utf-8'
  let content: string

  // 检测 BOM
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    content = buf.toString('utf-8')
    encoding = 'utf-8-bom'
  } else if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    content = buf.toString('utf16le')
    encoding = 'utf-16le'
  } else if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    // UTF-16 BE - 用 iconv 或简单转换
    content = buf.swap16().toString('utf16le')
    encoding = 'utf-16be'
  } else {
    // 尝试 UTF-8，失败则按 GBK 处理
    content = buf.toString('utf-8')
    // 简单检测：如果包含替换字符 U+FFFD，可能是 GBK
    if (content.includes('�')) {
      try {
        // 尝试用 latin1 读取再判断，或使用 iconv-lite
        // 这里简化处理：检测 GBK 特征字节
        const gbkLikely = detectLikelyGBK(buf)
        if (gbkLikely) {
          // 使用 TextDecoder 尝试 gbk
          try {
            const decoder = new TextDecoder('gbk')
            const gbkContent = decoder.decode(buf)
            if (!gbkContent.includes('�')) {
              content = gbkContent
              encoding = 'gbk'
            }
          } catch {
            // keep utf-8
          }
        }
      } catch {
        // keep utf-8
      }
    }
  }

  return { content, encoding }
}

function detectLikelyGBK(buf: Buffer): boolean {
  // 简单启发式：中文 UTF-8 通常以 E4-E9 开头的三字节序列
  // GBK 中文以高位字节 81-FE 开头
  let utf8Valid = 0
  let gbkSuspect = 0
  for (let i = 0; i < Math.min(buf.length, 500); i++) {
    const b = buf[i]
    if (b < 0x80) continue
    if (b >= 0xc2 && b <= 0xf4) utf8Valid++
    if (b >= 0x81 && b <= 0xfe) gbkSuspect++
  }
  // 如果看起来更像 GBK 而不像有效 UTF-8 多字节
  return gbkSuspect > utf8Valid * 2
}

export async function writeTextFile(filePath: string, content: string): Promise<boolean> {
  try {
    writeFileSync(filePath, content, 'utf-8')
    return true
  } catch (err) {
    console.error('写入文件失败:', err)
    return false
  }
}

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'out', 'release',
  '__pycache__', '.vs', '.idea', '.vscode', 'bin', 'obj'
])

const TEX_EXTENSIONS = new Set([
  '.tex', '.sty', '.cls', '.bib', '.bbl', '.bst', '.dtx', '.ins',
  '.txt', '.md', '.png', '.jpg', '.jpeg', '.gif', '.pdf', '.eps',
  '.svg', '.eps', '.log', '.aux'
])

export function listDirectory(dirPath: string, depth = 0): DirEntry[] {
  if (depth > 6) return []

  let entries: DirEntry[] = []
  try {
    const items = readdirSync(dirPath, { withFileTypes: true })
    for (const item of items) {
      if (item.name.startsWith('.') && item.name !== '.latexmkrc') continue
      if (item.isDirectory() && IGNORE_DIRS.has(item.name)) continue

      const fullPath = join(dirPath, item.name)
      const entry: DirEntry = {
        name: item.name,
        path: fullPath,
        isDirectory: item.isDirectory()
      }

      if (item.isDirectory()) {
        entry.children = listDirectory(fullPath, depth + 1)
      }

      entries.push(entry)
    }
  } catch (err) {
    console.error('列目录失败:', err)
  }

  // 目录优先，然后按名称排序
  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name, 'zh-CN')
  })

  return entries
}

export async function createFile(dirPath: string, fileName: string): Promise<string | null> {
  try {
    const fullPath = join(dirPath, fileName)
    if (existsSync(fullPath)) return null
    writeFileSync(fullPath, '', 'utf-8')
    return fullPath
  } catch {
    return null
  }
}

export async function createDir(dirPath: string, dirName: string): Promise<string | null> {
  try {
    const fullPath = join(dirPath, dirName)
    mkdirSync(fullPath, { recursive: true })
    return fullPath
  } catch {
    return null
  }
}

export async function deletePath(targetPath: string): Promise<boolean> {
  try {
    const st = statSync(targetPath)
    if (st.isDirectory()) {
      // 递归删除
      const items = readdirSync(targetPath)
      for (const item of items) {
        deletePathRecursive(join(targetPath, item))
      }
      const { rmdirSync } = require('fs')
      rmdirSync(targetPath)
    } else {
      unlinkSync(targetPath)
    }
    return true
  } catch {
    return false
  }
}

function deletePathRecursive(p: string): void {
  try {
    const st = statSync(p)
    if (st.isDirectory()) {
      const items = readdirSync(p)
      for (const item of items) {
        deletePathRecursive(join(p, item))
      }
      const { rmdirSync } = require('fs')
      rmdirSync(p)
    } else {
      unlinkSync(p)
    }
  } catch {
    // ignore
  }
}

export async function renamePath(oldPath: string, newPath: string): Promise<boolean> {
  try {
    renameSync(oldPath, newPath)
    return true
  } catch {
    return false
  }
}

export async function getFileStats(filePath: string): Promise<{ size: number; mtime: number } | null> {
  try {
    const st = statSync(filePath)
    return { size: st.size, mtime: st.mtimeMs }
  } catch {
    return null
  }
}

export async function getRecentFiles(): Promise<string[]> {
  try {
    const p = getRecentPath()
    if (existsSync(p)) {
      return JSON.parse(readFileSync(p, 'utf-8'))
    }
  } catch {
    // ignore
  }
  return []
}

export async function addRecentFile(filePath: string): Promise<void> {
  try {
    let recent = await getRecentFiles()
    recent = recent.filter((f) => f !== filePath)
    recent.unshift(filePath)
    if (recent.length > MAX_RECENT) recent = recent.slice(0, MAX_RECENT)
    writeFileSync(getRecentPath(), JSON.stringify(recent, null, 2), 'utf-8')
  } catch (err) {
    console.error('更新最近文件失败:', err)
  }
}

export async function getRecentWorkspaces(): Promise<string[]> {
  try {
    const p = getRecentWorkspacesPath()
    if (existsSync(p)) {
      return JSON.parse(readFileSync(p, 'utf-8'))
    }
  } catch {
    // ignore
  }
  return []
}

export async function addRecentWorkspace(workspacePath: string): Promise<void> {
  try {
    let recent = await getRecentWorkspaces()
    recent = recent.filter((f) => f !== workspacePath)
    recent.unshift(workspacePath)
    if (recent.length > MAX_RECENT) recent = recent.slice(0, MAX_RECENT)
    writeFileSync(getRecentWorkspacesPath(), JSON.stringify(recent, null, 2), 'utf-8')
  } catch (err) {
    console.error('更新最近工作区失败:', err)
  }
}
