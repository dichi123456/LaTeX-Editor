// 项目图片扫描 — 供 \includegraphics{} 补全使用
let cachedImages: string[] = []
let cacheRoot: string | null = null

const IMAGE_EXT = /\.(png|jpe?g|gif|bmp|svg|webp|pdf|eps)$/i

export async function scanProjectImages(projectRoot: string): Promise<string[]> {
  if (!window.electronAPI) return []
  if (cacheRoot === projectRoot && cachedImages.length > 0) return cachedImages

  const results: string[] = []

  async function walk(dir: string, depth = 0): Promise<void> {
    if (depth > 5 || results.length >= 200) return
    try {
      const entries = await window.electronAPI.listDir(dir)
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue
        if (entry.isDirectory) {
          await walk(entry.path, depth + 1)
        } else if (IMAGE_EXT.test(entry.name)) {
          // 返回相对 projectRoot 的路径（用 / 分隔）
          const rel = entry.path
            .slice(projectRoot.length)
            .replace(/^[\\/]+/, '')
            .replace(/\\/g, '/')
          results.push(rel)
        }
      }
    } catch { /* skip */ }
  }

  await walk(projectRoot)
  cacheRoot = projectRoot
  cachedImages = results
  return results
}

export function getProjectImages(): string[] {
  return cachedImages
}

export function invalidateImageCache(): void {
  cacheRoot = null
  cachedImages = []
}
