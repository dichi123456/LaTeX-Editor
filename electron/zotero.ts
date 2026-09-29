const ZOTERO_BASE = 'http://127.0.0.1:23119'
const TIMEOUT = 4000

export interface ZoteroCreator {
  creatorType?: string
  firstName?: string
  lastName?: string
  name?: string
}

export interface ZoteroItem {
  key: string
  itemType?: string
  title?: string
  creators?: ZoteroCreator[]
  date?: string
  publicationTitle?: string
  publisher?: string
  place?: string
  doi?: string
  url?: string
  university?: string
  conferenceName?: string
  abstractNote?: string
  [k: string]: unknown
}

export interface ZoteroCollection {
  key: string
  name: string
  parentCollection?: string | false
  numItems?: number
}

export interface ZoteroSearchHit {
  key: string
  title: string
  authors: string
  year: string
  venue: string
  itemType: string
  citeKey: string
}

export interface ZoteroStatus {
  ok: boolean
  hasBBT: boolean
  message: string
  itemCount?: number
}

// 用 Node 全局 fetch（Electron 主进程）；electron net 对 127.0.0.1 本地端口偶发失败
async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT)
  try {
    const resp = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: {
        Accept: 'application/json',
        ...(init?.headers || {})
      }
    })
    if (!resp.ok) {
      let detail = ''
      try {
        detail = await resp.text()
      } catch { /* ignore */ }
      const err = new Error(`HTTP ${resp.status}${detail ? `: ${detail.slice(0, 120)}` : ''}`) as Error & { status?: number }
      err.status = resp.status
      throw err
    }
    return await resp.json()
  } finally {
    clearTimeout(timer)
  }
}

async function fetchText(url: string): Promise<string> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT)
  try {
    const resp = await fetch(url, { signal: ctrl.signal })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    return await resp.text()
  } finally {
    clearTimeout(timer)
  }
}

function firstName(item: ZoteroItem): string {
  const cs = item.creators || []
  const a = cs.find((c) => c.creatorType === 'author') || cs[0]
  if (!a) return 'anon'
  return (a.lastName || a.name || 'anon').replace(/[^A-Za-z0-9一-龥]/g, '')
}

export function makeCiteKey(item: ZoteroItem): string {
  const author = firstName(item)
  const year = (String(item.date || '').match(/\d{4}/) || ['nd'])[0]
  const words = String(item.title || '')
    .split(/[\s,;:·、（）()]+/)
    .filter((w) => w && /[A-Za-z]/.test(w) && w.length > 2)
  const tag = (words[0] || 'ref').replace(/[^A-Za-z0-9]/g, '')
  let key = `${author}${year}${tag}`.toLowerCase()
  if (!/^[a-z]/.test(key)) key = `z${key}`
  return key.slice(0, 40)
}

function creatorsText(item: ZoteroItem): string {
  return (item.creators || [])
    .map((c) => (c.lastName || c.name || '') + (c.firstName ? ', ' + c.firstName : ''))
    .filter(Boolean)
    .join(' and ')
}

function venueOf(item: ZoteroItem): string {
  return (
    (item.publicationTitle as string) ||
    (item.conferenceName as string) ||
    (item.publisher as string) ||
    (item.university as string) ||
    (item.bookTitle as string) ||
    (item.websiteTitle as string) ||
    ''
  )
}

function yearOf(item: ZoteroItem): string {
  return (String(item.date || '').match(/\d{4}/) || [''])[0]
}

function bibType(itemType: string | undefined): string {
  const map: Record<string, string> = {
    journalArticle: 'article',
    magazineArticle: 'article',
    book: 'book',
    bookSection: 'incollection',
    conferencePaper: 'inproceedings',
    thesis: 'phdthesis',
    report: 'techreport',
    webpage: 'misc',
    preprint: 'misc',
    document: 'misc',
    manuscript: 'unpublished'
  }
  return map[itemType || ''] || 'misc'
}

function esc(s: unknown): string {
  return String(s ?? '').replace(/[{}\\]/g, '').trim()
}

export function itemToBibtex(item: ZoteroItem, citeKey: string): string {
  const type = bibType(item.itemType)
  const fields: string[] = []
  const push = (k: string, v?: unknown) => {
    const val = esc(v)
    if (val) fields.push(`  ${k} = {${val}}`)
  }
  push('title', item.title)
  const au = creatorsText(item)
  if (au) push('author', au)
  push('year', yearOf(item))
  const venue = venueOf(item)
  if (venue) {
    if (type === 'book' || type === 'incollection') push('publisher', item.publisher || venue)
    else if (type === 'phdthesis') push('school', item.university || venue)
    else if (type === 'techreport') push('institution', item.publisher || venue)
    else if (type === 'inproceedings') push('booktitle', venue)
    else push('journal', venue)
  }
  push('doi', item.doi)
  push('url', item.url)
  push('address', item.place)
  return `@${type}{${citeKey},\n${fields.join(',\n')}\n}\n`
}

function flattenOne(x: any): ZoteroItem | null {
  if (!x) return null
  if (x.data && typeof x.data === 'object') {
    return { ...x.data, key: x.key || x.data.key } as ZoteroItem
  }
  if (x.key || x.title) return x as ZoteroItem
  return null
}

function normalizeItems(raw: any): ZoteroItem[] {
  if (!raw) return []
  if (Array.isArray(raw)) {
    return raw
      .map(flattenOne)
      .filter((x): x is ZoteroItem => !!x)
      .filter((x) => x.itemType !== 'attachment' && x.itemType !== 'note')
  }
  if (Array.isArray(raw.items)) return normalizeItems(raw.items)
  if (raw.items) return normalizeItems(raw.items)
  const one = flattenOne(raw)
  return one ? [one] : []
}

function toHit(item: ZoteroItem): ZoteroSearchHit {
  const au = (item.creators || [])
    .filter((c) => !c.creatorType || c.creatorType === 'author')
    .map((c) => c.lastName || c.name || '')
    .filter(Boolean)
  return {
    key: item.key,
    title: item.title || '(无标题)',
    authors: au.slice(0, 3).join(', ') + ((item.creators?.length || 0) > 3 ? ' 等' : ''),
    year: yearOf(item),
    venue: venueOf(item),
    itemType: item.itemType || 'item',
    citeKey: makeCiteKey(item)
  }
}

export async function zoteroStatus(): Promise<ZoteroStatus> {
  // 优先探测本地 API（设置里勾选后直接可用）
  // 注意：不要探测 better-bibtex/cayw —— 会触发「文字处理器集成命令已在运行」弹窗
  try {
    const probe = await fetchJson(`${ZOTERO_BASE}/api/users/0/items?limit=1&format=json`)
    const n = normalizeItems(probe)
    return {
      ok: true,
      hasBBT: false,
      message: `Zotero 本地 API 已连接${n.length ? `（样本 ${n.length}）` : ''}`,
      itemCount: n.length
    }
  } catch (e: any) {
    const msg = String(e?.message || e)
    const status = (e as { status?: number }).status

    // API 不可用时，看 Zotero 是否至少在跑
    let running = false
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 2500)
      try {
        const resp = await fetch(`${ZOTERO_BASE}/connector/ping`, { signal: ctrl.signal })
        const body = await resp.text()
        running = resp.ok && /Zotero is running/i.test(body)
      } finally {
        clearTimeout(timer)
      }
    } catch {
      running = false
    }

    if (status === 403 || /403|not enabled|Forbidden/i.test(msg)) {
      return {
        ok: false,
        hasBBT: false,
        message:
          'Zotero 已运行，但本地 API 未启用。请勾选：设置 → 高级 →「允许此计算机上的其他应用程序与 Zotero 通讯」。'
      }
    }
    if (running) {
      return {
        ok: false,
        hasBBT: false,
        message: `Zotero 在运行，但 API 请求失败：${msg}`
      }
    }
    if (msg.includes('abort') || /ECONNREFUSED|Failed to fetch|network/i.test(msg)) {
      return {
        ok: false,
        hasBBT: false,
        message: '未检测到 Zotero。请打开 Zotero 桌面端，并启用本地 API 后点「刷新连接」。'
      }
    }
    return { ok: false, hasBBT: false, message: `连接失败：${msg}` }
  }
}

export async function zoteroSearch(
  query: string,
  opts?: { limit?: number; collectionKey?: string }
): Promise<ZoteroSearchHit[]> {
  const limit = Math.max(1, Math.min(50, opts?.limit || 20))
  const q = encodeURIComponent((query || '').trim())
  // 排除附件与笔记，避免列表被 PDF 附件占满
  // 本地 API：sort 只能是字段名，方向用 direction=asc|desc（无 dateDesc）
  const typeFilter = '&itemType=-attachment%20||%20note'
  const sort = 'sort=date&direction=desc'
  const coll = opts?.collectionKey
    ? `${ZOTERO_BASE}/api/users/0/collections/${encodeURIComponent(opts.collectionKey)}/items`
    : `${ZOTERO_BASE}/api/users/0/items`
  const url = q
    ? `${coll}?q=${q}&qmode=titleCreatorYear&limit=${limit}&${sort}&format=json${typeFilter}`
    : `${coll}?limit=${limit}&${sort}&format=json${typeFilter}`
  const raw = await fetchJson(url)
  return normalizeItems(raw).map(toHit)
}

export async function zoteroCollections(): Promise<ZoteroCollection[]> {
  const raw = await fetchJson(
    `${ZOTERO_BASE}/api/users/0/collections?format=json&limit=200&sort=name&direction=asc`
  )
  const list: any[] = Array.isArray(raw) ? raw : Array.isArray(raw?.collections) ? raw.collections : []
  const out: ZoteroCollection[] = []
  for (const x of list) {
    const d = x?.data || x
    const key = x?.key || d?.key
    const name = d?.name || d?.title || '(未命名分组)'
    if (!key || !name) continue
    out.push({
      key: String(key),
      name: String(name),
      parentCollection: d?.parentCollection,
      numItems: typeof d?.numItems === 'number' ? d.numItems : undefined
    })
  }
  out.sort((a: ZoteroCollection, b: ZoteroCollection) => a.name.localeCompare(b.name, 'zh'))
  return out
}

export async function zoteroBibtexForKeys(keys: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const key of keys.slice(0, 50)) {
    try {
      const raw = await fetchJson(`${ZOTERO_BASE}/api/users/0/items/${key}?format=json`)
      const item: ZoteroItem = raw?.data ? { ...raw.data, key: raw.key || raw.data.key } : raw
      if (!item?.key && !item?.title) continue
      const ck = makeCiteKey(item)
      out[key] = itemToBibtex(item, ck)
    } catch {
      /* skip failed item */
    }
  }
  return out
}

export async function zoteroFetchItems(keys: string[]): Promise<ZoteroItem[]> {
  const items: ZoteroItem[] = []
  for (const key of keys.slice(0, 80)) {
    try {
      const raw = await fetchJson(`${ZOTERO_BASE}/api/users/0/items/${key}?format=json`)
      const item: ZoteroItem = raw?.data ? { ...raw.data, key: raw.key || raw.data.key } : raw
      if (item?.key || item?.title) items.push(item)
    } catch {
      /* skip */
    }
  }
  return items
}

export async function zoteroExportLibraryBib(limit = 200): Promise<{ bib: string; count: number }> {
  const raw = await fetchJson(
    `${ZOTERO_BASE}/api/users/0/items?limit=${limit}&sort=date&direction=desc&format=json&itemType=-attachment%20||%20note`
  )
  const items = normalizeItems(raw)
  let bib = '% Generated by 墨灵TeX ← Zotero local API\n\n'
  const used = new Set<string>()
  let count = 0
  for (const it of items) {
    if (!it.title && !it.creators?.length) continue
    let ck = makeCiteKey(it)
    let n = 1
    while (used.has(ck)) {
      n += 1
      ck = `${makeCiteKey(it)}${n}`
    }
    used.add(ck)
    bib += itemToBibtex(it, ck) + '\n'
    count += 1
  }
  return { bib, count }
}
