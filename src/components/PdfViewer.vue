<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick, inject, computed } from 'vue'
import { useCompileStore } from '../stores/compile'
import type { CompileMode } from '../stores/compile'

const compileStore = useCompileStore()
const compileDoc = inject<(mode?: CompileMode) => Promise<void>>('compileDoc', async () => {})

// 编译下拉
const showCompileMenu = ref(false)
function runCompile(mode: CompileMode) {
  showCompileMenu.value = false
  compileDoc(mode)
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
const fitMode = ref<'width' | 'custom'>('width')
const loading = ref(false)
const error = ref('')
const hasPdf = ref(false)

let pdfDoc: any = null
let pageCanvases: HTMLCanvasElement[] = []
let scrollObserver: IntersectionObserver | null = null
let pdfjs: any = null

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

    await nextTick()
    await new Promise((r) => setTimeout(r, 80))
    await renderAllPages()
    setupScrollTracking()
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
    const viewport = page.getViewport({ scale: scale.value })
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
    const unscaled = page.getViewport({ scale: 1 })
    const avail = containerRef.value.clientWidth - 24
    if (avail > 0) scale.value = avail / unscaled.width
  } catch { /* ignore */ }
  for (let i = 1; i <= totalPages.value; i++) await renderPageToCanvas(i)
}

function zoomIn() { fitMode.value = 'custom'; scale.value = Math.min(4, scale.value + 0.15); rerenderAll() }
function zoomOut() { fitMode.value = 'custom'; scale.value = Math.max(0.3, scale.value - 0.15); rerenderAll() }
async function rerenderAll() { for (let i = 1; i <= totalPages.value; i++) await renderPageToCanvas(i) }

function setupScrollTracking() {
  if (scrollObserver) scrollObserver.disconnect()
  if (!pagesRef.value) return
  scrollObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          currentPage.value = parseInt((entry.target as HTMLElement).dataset.page || '1', 10)
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
  if (wrapper) containerRef.value.scrollTo({ top: wrapper.offsetTop - 12, behavior: 'smooth' })
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
  if (!e.ctrlKey && !e.metaKey) return
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
  pdfDoc.getPage(pageNum).then((page: any) => {
    const viewport = page.getViewport({ scale: scale.value })
    window.dispatchEvent(new CustomEvent('synctex-backward', {
      detail: { page: pageNum, x: clickX / scale.value, y: (viewport.height - clickY) / scale.value }
    }))
  })
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
// 编译成功后自动打开 PDF 标签
watch(
  () => compileStore.lastResult,
  (result) => {
    if (result?.pdfPath && result.success) {
      compileStore.openPdfTab(result.pdfPath)
    }
  },
  { deep: true }
)

// 切换标签时加载对应 PDF
watch(
  () => compileStore.activePdfTabId,
  async () => {
    const tab = compileStore.activePdfTab
    if (tab) {
      await nextTick()
      await loadPdf(tab.path)
    } else {
      hasPdf.value = false
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
      <!-- 编译下拉 -->
      <div class="compile-dropdown">
        <button
          class="compile-main-btn"
          :disabled="compileStore.isCompiling"
          @click.stop="toggleCompileMenu"
        >
          <span v-if="compileStore.isCompiling" class="compile-spin">⟳</span>
          <span v-else class="compile-icon">▶</span>
          {{ compileStore.isCompiling ? (compileStore.compileProgress || '…') : '编译' }}
          <span class="dropdown-arrow">▾</span>
        </button>
        <div v-if="showCompileMenu" class="compile-menu">
          <button class="menu-item" @click="runCompile('quick')"><span class="menu-label">快速编译</span></button>
          <div class="menu-divider"></div>
          <button class="menu-item" @click="runCompile('full')"><span class="menu-label">完整编译（bibtex）</span></button>
          <div class="menu-divider"></div>
          <button class="menu-item" @click="runCompile('clean')"><span class="menu-label">从头编译（清理）</span></button>
        </div>
      </div>

      <span class="toolbar-sep"></span>

      <div class="pdf-toolbar-group">
        <button title="上一页" @click="prevPage" :disabled="currentPage <= 1 || !hasPdf">↑</button>
        <span class="page-info">{{ hasPdf ? currentPage + ' / ' + totalPages : '— / —' }}</span>
        <button title="下一页" @click="nextPage" :disabled="currentPage >= totalPages || !hasPdf">↓</button>
      </div>
      <div class="pdf-toolbar-group">
        <button title="缩小 (Ctrl+滚轮)" @click="zoomOut" :disabled="!hasPdf">−</button>
        <span class="zoom-info">{{ Math.round(scale * 100) }}%</span>
        <button title="放大 (Ctrl+滚轮)" @click="zoomIn" :disabled="!hasPdf">+</button>
        <button title="适应宽度" :class="{ active: fitMode === 'width' }" @click="fitWidth" :disabled="!hasPdf">宽</button>
      </div>
      <div class="pdf-toolbar-group">
        <button title="外部打开" @click="openExternal" :disabled="!hasPdf">外部</button>
        <button title="导出 PDF" @click="exportPdf" :disabled="!hasPdf">导出</button>
      </div>
    </div>

    <!-- PDF 内容区 -->
    <div ref="containerRef" class="pdf-scroll-container" @click="onContainerClick" @wheel="onWheel">
      <div v-if="loading" class="pdf-status">正在加载 PDF…</div>
      <div v-else-if="error" class="pdf-status error">{{ error }}</div>
      <div v-else-if="!hasPdf" class="pdf-status empty">
        <p>尚未编译生成 PDF</p>
        <p class="hint">点击上方「编译」按钮生成预览</p>
      </div>
      <div ref="pagesRef" class="pdf-pages"></div>
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

/* 编译下拉 */
.compile-dropdown { position: relative; flex-shrink: 0; }
.compile-main-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 12px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s;
}
.compile-main-btn:hover:not(:disabled) { background: var(--accent-hover); }
.compile-main-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.compile-icon { font-size: 10px; }
.compile-spin { display: inline-block; animation: spin 1s linear infinite; font-size: 12px; }
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.dropdown-arrow { font-size: 9px; opacity: 0.8; margin-left: 2px; }
.compile-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 100;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  min-width: 180px;
  overflow: hidden;
}
.menu-item {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 8px 14px;
  text-align: left;
  border: none;
  background: transparent;
  cursor: pointer;
  transition: background 0.1s;
}
.menu-item:hover { background: var(--bg-hover); }
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
.page-info { font-size: 12px; color: var(--text-secondary); min-width: 56px; text-align: center; }
.zoom-info { font-size: 12px; color: var(--text-secondary); min-width: 36px; text-align: center; }

/* 内容区 */
.pdf-scroll-container {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 12px;
  scroll-behavior: smooth;
}
.pdf-pages {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  min-height: 100px;
}
.pdf-page-wrapper { position: relative; flex-shrink: 0; line-height: 0; }
.pdf-page-canvas {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  background: #fff;
  display: block;
  max-width: 100%;
}
.pdf-status { margin-top: 40px; color: var(--text-secondary); text-align: center; font-size: 13px; }
.pdf-status.error { color: var(--error); }
.pdf-status.empty .hint { font-size: 12px; color: var(--text-tertiary); margin-top: 8px; }
</style>
