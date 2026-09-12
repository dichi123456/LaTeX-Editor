// BibTeX 深度集成 — 扫描项目中所有 .bib 文件，提取引用键与元数据

export interface BibEntry {
  key: string
  type: string // article, book, inproceedings, etc.
  title?: string
  author?: string
  year?: string
  journal?: string
}

export interface BibDatabase {
  entries: Map<string, BibEntry>
  // 按来源文件分组
  byFile: Map<string, BibEntry[]>
}

/**
 * 解析单个 .bib 文件内容
 */
export function parseBibContent(content: string): BibEntry[] {
  const entries: BibEntry[] = []
  // 匹配 @type{key, ... }
  const entryRe = /@(\w+)\s*\{\s*([^,\s]+)\s*,/g
  let match: RegExpExecArray | null

  while ((match = entryRe.exec(content)) !== null) {
    const type = match[1].toLowerCase()
    const key = match[2]

    // 找到这个条目的结束（匹配花括号）
    let depth = 1
    let start = match.index + match[0].length
    let i = start
    while (i < content.length && depth > 0) {
      if (content[i] === '{') depth++
      else if (content[i] === '}') depth--
      i++
    }
    const body = content.slice(start, i - 1)

    const entry: BibEntry = { key, type }

    // 提取常见字段
    const titleMatch = body.match(/title\s*=\s*[{"]([^}"]+)[}"]/i)
    if (titleMatch) entry.title = titleMatch[1].trim()

    const authorMatch = body.match(/author\s*=\s*[{"]([^}"]+)[}"]/i)
    if (authorMatch) entry.author = authorMatch[1].trim()

    const yearMatch = body.match(/year\s*=\s*[{"]?(\d{4})[}"]?/i)
    if (yearMatch) entry.year = yearMatch[1]

    const journalMatch = body.match(/journal\s*=\s*[{"]([^}"]+)[}"]/i)
    if (journalMatch) entry.journal = journalMatch[1].trim()

    entries.push(entry)
  }

  return entries
}

/**
 * 从项目目录扫描所有 .bib 文件并合并
 * 注意：需要前端传入已读取的 .bib 文件内容
 */
export class BibScanner {
  private db: BibDatabase = {
    entries: new Map(),
    byFile: new Map()
  }

  /**
   * 添加一个 .bib 文件的内容
   */
  addFile(filePath: string, content: string): void {
    const entries = parseBibContent(content)
    this.db.byFile.set(filePath, entries)
    for (const e of entries) {
      this.db.entries.set(e.key, e)
    }
  }

  /**
   * 移除一个文件
   */
  removeFile(filePath: string): void {
    const entries = this.db.byFile.get(filePath)
    if (entries) {
      for (const e of entries) {
        this.db.entries.delete(e.key)
      }
      this.db.byFile.delete(filePath)
    }
  }

  /**
   * 获取所有引用键
   */
  getKeys(): string[] {
    return [...this.db.entries.keys()].sort()
  }

  /**
   * 获取所有条目
   */
  getEntries(): BibEntry[] {
    return [...this.db.entries.values()]
  }

  /**
   * 按前缀搜索
   */
  search(prefix: string): BibEntry[] {
    const p = prefix.toLowerCase()
    return this.getEntries().filter(
      (e) => e.key.toLowerCase().includes(p) || (e.title || '').toLowerCase().includes(p)
    )
  }

  /**
   * 获取数据库
   */
  getDatabase(): BibDatabase {
    return this.db
  }

  clear(): void {
    this.db.entries.clear()
    this.db.byFile.clear()
  }
}

// 全局单例
export const bibScanner = new BibScanner()

/**
 * 从项目目录异步扫描 .bib 文件
 * 需要 projectRoot 和 listDir/readFile API
 */
export async function scanProjectBibs(projectRoot: string): Promise<number> {
  if (!window.electronAPI) return 0

  bibScanner.clear()

  async function walk(dir: string, depth = 0): Promise<void> {
    if (depth > 4) return
    const entries = await window.electronAPI.listDir(dir)
    for (const entry of entries) {
      if (entry.isDirectory) {
        await walk(entry.path, depth + 1)
      } else if (/\.bib$/i.test(entry.name)) {
        try {
          const { content } = await window.electronAPI.readFile(entry.path)
          bibScanner.addFile(entry.path, content)
        } catch {
          // skip unreadable
        }
      }
    }
  }

  await walk(projectRoot)
  return bibScanner.getKeys().length
}

/**
 * 从 .tex 文本中提取已有的 \cite 键（用于补全时排除）
 */
export function extractExistingCites(texContent: string): Set<string> {
  const keys = new Set<string>()
  const re = /\\cite[tp]?\*?(?:\[[^\]]*\])?\{([^}]+)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(texContent))) {
    for (const k of m[1].split(',')) {
      const key = k.trim()
      if (key) keys.add(key)
    }
  }
  return keys
}
