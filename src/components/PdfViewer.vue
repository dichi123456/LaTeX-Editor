<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick, inject, computed } from 'vue'
import { useCompileStore } from '../stores/compile'
import type { CompileMode } from '../stores/compile'

const compileStore = useCompileStore()
const compileDoc = inject<(mode?: CompileMode) => Promise<void>>('compileDoc', async () => {})

// 编译模式（记住上次选择）
const showCompileMenu = ref(false)
const compileMode = ref<CompileMode>('quick')
const MODE_LABELS: Record<CompileMode, string> = {
  quick: '快速编译',
  full: '完整编译',
  clean: '从头编译'
}

function runCompile(mode: CompileMode) {
  compileMode.value = mode
  showCompileMenu.value = false
  compileDoc(mode)
}

function compileWithCurrent() {
  if (compileStore.isCompiling) return
  compileDoc(compileMode.value)
}

function toggleCompileMenu() {
  showCompileMenu.value = !showCompileMenu.value
}
function closeCompileMenu(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (!target.closest('.compile-dropdown')) {
    showCompileMenu.value = false
  }
}

// PDF 渲染状态
const containerRef = ref<HTMLElement | null>(null)
const pagesRef = ref<HTMLElement | null>(null)
const currentPage = ref(1)
const totalPages = ref(0)
const scale = ref(1.15)
const fitMode = ref<'width' | 'page' | 'custom'>('width')
const rotation = ref(0)
const loading = ref(false)
const error = ref('')
const hasPdf = ref(false)

// 大纲导航
interface PdfOutlineItem {
  title: string
  page: number | null
  children: PdfOutlineItem[]
}
const outline = ref<PdfOutlineItem[]>([])
const showOutline = ref(false)

// 页码跳转输入
const pageInput = ref<string>('')

let pdfDoc: any = null
let pageCanvases: HTMLCanvasElement[] = []
let scrollObserver: IntersectionObserver | null = null
let pdfjs: any = null
// 当前已加载的 PDF 路径（用于避免重复加载）
let loadedPath: string | null = null
// pdfReloadToken 刚强制刷新过，activePdfTabId watch 跳过一次
let skipNextTabLoad = false

async function loadPdfjs() {
  if (pdfjs) return pdfjs
  try {
    const pdfjsLib = await import('pdfjs-dist')
    const workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc
    pdfjs = pdfjsLib
    return pdfjs
  } catch (err) {
    console.error('加载 PDF.js 失败:', err)
    error.value = 'PDF.js 加载失败'
    return null
  }
}

async function loadPdf(path: string) {
  if (!path) return
  const lib = await loadPdfjs()
  if (!lib) return

  loading.value = true
  error.value = ''
  hasPdf.value = false

  try {
    if (pdfDoc) {
      try { await pdfDoc.destroy() } catch { /* ignore */ }
      pdfDoc = null
    }

    let data: ArrayBuffer | null = null
    if (window.electronAPI?.readPdf) {
      const b64 = await window.electronAPI.readPdf(path)
      if (b64) {
        const binary = atob(b64)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        data = bytes.buffer
      }
    }
    if (!data) {
      const winPath = path.replace(/\\/g, '/')
      const url = winPath.startsWith('/') ? `file://${winPath}` : `file:///${winPath}`
      const resp = await fetch(url)
      if (!resp.ok) throw new Error(`fetch failed: ${resp.status}`)
      data = await resp.arrayBuffer()
    }

    const doc = await lib.getDocument({ data }).promise
    pdfDoc = doc
    totalPages.value = doc.numPages
    currentPage.value = 1
    hasPdf.value = true
    rotation.value = 0
    pageInput.value = '1'
    loadedPath = path

    await nextTick()
    await new Promise((r) => setTimeout(r, 80))
    await renderAllPages()
    setupScrollTracking()
    await loadOutline()
  } catch (err: any) {
    console.error('[PdfViewer] loadPdf error:', err)
    error.value = `无法加载 PDF：${err?.message || err}`
  } finally {
    loading.value = false
  }
}

async function renderAllPages() {
  if (!pdfDoc) return
  for (let i = 0; i < 40 && !pagesRef.value; i++) {
    await new Promise((r) => setTimeout(r, 50))
  }
  const container = pagesRef.value
  if (!container) return

  container.innerHTML = ''
  pageCanvases = []

  for (let i = 1; i <= totalPages.value; i++) {
    const wrapper = document.createElement('div')
    wrapper.className = 'pdf-page-wrapper'
    wrapper.dataset.page = String(i)
    const canvas = document.createElement('canvas')
    canvas.className = 'pdf-page-canvas'
    wrapper.appendChild(canvas)
    container.appendChild(wrapper)
    pageCanvases.push(canvas)
  }

  for (let i = 1; i <= totalPages.value; i++) {
    await renderPageToCanvas(i)
  }

  if (fitMode.value === 'width') {
    await fitWidth()
  }
}

async function renderPageToCanvas(pageNum: number) {
  if (!pdfDoc) return
  const canvas = pageCanvases[pageNum - 1]
  if (!canvas) return
  try {
    const page = await pdfDoc.getPage(pageNum)
    const viewport = page.getViewport({ scale: scale.value, rotation: rotation.value })
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.floor(viewport.width * dpr)
    canvas.height = Math.floor(viewport.height * dpr)
    canvas.style.width = viewport.width + 'px'
    canvas.style.height = viewport.height + 'px'
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.scale(dpr, dpr)
    await page.render({ canvasContext: ctx, viewport }).promise
  } catch (err) {
    console.warn(`渲染第 ${pageNum} 页失败:`, err)
  }
}

async function fitWidth() {
  if (!pdfDoc || !containerRef.value) return
  fitMode.value = 'width'
  try {
    const page = await pdfDoc.getPage(1)
    const unscaled = page.getViewport({ scale: 1, rotation: rotation.value })
    const avail = containerRef.value.clientWidth - 24
    if (avail > 0) scale.value = avail / unscaled.width
  } catch { /* ignore */ }
  for (let i = 1; i <= totalPages.value; i++) await renderPageToCanvas(i)
}

async function fitPage() {
  if (!pdfDoc || !containerRef.value) return
  fitMode.value = 'page'
  try {
    const page = await pdfDoc.getPage(1)
    const unscaled = page.getViewport({ scale: 1, rotation: rotation.value })
    const availW = containerRef.value.clientWidth - 24
    const availH = containerRef.value.clientHeight - 24
    if (availW > 0 && availH > 0) {
      scale.value = Math.min(availW / unscaled.width, availH / unscaled.height)
    }
  } catch { /* ignore */ }
  for (let i = 1; i <= totalPages.value; i++) await renderPageToCanvas(i)
}

function zoomIn() { fitMode.value = 'custom'; scale.value = Math.min(4, scale.value + 0.15); rerenderAll() }
function zoomOut() { fitMode.value = 'custom'; scale.value = Math.max(0.3, scale.value - 0.15); rerenderAll() }
async function rerenderAll() { for (let i = 1; i <= totalPages.value; i++) await renderPageToCanvas(i) }

function rotateLeft() {
  rotation.value = (rotation.value - 90 + 360) % 360
  rerenderAll()
}
function rotateRight() {
  rotation.value = (rotation.value + 90) % 360
  rerenderAll()
}

// 页码跳转
function goToPageInput() {
  const n = parseInt(pageInput.value, 10)
  if (n >= 1 && n <= totalPages.value) {
    scrollToPage(n)
  } else {
    pageInput.value = String(currentPage.value)
  }
}

// ===== PDF 大纲（目录）=====
async function loadOutline() {
  outline.value = []
  if (!pdfDoc) return
  try {
    const raw = await pdfDoc.getOutline()
    if (!raw || raw.length === 0) return

    const resolveDest = async (dest: any): Promise<number | null> => {
      try {
        let d = dest
        if (typeof d === 'string') d = await pdfDoc.getDestination(d)
        if (!Array.isArray(d) || !d[0]) return null
        const idx = await pdfDoc.getPageIndex(d[0])
        return idx + 1
      } catch {
        return null
      }
    }

    const build = async (items: any[], depth = 0): Promise<PdfOutlineItem[]> => {
      if (depth > 6) return []
      const result: PdfOutlineItem[] = []
      for (const item of items) {
        const page = await resolveDest(item.dest)
        const children = item.items ? await build(item.items, depth + 1) : []
        result.push({ title: item.title?.trim() || '(无标题)', page, children })
      }
      return result
    }

    outline.value = await build(raw)
  } catch (err) {
    console.warn('加载 PDF 大纲失败:', err)
  }
}

function outlineClick(item: PdfOutlineItem) {
  if (item.page) scrollToPage(item.page)
}

function setupScrollTracking() {
  if (scrollObserver) scrollObserver.disconnect()
  if (!pagesRef.value) return
  scrollObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          currentPage.value = parseInt((entry.target as HTMLElement).dataset.page || '1', 10)
          pageInput.value = String(currentPage.value)
        }
      }
    },
    { root: containerRef.value, threshold: 0.35 }
  )
  pagesRef.value.querySelectorAll('.pdf-page-wrapper').forEach((w) => scrollObserver!.observe(w))
}

function scrollToPage(pageNum: number) {
  if (!pagesRef.value || !containerRef.value) return
  const wrapper = pagesRef.value.querySelector(`[data-page="${pageNum}"]`) as HTMLElement
  if (wrapper) {
    containerRef.value.scrollTo({ top: wrapper.offsetTop - 12, behavior: 'smooth' })
    currentPage.value = pageNum
    pageInput.value = String(pageNum)
  }
}

function prevPage() { if (currentPage.value > 1) scrollToPage(currentPage.value - 1) }
function nextPage() { if (currentPage.value < totalPages.value) scrollToPage(currentPage.value + 1) }

function openExternal() {
  const tab = compileStore.activePdfTab
  if (tab) window.electronAPI.openPdfExternal(tab.path)
}

async function exportPdf() {
  const tab = compileStore.activePdfTab
  if (tab) await window.electronAPI.exportPdf(tab.path)
}

// SyncTeX
function onSyncTexGotoPdf(e: Event) {
  const detail = (e as CustomEvent).detail
  if (detail?.page) {
    currentPage.value = detail.page
    scrollToPage(detail.page)
  }
}

function onContainerClick(e: MouseEvent) {
  // Ctrl+Click / Ctrl+Meta+Click 反向同步
  if (!e.ctrlKey && !e.metaKey) return
  triggerInverseSearch(e)
}

function onContainerDblClick(e: MouseEvent) {
  // 双击反向同步（无需按 Ctrl）
  triggerInverseSearch(e)
}

async function triggerInverseSearch(e: MouseEvent) {
  if (!pdfDoc) return
  const target = e.target as HTMLElement
  const wrapper = target.closest('.pdf-page-wrapper') as HTMLElement
  if (!wrapper) return
  const pageNum = parseInt(wrapper.dataset.page || '1', 10)
  const canvas = pageCanvases[pageNum - 1]
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  const clickX = e.clientX - rect.left
  const clickY = e.clientY - rect.top
  // 将屏幕坐标换算为 PDF 原始 pt，并处理旋转
  let x = clickX / scale.value
  let y = clickY / scale.value
  const rot = ((rotation.value % 360) + 360) % 360
  let pdfW = 0
  let pdfH = 0
  try {
    const page = await pdfDoc.getPage(pageNum)
    const base = page.getViewport({ scale: 1, rotation: 0 })
    pdfW = base.width
    pdfH = base.height
  } catch { /* ignore */ }
  if (rot === 90) {
    const ny = pdfW - x
    x = y
    y = ny
  } else if (rot === 180) {
    x = pdfW - x
    y = pdfH - y
  } else if (rot === 270) {
    const nx = pdfH - y
    y = x
    x = nx
  }
  window.dispatchEvent(new CustomEvent('synctex-backward', {
    detail: {
      page: pageNum,
      x: Math.max(0, x),
      y: Math.max(0, y)
    }
  }))
}

function onWheel(e: WheelEvent) {
  if (!e.ctrlKey && !e.metaKey) return
  e.preventDefault()
  e.stopPropagation()
  if (e.deltaY < 0) zoomIn(); else zoomOut()
}

// PDF 标签拖拽
const dragPdfId = ref<string | null>(null)
const dropPdfTargetId = ref<string | null>(null)

function onPdfDragStart(e: DragEvent, id: string) {
  dragPdfId.value = id
  e.dataTransfer?.setData('text/plain', id)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}
function onPdfDragOver(e: DragEvent, id: string) {
  e.preventDefault()
  if (dragPdfId.value && dragPdfId.value !== id) {
    dropPdfTargetId.value = id
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  }
}
function onPdfDrop(e: DragEvent, targetId: string) {
  e.preventDefault()
  if (dragPdfId.value && dragPdfId.value !== targetId) {
    compileStore.movePdfTab(dragPdfId.value, targetId)
  }
  dragPdfId.value = null
  dropPdfTargetId.value = null
}
function onPdfDragEnd() {
  dragPdfId.value = null
  dropPdfTargetId.value = null
}

// ===== 标签页联动 =====
// 编译成功后：打开/激活 PDF 标签并强制刷新内容
watch(
  () => compileStore.pdfReloadToken,
  async (token) => {
    if (!token) return
    const path = compileStore.lastResult?.pdfPath
    if (!path || !compileStore.lastResult?.success) return

    const keepPage = currentPage.value
    const existing = compileStore.pdfTabs.find((t) => t.path === path)
    if (existing) {
      // 仅当 id 变化时 activePdfTabId watch 才会触发，此时跳过其加载
      if (compileStore.activePdfTabId !== existing.id) {
        skipNextTabLoad = true
        compileStore.activePdfTabId = existing.id
      }
    } else {
      skipNextTabLoad = true
      compileStore.openPdfTab(path)
    }

    await nextTick()
    await loadPdf(path)
    if (keepPage > 1 && keepPage <= totalPages.value) {
      await nextTick()
      await new Promise((r) => setTimeout(r, 100))
      scrollToPage(keepPage)
    }
  }
)

// 切换标签时加载对应 PDF
watch(
  () => compileStore.activePdfTabId,
  async () => {
    if (skipNextTabLoad) {
      skipNextTabLoad = false
      return
    }
    const tab = compileStore.activePdfTab
    if (tab) {
      // 同路径已加载则跳过
      if (loadedPath === tab.path && hasPdf.value) return
      await nextTick()
      await loadPdf(tab.path)
    } else {
      hasPdf.value = false
      loadedPath = null
      if (pdfDoc) { try { pdfDoc.destroy() } catch {} ; pdfDoc = null }
      if (pagesRef.value) pagesRef.value.innerHTML = ''
    }
  }
)

onMounted(() => {
  window.addEventListener('synctex-goto-pdf', onSyncTexGotoPdf)
  document.addEventListener('click', closeCompileMenu)
})

onUnmounted(() => {
  window.removeEventListener('synctex-goto-pdf', onSyncTexGotoPdf)
  document.removeEventListener('click', closeCompileMenu)
  if (scrollObserver) scrollObserver.disconnect()
})
</script>

<template>
  <div class="pdf-viewer">
    <!-- PDF 标签栏（始终显示以与编辑器标签对齐） -->
    <div class="pdf-tabs-bar">
      <template v-if="compileStore.pdfTabs.length > 0">
        <div
          v-for="tab in compileStore.pdfTabs"
          :key="tab.id"
          class="pdf-tab"
          :class="{
            active: compileStore.activePdfTabId === tab.id,
            dragging: dragPdfId === tab.id,
            'drop-target': dropPdfTargetId === tab.id
          }"
          draggable="true"
          @click="compileStore.activatePdfTab(tab.id)"
          @dragstart="onPdfDragStart($event, tab.id)"
          @dragover="onPdfDragOver($event, tab.id)"
          @drop="onPdfDrop($event, tab.id)"
          @dragend="onPdfDragEnd"
          :title="tab.path"
        >
          <span class="pdf-tab-name">{{ tab.name }}</span>
          <button class="pdf-tab-close" @click.stop="compileStore.closePdfTab(tab.id)">✕</button>
        </div>
      </template>
      <span v-else class="pdf-tabs-placeholder">PDF 预览</span>
    </div>

    <!-- 工具栏：编译按钮在最左 -->
    <div class="pdf-toolbar">
      <!-- 编译：主按钮直接编译，箭头改模式 -->
      <div class="compile-dropdown">
        <button
          class="compile-main-btn"
          :disabled="compileStore.isCompiling"
          @click.stop="compileWithCurrent"
        >
          <span v-if="compileStore.isCompiling" class="compile-spin">⟳</span>
          <span v-else class="compile-icon">▶</span>
          {{ compileStore.isCompiling ? (compileStore.compileProgress || '…') : MODE_LABELS[compileMode] }}
        </button>
        <button
          class="compile-arrow-btn"
          :disabled="compileStore.isCompiling"
          title="选择编译模式"
          @click.stop="toggleCompileMenu"
        >▾</button>
        <div v-if="showCompileMenu" class="compile-menu">
          <button class="menu-item" @click="runCompile('quick')">
            <span class="menu-check">{{ compileMode === 'quick' ? '✓' : '' }}</span>
            <span class="menu-label">快速编译</span>
          </button>
          <div class="menu-divider"></div>
          <button class="menu-item" @click="runCompile('full')">
            <span class="menu-check">{{ compileMode === 'full' ? '✓' : '' }}</span>
            <span class="menu-label">完整编译（bibtex）</span>
          </button>
          <div class="menu-divider"></div>
          <button class="menu-item" @click="runCompile('clean')">
            <span class="menu-check">{{ compileMode === 'clean' ? '✓' : '' }}</span>
            <span class="menu-label">从头编译（清理）</span>
          </button>
        </div>
      </div>

      <span class="toolbar-sep"></span>

      <!-- 大纲 -->
      <button
        class="pdf-tool-btn"
        :class="{ active: showOutline }"
        title="PDF 目录 / 大纲"
        :disabled="!hasPdf || outline.length === 0"
        @click="showOutline = !showOutline"
      >目录</button>

      <span class="toolbar-sep"></span>

      <div class="pdf-toolbar-group">
        <button title="上一页" @click="prevPage" :disabled="currentPage <= 1 || !hasPdf">↑</button>
        <input
          class="page-input"
          type="text"
          inputmode="numeric"
          v-model="pageInput"
          :disabled="!hasPdf"
          title="输入页码后回车跳转"
          @keyup.enter="goToPageInput"
          @blur="goToPageInput"
        />
        <span class="page-total">/ {{ hasPdf ? totalPages : '—' }}</span>
        <button title="下一页" @click="nextPage" :disabled="currentPage >= totalPages || !hasPdf">↓</button>
      </div>
      <div class="pdf-toolbar-group">
        <button title="缩小 (Ctrl+滚轮)" @click="zoomOut" :disabled="!hasPdf">−</button>
        <span class="zoom-info">{{ Math.round(scale * 100) }}%</span>
        <button title="放大 (Ctrl+滚轮)" @click="zoomIn" :disabled="!hasPdf">+</button>
        <button title="适应宽度" :class="{ active: fitMode === 'width' }" @click="fitWidth" :disabled="!hasPdf">宽</button>
        <button title="适应页面" :class="{ active: fitMode === 'page' }" @click="fitPage" :disabled="!hasPdf">页</button>
      </div>
      <div class="pdf-toolbar-group">
        <button title="逆时针旋转 90°" @click="rotateLeft" :disabled="!hasPdf">↺</button>
        <button title="顺时针旋转 90°" @click="rotateRight" :disabled="!hasPdf">↻</button>
      </div>
      <div class="pdf-toolbar-group">
        <button title="外部打开" @click="openExternal" :disabled="!hasPdf">外部</button>
        <button title="导出 PDF" @click="exportPdf" :disabled="!hasPdf">导出</button>
      </div>
    </div>

    <!-- 主体：大纲侧栏 + PDF 内容 -->
    <div class="pdf-main">
      <!-- 大纲侧栏 -->
      <aside v-if="showOutline && outline.length > 0" class="pdf-outline-panel">
        <div class="outline-header">目录</div>
        <div class="outline-tree">
          <template v-for="(item, idx) in outline" :key="idx">
            <button
              class="outline-row"
              :class="`depth-${Math.min(item.children.length ? 0 : 1, 2)}`"
              :title="item.page ? `第 ${item.page} 页` : '无页码'"
              @click="outlineClick(item)"
            >
              <span class="outline-label truncate">{{ item.title }}</span>
              <span v-if="item.page" class="outline-page">{{ item.page }}</span>
            </button>
            <template v-if="item.children.length">
              <button
                v-for="(c, ci) in item.children"
                :key="`${idx}-${ci}`"
                class="outline-row depth-1"
                :title="c.page ? `第 ${c.page} 页` : '无页码'"
                @click="outlineClick(c)"
              >
                <span class="outline-label truncate">{{ c.title }}</span>
                <span v-if="c.page" class="outline-page">{{ c.page }}</span>
              </button>
              <template v-if="item.children.some((gc) => gc.children.length)">
                <button
                  v-for="(gc, gci) in item.children.flatMap((c) => c.children)"
                  :key="`${idx}-g${gci}`"
                  class="outline-row depth-2"
                  :title="gc.page ? `第 ${gc.page} 页` : '无页码'"
                  @click="outlineClick(gc)"
                >
                  <span class="outline-label truncate">{{ gc.title }}</span>
                  <span v-if="gc.page" class="outline-page">{{ gc.page }}</span>
                </button>
              </template>
            </template>
          </template>
        </div>
      </aside>

      <!-- PDF 内容区 -->
      <div ref="containerRef" class="pdf-scroll-container" @click="onContainerClick" @dblclick="onContainerDblClick" @wheel="onWheel">
        <div v-if="loading" class="pdf-status">正在加载 PDF…</div>
        <div v-else-if="error" class="pdf-status error">{{ error }}</div>
        <div v-else-if="!hasPdf" class="pdf-status empty">
          <p>尚未编译生成 PDF</p>
          <p class="hint">点击上方「编译」按钮生成预览</p>
        </div>
        <div ref="pagesRef" class="pdf-pages"></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pdf-viewer {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-tertiary);
}

/* PDF 标签栏 */
.pdf-tabs-bar {
  display: flex;
  height: var(--tab-height);
  background: transparent;
  flex-shrink: 0;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
  position: relative;
}
.pdf-tabs-bar::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 10px;
  right: 10px;
  height: 1px;
  background: var(--border);
}
.pdf-tabs-bar::-webkit-scrollbar { height: 3px; }
.pdf-tab {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 0 10px;
  height: 100%;
  border-right: 1px solid var(--border);
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  font-size: 12px;
  color: var(--text-secondary);
  max-width: 180px;
  min-width: 60px;
  flex-shrink: 0;
  transition: background 0.1s, color 0.1s, opacity 0.15s;
}
.pdf-tab:hover { background: var(--bg-hover); color: var(--text-primary); }
.pdf-tab.active {
  background: var(--bg-primary);
  color: var(--text-primary);
  border-bottom: 2px solid var(--accent);
  font-weight: 500;
}
.pdf-tab.dragging { opacity: 0.4; }
.pdf-tab.drop-target { border-left: 2px solid var(--accent); }
.pdf-tab-name {
  max-width: 130px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pdf-tab-close {
  font-size: 10px;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  color: var(--text-tertiary);
  border-radius: 3px;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.1s;
}
.pdf-tab:hover .pdf-tab-close { opacity: 1; }
.pdf-tab-close:hover { background: var(--bg-active); color: var(--error); }
.pdf-tabs-placeholder {
  display: flex;
  align-items: center;
  padding: 0 12px;
  font-size: 12px;
  color: var(--text-tertiary);
  height: 100%;
}

/* 工具栏 — 分割线内缩 */
.pdf-toolbar {
  display: flex;
  align-items: center;
  padding: 4px 12px;
  background: transparent;
  flex-shrink: 0;
  gap: 8px;
  flex-wrap: wrap;
  position: relative;
}
.pdf-toolbar::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 10px;
  right: 10px;
  height: 1px;
  background: var(--border);
}
.toolbar-sep {
  width: 1px;
  height: 16px;
  background: var(--border);
  margin: 0 2px;
}

/* 编译：毛玻璃主按钮 + 箭头分体 */
.compile-dropdown { position: relative; flex-shrink: 0; display: flex; }
.compile-main-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  background: rgba(37, 99, 235, 0.45);
  backdrop-filter: blur(14px) saturate(1.6);
  -webkit-backdrop-filter: blur(14px) saturate(1.6);
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-right: none;
  border-radius: var(--radius-sm) 0 0 var(--radius-sm);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.compile-main-btn:hover:not(:disabled) {
  background: rgba(37, 99, 235, 0.65);
  border-color: rgba(255, 255, 255, 0.28);
}
.compile-main-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.compile-arrow-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px 6px;
  background: rgba(37, 99, 235, 0.45);
  backdrop-filter: blur(14px) saturate(1.6);
  -webkit-backdrop-filter: blur(14px) saturate(1.6);
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-left: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  font-size: 10px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.compile-arrow-btn:hover:not(:disabled) {
  background: rgba(37, 99, 235, 0.65);
  border-color: rgba(255, 255, 255, 0.28);
}
.compile-arrow-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.compile-icon { font-size: 10px; }
.compile-spin { display: inline-block; animation: spin 1s linear infinite; font-size: 12px; }
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.compile-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 100;
  background: rgba(30, 30, 46, 0.3);
  backdrop-filter: blur(20px) saturate(1.6);
  -webkit-backdrop-filter: blur(20px) saturate(1.6);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  box-shadow: var(--shadow-lg);
  min-width: 180px;
  overflow: hidden;
  animation: menuPop 0.14s ease;
}
[data-theme="light"] .compile-menu {
  background: rgba(255, 255, 255, 0.3);
  border-color: rgba(0, 0, 0, 0.06);
}
@keyframes menuPop {
  from { opacity: 0; transform: translateY(-4px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.menu-item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 8px 14px;
  text-align: left;
  border: none;
  background: transparent;
  cursor: pointer;
  transition: background 0.1s;
}
.menu-item:hover { background: var(--bg-hover); }
.menu-check {
  width: 14px;
  flex-shrink: 0;
  color: var(--accent);
  font-weight: 700;
  font-size: 12px;
}
.menu-label { font-size: 13px; font-weight: 500; color: var(--text-primary); }
.menu-divider { height: 1px; background: var(--border); margin: 0; }

/* 工具栏按钮 */
.pdf-toolbar-group { display: flex; align-items: center; gap: 4px; }
.pdf-toolbar button {
  font-size: 12px;
  min-width: 26px;
  height: 24px;
  padding: 0 6px;
}
.pdf-toolbar button.active { background: var(--accent-light); color: var(--accent); }
.pdf-tool-btn {
  font-size: 12px;
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
}
.pdf-tool-btn:hover:not(:disabled) { background: var(--bg-hover); }
.pdf-tool-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.pdf-tool-btn.active { background: var(--accent-light); color: var(--accent); border-color: var(--accent); }
.page-input {
  width: 40px;
  height: 22px;
  text-align: center;
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-primary);
  color: var(--text-primary);
  outline: none;
}
.page-input:focus { border-color: var(--accent); }
.page-input:disabled { opacity: 0.5; }
.page-total { font-size: 12px; color: var(--text-secondary); min-width: 32px; }
.zoom-info { font-size: 12px; color: var(--text-secondary); min-width: 36px; text-align: center; }

/* 主体：大纲 + 内容 */
.pdf-main {
  display: flex;
  flex: 1;
  min-height: 0;
}
.pdf-outline-panel {
  width: 200px;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  background: var(--bg-secondary);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.outline-header {
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.outline-tree {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}
.outline-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 5px 12px;
  font-size: 12px;
  color: var(--text-primary);
  background: transparent;
  border: none;
  text-align: left;
  cursor: pointer;
}
.outline-row:hover { background: var(--bg-hover); }
.outline-row.depth-1 { padding-left: 24px; }
.outline-row.depth-2 { padding-left: 36px; color: var(--text-secondary); }
.outline-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.outline-page {
  font-size: 11px;
  color: var(--text-tertiary);
  flex-shrink: 0;
}

/* 内容区 */
.pdf-scroll-container {
  flex: 1;
  overflow-y: auto;
  overflow-x: auto;
  padding: 12px 12px 8px;
  scroll-behavior: smooth;
  min-width: 0;
  cursor: default;
  scrollbar-color: var(--scrollbar-thumb) transparent;
  scrollbar-width: thin;
}
.pdf-scroll-container::-webkit-scrollbar {
  height: 10px;
  width: 10px;
}
.pdf-scroll-container::-webkit-scrollbar-track {
  background: transparent;
}
.pdf-scroll-container::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb);
  border-radius: 5px;
  border: 2px solid transparent;
  background-clip: padding-box;
}
.pdf-scroll-container::-webkit-scrollbar-thumb:hover {
  background: var(--scrollbar-thumb-hover);
  background-clip: padding-box;
}
.pdf-scroll-container::-webkit-scrollbar-corner {
  background: transparent;
}
.pdf-pages {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  min-height: 100px;
  width: max-content;
  min-width: 100%;
  margin: 0 auto;
}
.pdf-page-wrapper { position: relative; flex-shrink: 0; line-height: 0; cursor: default; }
.pdf-page-canvas {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  background: #fff;
  display: block;
  /* 放大后允许横向溢出出现滚动条 */
  max-width: none;
  pointer-events: auto;
  user-select: none;
  -webkit-user-select: none;
}
.pdf-status { margin-top: 40px; color: var(--text-secondary); text-align: center; font-size: 13px; }
.pdf-status.error { color: var(--error); }
.pdf-status.empty .hint { font-size: 12px; color: var(--text-tertiary); margin-top: 8px; }
</style>
