// SyncTeX 解析 — 用于正向（源码→PDF）和反向（PDF→源码）同步定位
// 解析 .synctex (plain text) 或 .synctex.gz (gzip) 文件

export interface SyncTexPoint {
  page: number
  x: number
  y: number
  line: number | null
  file: string | null
}

export interface SyncTexFileEntry {
  path: string
  id: number
}

export interface SyncTexData {
  files: Map<number, string>
  // 按页索引，便于反向查找
  byPage: Map<number, SyncTexPoint[]>
  // 全部点（正向按行号查找）
  points: SyncTexPoint[]
  totalPoints: number
}

/**
 * 解析 synctex 文本内容（已解压）
 *
 * 官方格式示例：
 *   SyncTeX Document Begin
 *   VERSION:1
 *   FILE:"main.tex" 0
 *   PAGE:1
 *   INPUT:0
 *   LINE:12
 *   COLUMN:0
 *   x:72.25 y:714.93 h:0 w:0
 */
export function parseSyncTex(content: string): SyncTexData {
  const files = new Map<number, string>()
  const points: SyncTexPoint[] = []
  const byPage = new Map<number, SyncTexPoint[]>()

  const lines = content.split(/\r?\n/)
  let currentPage = 0
  let currentFileId: number | null = null
  let currentLine: number | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // FILE:"path" <id>  —— 官方格式：路径在前，id 在后
    // 兼容 FILE:<id> "path"
    let fileMatch = line.match(/^FILE:"(.+)"\s+(\d+)\s*$/)
    if (fileMatch) {
      files.set(parseInt(fileMatch[2], 10), fileMatch[1])
      continue
    }
    fileMatch = line.match(/^FILE:(\d+)\s+"(.+)"\s*$/)
    if (fileMatch) {
      files.set(parseInt(fileMatch[1], 10), fileMatch[2])
      continue
    }

    // PAGE:<num>
    const pageMatch = line.match(/^PAGE:(\d+)/)
    if (pageMatch) {
      currentPage = parseInt(pageMatch[1], 10)
      continue
    }

    // INPUT:<file_id>
    const inputMatch = line.match(/^INPUT:(\d+)/)
    if (inputMatch) {
      currentFileId = parseInt(inputMatch[1], 10)
      continue
    }

    // LINE:<num>
    const lineNumMatch = line.match(/^LINE:(\d+)/)
    if (lineNumMatch) {
      currentLine = parseInt(lineNumMatch[1], 10)
      continue
    }

    // 坐标: x:<num> y:<num> ...
    // 注意：x/y 行可能带 h/w 等字段；也可能是 h:... v:... 在前
    const posMatch = line.match(/(?:^|\s)x:([\d.-]+)\s+y:([\d.-]+)/)
    if (posMatch && currentPage > 0 && currentLine !== null) {
      const x = parseFloat(posMatch[1])
      const y = parseFloat(posMatch[2])
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue

      const filePath = currentFileId !== null ? files.get(currentFileId) || null : null
      const pt: SyncTexPoint = {
        page: currentPage,
        x,
        y,
        line: currentLine,
        file: filePath
      }
      points.push(pt)
      if (!byPage.has(currentPage)) byPage.set(currentPage, [])
      byPage.get(currentPage)!.push(pt)
    }
  }

  return { files, byPage, points, totalPoints: points.length }
}

/**
 * 正向同步：根据源码行号查找 PDF 位置
 */
export function forwardSearch(
  data: SyncTexData,
  line: number,
  filePath?: string
): SyncTexPoint | null {
  const norm = (p: string | null): string => {
    if (!p) return ''
    return p.replace(/\\/g, '/').toLowerCase()
  }
  const target = filePath ? norm(filePath) : ''
  const targetBase = target ? target.split('/').pop() || '' : ''

  // 精确行号
  const exact = data.points.filter((p) => p.line === line)
  if (exact.length > 0) {
    if (target) {
      const match = exact.find((p) => {
        const f = norm(p.file)
        if (!f) return false
        return f === target || f.endsWith('/' + targetBase) || target.endsWith('/' + (f.split('/').pop() || ''))
      })
      if (match) return match
    }
    return exact[0]
  }

  // 邻近行（±5）
  for (let delta = 1; delta <= 5; delta++) {
    for (const t of [line - delta, line + delta]) {
      if (t < 1) continue
      const near = data.points.find((p) => p.line === t)
      if (near) return near
    }
  }

  return null
}

/**
 * 反向同步：根据 PDF 页码和坐标查找源码行号
 * x, y 是 PDF 用户空间坐标（原点在左下角）
 */
export function inverseSearch(
  data: SyncTexData,
  page: number,
  x: number,
  y: number,
  tolerance = 30
): { line: number; file: string | null } | null {
  const pagePoints = data.byPage.get(page)
  if (!pagePoints || pagePoints.length === 0) return null

  let bestDist = Infinity
  let best: SyncTexPoint | null = null

  for (const pt of pagePoints) {
    const dx = pt.x - x
    const dy = pt.y - y
    const dist = Math.sqrt(dx * dx + dy * dy)
    // 纵向距离优先：同行文字通常 y 接近
    const score = Math.abs(dy) * 2 + Math.abs(dx)
    if (score < bestDist && (Math.abs(dy) < tolerance * 3 || dist < tolerance * 5)) {
      bestDist = score
      best = pt
    }
  }

  if (best && best.line !== null) {
    return { line: best.line, file: best.file }
  }

  // 放宽：取该页最近的一点
  let fallback: SyncTexPoint | null = null
  let fallbackDist = Infinity
  for (const pt of pagePoints) {
    const dist = Math.sqrt((pt.x - x) ** 2 + (pt.y - y) ** 2)
    if (dist < fallbackDist) {
      fallbackDist = dist
      fallback = pt
    }
  }
  if (fallback && fallback.line !== null && fallbackDist < 200) {
    return { line: fallback.line, file: fallback.file }
  }

  return null
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function gunzip(bytes: Uint8Array): Promise<string> {
  // 尝试 DecompressionStream
  try {
    const ds = new DecompressionStream('gzip')
    // 精确拷贝到独立 ArrayBuffer，避免 SharedArrayBuffer 视图问题
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    const stream = new Blob([ab]).stream().pipeThrough(ds)
    return await new Response(stream).text()
  } catch {
    // 备用：手动剥 gzip 头（部分 TeX synctex.gz 是单 member gzip）
    if (bytes.length > 10 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
      // 无法在无库情况下完整解压，交给上层 fetch 备用路径
      throw new Error('DecompressionStream 不可用')
    }
    throw new Error('非 gzip 数据')
  }
}

/**
 * 通过 IPC 读取 synctex 文件（gz 或纯文本）
 */
export async function loadSyncTex(synctexPath: string): Promise<SyncTexData | null> {
  try {
    const isGz = /\.gz$/i.test(synctexPath)

    if (window.electronAPI?.readPdf) {
      const b64 = await window.electronAPI.readPdf(synctexPath)
      if (b64) {
        const bytes = base64ToBytes(b64)
        let text: string
        if (isGz) {
          text = await gunzip(bytes)
        } else {
          text = new TextDecoder().decode(bytes)
        }
        const data = parseSyncTex(text)
        if (data.totalPoints > 0) return data
        // 解析出 0 个点，可能格式异常
        console.warn('[SyncTeX] 解析成功但无坐标点:', synctexPath, 'files=', data.files.size)
        return data.totalPoints > 0 ? data : null
      }
    }

    // 备用：fetch
    const winPath = synctexPath.replace(/\\/g, '/')
    const url = winPath.startsWith('/') ? `file://${winPath}` : `file:///${winPath}`
    const resp = await fetch(url)
    if (!resp.ok) return null

    if (isGz) {
      const ds = new DecompressionStream('gzip')
      const stream = resp.body!.pipeThrough(ds)
      const text = await new Response(stream).text()
      return parseSyncTex(text)
    } else {
      const text = await resp.text()
      return parseSyncTex(text)
    }
  } catch (err) {
    console.warn('加载 SyncTeX 失败:', synctexPath, err)
    return null
  }
}

/**
 * 在 tex 同目录尝试加载 synctex.gz / synctex
 */
export async function loadSyncTexFor(texPath: string): Promise<SyncTexData | null> {
  const base = texPath.replace(/\.tex$/i, '')
  const candidates = [`${base}.synctex.gz`, `${base}.synctex`]
  for (const p of candidates) {
    const data = await loadSyncTex(p)
    if (data && data.totalPoints > 0) {
      console.log(`[SyncTeX] 已加载 ${p}，${data.totalPoints} 个坐标点，${data.files.size} 个文件`)
      return data
    }
  }
  return null
}
