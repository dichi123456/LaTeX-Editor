<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, computed, watch } from 'vue'
import { useDocStore } from '../stores/docs'

const emit = defineEmits<{
  (e: 'close'): void
}>()

const docStore = useDocStore()

interface Hit {
  key: string
  title: string
  authors: string
  year: string
  venue: string
  itemType: string
  citeKey: string
}

interface Coll {
  key: string
  name: string
  numItems?: number
}

const statusMsg = ref('正在连接 Zotero…')
const statusOk = ref(false)
const statusChecking = ref(false)
const autoCheck = ref(true)
const loading = ref(false)
const query = ref('')
const collectionKey = ref('')
const collections = ref<Coll[]>([])
const items = ref<Hit[]>([])
const error = ref('')
const multi = ref(false)
const selected = ref<Set<string>>(new Set())
const busy = ref(false)
const toast = ref('')
const inputRef = ref<HTMLInputElement | null>(null)
let pollTimer: ReturnType<typeof setTimeout> | null = null
let searchTimer: ReturnType<typeof setTimeout> | null = null
let searchSeq = 0

/** 打开时只拉最近 N 条，避免全库卡顿 */
const RECENT_LIMIT = 12

const selectedCount = computed(() => selected.value.size)

const searchHint = computed(() => {
  if (!statusOk.value) return '输入关键词后自动检索'
  if (!query.value && !collectionKey.value) return `最近文献（最多 ${RECENT_LIMIT} 条）`
  return `匹配 ${items.value.length} 条`
})

async function loadCollections() {
  try {
    const res = await window.electronAPI.zoteroCollections()
    if (res.success) collections.value = res.items
  } catch {
    collections.value = []
  }
}

async function refreshStatus(opts?: { manual?: boolean }) {
  if (statusChecking.value) return
  statusChecking.value = true
  if (opts?.manual) {
    statusMsg.value = statusOk.value ? '状态检查中…' : '正在连接 Zotero…'
  }
  try {
    const st = await window.electronAPI.zoteroStatus()
    const wasOk = statusOk.value
    statusOk.value = st.ok
    statusMsg.value = st.message
    if (st.ok) {
      if (!wasOk || opts?.manual) {
        void loadCollections()
        void doSearch()
      } else if (!collections.value.length) {
        void loadCollections()
      }
    }
  } catch (e: any) {
    statusOk.value = false
    statusMsg.value = String(e?.message || e)
  } finally {
    statusChecking.value = false
  }
}

function toggleAutoCheck() {
  autoCheck.value = !autoCheck.value
  if (autoCheck.value) startPolling()
  else stopPolling()
}

function startPolling() {
  stopPolling()
  const tick = async () => {
    if (!autoCheck.value) return
    await refreshStatus()
    const delay = statusOk.value ? 20000 : 4000
    pollTimer = setTimeout(tick, delay)
  }
  pollTimer = setTimeout(tick, statusOk.value ? 20000 : 4000)
}

function stopPolling() {
  if (pollTimer) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
}

function scheduleSearch() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    void doSearch()
  }, 280)
}

watch(query, () => {
  scheduleSearch()
})

watch(collectionKey, () => {
  scheduleSearch()
})

async function doSearch() {
  if (!statusOk.value) return
  const seq = ++searchSeq
  loading.value = true
  error.value = ''
  try {
    const res = await window.electronAPI.zoteroSearch({
      query: query.value,
      limit: RECENT_LIMIT,
      collectionKey: collectionKey.value || undefined
    })
    if (seq !== searchSeq) return
    if (!res.success) {
      error.value = res.error || '检索失败'
      items.value = []
    } else {
      items.value = res.items
      if (!query.value && !collectionKey.value && res.items.length === 0) {
        error.value = '文献库为空或无权访问'
      }
    }
  } catch (e: any) {
    if (seq === searchSeq) {
      error.value = String(e?.message || e)
    }
  } finally {
    if (seq === searchSeq) loading.value = false
  }
}

function toggleSelect(h: Hit) {
  if (!multi.value) return
  const next = new Set(selected.value)
  if (next.has(h.key)) next.delete(h.key)
  else next.add(h.key)
  selected.value = next
}

function keysToUse(): string[] {
  if (multi.value && selected.value.size) return [...selected.value]
  if (items.value.length) return [items.value[0].key]
  return []
}

function flash(msg: string) {
  toast.value = msg
  window.setTimeout(() => {
    if (toast.value === msg) toast.value = ''
  }, 2200)
}

async function insertCite(h: Hit) {
  window.dispatchEvent(
    new CustomEvent('insert-text', { detail: { text: `\\cite{${h.citeKey}}` } })
  )
  await ensureBib([h])
  emit('close')
}

async function ensureBib(keys: Hit[] | string[]) {
  const hitKeys = keys.map((k) => (typeof k === 'string' ? k : k.key))
  try {
    const res = await window.electronAPI.zoteroBibtex(hitKeys)
    if (!res.success) return
    // 追加/合并到项目中已存在的 .bib，或主 .tex 同目录 references.bib
    const bibPath = pickBibPath()
    let existing = ''
    if (bibPath) {
      try {
        const r = await window.electronAPI.readFile(bibPath)
        existing = r.content
      } catch {
        existing = ''
      }
    }
    if (!bibPath) return
    let content = existing.endsWith('\n') || existing === '' ? existing : existing + '\n'
    for (const item of Object.values(res.map)) {
      if (item.bibtex && !content.includes(`{${item.citeKey},`)) {
        content += '\n' + item.bibtex + '\n'
      }
    }
    if (content !== existing) {
      await window.electronAPI.writeFile(bibPath, content)
      window.dispatchEvent(new CustomEvent('refresh-file-tree'))
    }
  } catch {
    /* bib merge best-effort */
  }
}

function pickBibPath(): string | null {
  const root = docStore.projectRoot
  const main = docStore.mainTexPath
  if (root) {
    const name = 'references.bib'
    return root.replace(/[\\/]+$/, '') + '\\' + name
  }
  if (main) {
    const dir = main.replace(/[\\/][^\\/]+$/, '')
    return dir + '\\references.bib'
  }
  return null
}

async function insertSelected() {
  const keys = keysToUse()
  if (!keys.length) {
    flash('请先选择条目')
    return
  }
  const hits = items.value.filter((h) => keys.includes(h.key))
  const cites = hits.map((h) => h.citeKey).join(', ')
  window.dispatchEvent(new CustomEvent('insert-text', { detail: { text: `\\cite{${cites}}` } }))
  await ensureBib(hits.length ? hits : keys)
  emit('close')
}

async function copyBibtex(h: Hit) {
  try {
    const res = await window.electronAPI.zoteroBibtex([h.key])
    const entry = res.map?.[h.key]?.bibtex
    if (entry) {
      await navigator.clipboard.writeText(entry)
      flash('已复制 BibTeX')
    } else {
      flash('生成 BibTeX 失败')
    }
  } catch {
    flash('生成 BibTeX 失败')
  }
}

async function exportLibrary() {
  busy.value = true
  try {
    const res = await window.electronAPI.zoteroExportBib()
    if (res.error || !res.bib) {
      flash(res.error || '导出失败')
      return
    }
    const path = pickBibPath()
    if (!path) {
      flash('请先打开项目目录')
      return
    }
    let prev = ''
    try {
      prev = (await window.electronAPI.readFile(path)).content
    } catch {
      prev = ''
    }
    // 整库导出直接覆盖 references.bib
    await window.electronAPI.writeFile(path, res.bib)
    window.dispatchEvent(new CustomEvent('refresh-file-tree'))
    flash(`已写入 references.bib（${res.count} 条）${prev ? '，原文件已替换' : ''}`)
  } finally {
    busy.value = false
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
  } else if (e.key === 'Enter' && !e.isComposing) {
    if (items.value[0] && !multi.value) insertCite(items.value[0])
    else insertSelected()
  }
}

function onOverlay(e: MouseEvent) {
  if ((e.target as HTMLElement).classList.contains('zotero-overlay')) emit('close')
}

onMounted(() => {
  void refreshStatus({ manual: true }).then(() => startPolling())
  nextTick(() => inputRef.value?.focus())
  window.addEventListener('keydown', onKeydown)
})
onUnmounted(() => {
  stopPolling()
  if (searchTimer) clearTimeout(searchTimer)
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div class="zotero-overlay" @click="onOverlay">
    <div class="zotero-modal soft-pop">
      <div class="z-head">
        <div class="z-title">
          <span class="z-badge" :class="{ ok: statusOk }"></span>
          <span>Zotero 文献</span>
        </div>
        <button class="z-close" title="关闭 (Esc)" @click="emit('close')">✕</button>
      </div>

      <div class="z-status-row">
        <div class="z-status" :class="{ err: !statusOk && !statusChecking, checking: statusChecking }">
          {{ statusMsg }}
        </div>
        <div class="z-status-actions">
          <label class="z-auto" title="面板打开期间自动重试连接">
            <input type="checkbox" :checked="autoCheck" @change="toggleAutoCheck" />
            自动检测
          </label>
          <button
            class="z-btn sm ghost"
            :disabled="statusChecking"
            title="立即检查 Zotero 本地 API 连接"
            @click="refreshStatus({ manual: true })"
          >
            {{ statusChecking ? '检查中…' : '刷新连接' }}
          </button>
        </div>
      </div>

      <div class="z-toolbar">
        <select
          v-model="collectionKey"
          class="z-select"
          title="按 Zotero 分组（文件夹）筛选"
          :disabled="!statusOk"
        >
          <option value="">全部文献</option>
          <option v-for="c in collections" :key="c.key" :value="c.key">
            {{ c.name }}{{ c.numItems != null ? `（${c.numItems}）` : '' }}
          </option>
        </select>
        <input
          ref="inputRef"
          v-model="query"
          class="z-input"
          type="search"
          placeholder="输入关键词自动检索…"
          :disabled="!statusOk"
        />
        <button class="z-btn" :disabled="!statusOk || loading" @click="doSearch()">
          {{ loading ? '检索中…' : '搜索' }}
        </button>
        <button class="z-btn ghost" :class="{ on: multi }" title="多选引用" @click="multi = !multi">
          多选{{ multi && selectedCount ? ` (${selectedCount})` : '' }}
        </button>
      </div>
      <div class="z-hint-row">
        <span>{{ searchHint }}</span>
        <span v-if="query" class="z-hint">输入即搜 · 约 0.3s 防抖</span>
      </div>

      <div class="z-body">
        <div v-if="error" class="z-empty">{{ error }}</div>
        <div v-else-if="!items.length" class="z-empty">
          {{ statusOk ? '无结果。试试其他关键词，或切换分组。' : '请先启动 Zotero 桌面端并启用本地 API' }}
        </div>
        <div v-else class="z-list">
          <div
            v-for="h in items"
            :key="h.key"
            class="z-item"
            :class="{ checked: selected.has(h.key) }"
            @click="toggleSelect(h)"
            @dblclick="insertCite(h)"
          >
            <input
              v-if="multi"
              type="checkbox"
              class="z-check"
              :checked="selected.has(h.key)"
              @click.stop="toggleSelect(h)"
            />
            <div class="z-meta">
              <div class="z-item-title">{{ h.title }}</div>
              <div class="z-item-sub">
                <span v-if="h.authors">{{ h.authors }}</span>
                <span v-if="h.year"> · {{ h.year }}</span>
                <span v-if="h.venue"> · {{ h.venue }}</span>
              </div>
              <code class="z-cite">{{ h.citeKey }}</code>
            </div>
            <div class="z-actions">
              <button class="z-btn sm" title="插入 \cite 并写入 references.bib" @click.stop="insertCite(h)">
                插入
              </button>
              <button class="z-btn sm ghost" title="复制 BibTeX" @click.stop="copyBibtex(h)">复制</button>
            </div>
          </div>
        </div>
      </div>

      <div class="z-foot">
        <button class="z-btn ghost" :disabled="busy || !statusOk" @click="exportLibrary">
          {{ busy ? '导出中…' : '导出整库 → references.bib' }}
        </button>
        <div class="z-foot-right">
          <button v-if="multi && selectedCount" class="z-btn" @click="insertSelected">
            插入所选 {{ selectedCount }} 条
          </button>
          <span class="z-hint">双击条目插入引用</span>
          <button class="z-btn" @click="emit('close')">关闭</button>
        </div>
      </div>

      <div v-if="toast" class="z-toast">{{ toast }}</div>
    </div>
  </div>
</template>

<style scoped>
.zotero-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  animation: softIn var(--dur-fast, 140ms) var(--ease-out, ease);
}
.zotero-modal {
  position: relative;
  width: min(720px, calc(100vw - 48px));
  /* 固定高度：检索时列表增减不改变窗口，内部滚动 */
  height: min(560px, calc(100vh - 64px));
  max-height: min(560px, calc(100vh - 64px));
  min-height: min(420px, calc(100vh - 64px));
  display: flex;
  flex-direction: column;
  background: var(--glass-fill);
  backdrop-filter: blur(24px) saturate(1.6);
  -webkit-backdrop-filter: blur(24px) saturate(1.6);
  border: 1px solid var(--glass-stroke);
  border-radius: 12px;
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}
.soft-pop {
  animation: softPop var(--dur-slow, 220ms) var(--ease-out, ease);
}
.z-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px 8px;
  flex-shrink: 0;
}
.z-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}
.z-badge {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-tertiary);
}
.z-badge.ok {
  background: var(--success);
  box-shadow: 0 0 0 3px rgba(52, 211, 153, 0.15);
}
.z-close {
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 14px;
  cursor: pointer;
  padding: 2px 8px;
  border-radius: 6px;
}
.z-close:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.z-status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 14px 8px;
  flex-shrink: 0;
  min-height: 28px;
}
.z-status {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1.4;
}
.z-status.checking {
  opacity: 0.75;
}
.z-status.err {
  color: var(--warning);
}
.z-status-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.z-auto {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-tertiary);
  cursor: pointer;
  user-select: none;
}
.z-auto input {
  accent-color: var(--accent);
}
.z-toolbar {
  display: flex;
  gap: 8px;
  padding: 0 14px 6px;
  align-items: center;
  flex-wrap: nowrap;
  flex-shrink: 0;
  min-height: 44px;
}
.z-select {
  height: 32px;
  max-width: 180px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 12px;
  outline: none;
  cursor: pointer;
}
.z-select:focus {
  border-color: var(--accent);
}
.z-hint-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 0 14px 8px;
  font-size: 11px;
  color: var(--text-tertiary);
  flex-shrink: 0;
  min-height: 16px;
  white-space: nowrap;
  overflow: hidden;
}
.z-hint-row .z-hint {
  color: var(--accent);
  opacity: 0.85;
}
.z-input {
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 13px;
  outline: none;
}
.z-input:focus {
  border-color: var(--accent);
}
.z-btn {
  height: 32px;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: var(--accent);
  color: #fff;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  transition: opacity var(--dur-fast) var(--ease-soft);
}
.z-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.z-btn.ghost {
  background: transparent;
  border-color: var(--border);
  color: var(--text-secondary);
}
.z-btn.ghost.on {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-light);
}
.z-btn.sm {
  height: 26px;
  padding: 0 8px;
  font-size: 11px;
}
.z-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  border-top: 1px solid var(--border);
  padding: 6px 8px;
  /* 始终占满剩余空间，条目增减不影响弹层外框 */
  contain: content;
}
.z-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
  height: 100%;
  padding: 28px 16px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 12px;
  box-sizing: border-box;
}
.z-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.z-item {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-soft);
}
.z-item:hover {
  background: var(--bg-hover);
}
.z-item.checked {
  border-color: var(--accent);
  background: var(--accent-light);
}
.z-check {
  margin-top: 4px;
}
.z-meta {
  flex: 1;
  min-width: 0;
}
.z-item-title {
  font-size: 13px;
  color: var(--text-primary);
  font-weight: 500;
  line-height: 1.35;
}
.z-item-sub {
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.z-cite {
  display: inline-block;
  margin-top: 3px;
  font-size: 10px;
  color: var(--accent);
  background: var(--accent-light);
  padding: 1px 6px;
  border-radius: 4px;
  font-family: var(--font-mono);
}
.z-actions {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex-shrink: 0;
}
.z-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
  min-height: 48px;
}
.z-foot-right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.z-hint {
  font-size: 11px;
  color: var(--text-tertiary);
}
.z-toast {
  position: absolute;
  left: 50%;
  bottom: 56px;
  transform: translateX(-50%);
  background: var(--bg-primary);
  border: 1px solid var(--border-strong);
  color: var(--text-primary);
  font-size: 12px;
  padding: 6px 12px;
  border-radius: 8px;
  box-shadow: var(--shadow-lg);
  animation: softPop var(--dur-base, 180ms) var(--ease-out, ease);
  z-index: 5;
}
</style>
