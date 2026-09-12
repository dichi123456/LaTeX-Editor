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
  // line -> list of points
  lineMap: Map<string, SyncTexPoint[]>
}

/**
 * 解析 synctex 文本内容（已解压）
 */
export function parseSyncTex(content: string): SyncTexData {
  const files = new Map<number, string>()
  const lineMap = new Map<string, SyncTexPoint[]>()

  const lines = content.split(/\r?\n/)
  let currentPage = 0
  let currentFileId: number | null = null
  let currentLine: number | null = null
  let currentX = 0
  let currentY = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // 文件声明: FILE:<id> "<path>"
    const fileMatch = line.match(/^FILE:(\d+)\s+"(.+)"$/)
    if (fileMatch) {
      files.set(parseInt(fileMatch[1], 10), fileMatch[2])
      continue
    }

    // 页: PAGE:<num>
    const pageMatch = line.match(/^PAGE:(\d+)/)
    if (pageMatch) {
      currentPage = parseInt(pageMatch[1], 10)
      continue
    }

    // 输入: INPUT:<file_id>
    const inputMatch = line.match(/^INPUT:(\d+)/)
    if (inputMatch) {
      currentFileId = parseInt(inputMatch[1], 10)
      continue
    }

    // 行: LINE:<num>
    const lineNumMatch = line.match(/^LINE:(\d+)/)
    if (lineNumMatch) {
      currentLine = parseInt(lineNumMatch[1], 10)
      continue
    }

    // 坐标: x:<num> y:<num> h:<num> v:<num> w:<num>
    const posMatch = line.match(/^x:([\d.-]+)\s+y:([\d.-]+)/)
    if (posMatch && currentPage > 0 && currentLine !== null) {
      currentX = parseFloat(posMatch[1])
      currentY = parseFloat(posMatch[2])

      const filePath = currentFileId !== null ? files.get(currentFileId) || null : null
      const key = `${currentPage}:${currentLine}`
      if (!lineMap.has(key)) {
        lineMap.set(key, [])
      }
      lineMap.get(key)!.push({
        page: currentPage,
        x: currentX,
        y: currentY,
        line: currentLine,
        file: filePath
      })
    }
  }

  return { files, lineMap }
}

/**
 * 正向同步：根据源码行号查找 PDF 位置
 * 返回该行在 PDF 中的页码和坐标（如果有多个，取第一个）
 */
export function forwardSearch(
  data: SyncTexData,
  line: number,
  filePath?: string
): SyncTexPoint | null {
  // 尝试精确行号
  for (const [key, points] of data.lineMap) {
    const [, lineNum] = key.split(':').map(Number)
    if (lineNum === line) {
      // 如果指定了文件，优先匹配
      if (filePath) {
        const match = points.find(
          (p) => p.file && (p.file.endsWith(filePath) || filePath.endsWith(p.file.replace(/^.*[\\/]/, '')))
        )
        if (match) return match
      }
      return points[0]
    }
  }

  // 尝试邻近行（±2）
  for (let delta = 1; delta <= 2; delta++) {
    for (const target of [line - delta, line + delta]) {
      if (target < 1) continue
      for (const [key, points] of data.lineMap) {
        const [, lineNum] = key.split(':').map(Number)
        if (lineNum === target && points.length > 0) {
          return points[0]
        }
      }
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
  tolerance = 20
): { line: number; file: string | null } | null {
  let bestDist = Infinity
  let best: SyncTexPoint | null = null

  for (const [, points] of data.lineMap) {
    for (const pt of points) {
      if (pt.page !== page) continue
      const dist = Math.sqrt((pt.x - x) ** 2 + (pt.y - y) ** 2)
      if (dist < bestDist && dist < tolerance * 10) {
        bestDist = dist
        best = pt
      }
    }
  }

  if (best && best.line !== null) {
    return { line: best.line, file: best.file }
  }
  return null
}

/**
 * 通过 fetch 加载 synctex 文件（gz 或纯文本）
 */
export async function loadSyncTex(synctexPath: string): Promise<SyncTexData | null> {
  try {
    // 通过 IPC 读取文件
    const isGz = /\.gz$/i.test(synctexPath)

    if (window.electronAPI?.readPdf) {
      // 复用 readPdf 读取二进制
      const buf = await window.electronAPI.readPdf(synctexPath)
      if (buf) {
        if (isGz) {
          // 使用 DecompressionStream 解压 gzip
          const ds = new DecompressionStream('gzip')
          const stream = new Blob([buf]).stream().pipeThrough(ds)
          const text = await new Response(stream).text()
          return parseSyncTex(text)
        } else {
          const text = new TextDecoder().decode(buf)
          return parseSyncTex(text)
        }
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
    console.warn('加载 SyncTeX 失败:', err)
    return null
  }
}
