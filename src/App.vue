<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed, watch, nextTick, provide } from 'vue'
import { useDocStore } from './stores/docs'
import { useCompileStore } from './stores/compile'
import { useConfigStore } from './stores/config'
import Editor from './components/Editor.vue'
import PdfViewer from './components/PdfViewer.vue'
import FileTree from './components/FileTree.vue'
import LogPanel from './components/LogPanel.vue'
import StatusBar from './components/StatusBar.vue'
import Welcome from './components/Welcome.vue'
import Settings from './components/Settings.vue'
import Tabs from './components/Tabs.vue'
import CommandPalette from './components/CommandPalette.vue'
import AiPanel from './components/AiPanel.vue'
import { useAiStore } from './stores/ai'
import { scanProjectBibs, bibScanner } from './utils/bibtex'
import { loadSyncTex, forwardSearch, inverseSearch, type SyncTexData } from './utils/synctex'
import type { CompileMode } from './stores/compile'

const docStore = useDocStore()
const compileStore = useCompileStore()
const configStore = useConfigStore()
const aiStore = useAiStore()

const showSidebar = ref(true)
const showPreview = ref(true)
const showAi = ref(false)
const aiWidth = ref(300)
const sidebarWidth = ref(220)
// 布局模式: 'default' = 工作区在左, 'swap' = 墨灵在左
const layoutMode = ref<'default' | 'swap'>('default')

function cycleLayout() {
  layoutMode.value = layoutMode.value === 'default' ? 'swap' : 'default'
}
const panelOpen = ref(false)
const panelTab = ref<'problems' | 'output' | 'log'>('log')
const distractionFree = ref(false)
const editorWidth = ref(50)
const panelHeight = ref(200)
const showCommandPalette = ref(false)
const showSearch = ref(false)
let syncTexData: SyncTexData | null = null

let resizeCleanup: (() => void) | null = null
let autoCompileTimer: ReturnType<typeof setTimeout> | null = null

onMounted(async () => {
  await configStore.load()
  await aiStore.loadConfig()
  await compileStore.detectTexLive()
  await docStore.loadRecent()

  const offMenu = window.electronAPI.onMenuAction(handleMenuAction)
  const offProgress = window.electronAPI.onCompileProgress((data) => {
    if (data.type !== 'debug') {
      compileStore.appendLiveLog(data.message)
    }
  })
  const offFileChanged = window.electronAPI.onFileChanged(async (data) => {
    // AI 修改文件后，刷新编辑器中对应的标签页
    const tab = docStore.tabs.find((t) => t.path === data.path)
    if (tab) {
      try {
        const { content } = await window.electronAPI.readFile(data.path)
        // 更新标签内容但不标记为未保存
        tab.content = content
        tab.originalContent = content
        tab.isDirty = false
        // 通知编辑器刷新
        window.dispatchEvent(new CustomEvent('reload-tab', { detail: { tabId: tab.id, content } }))
      } catch { /* ignore */ }
    }
  })

  resizeCleanup = () => {
    offMenu()
    offProgress()
    offFileChanged()
  }

  document.addEventListener('dragover', onDragOver)
  document.addEventListener('drop', onDrop)
  window.addEventListener('keydown', onGlobalKeydown)

  // SyncTeX 正向/反向同步事件
  window.addEventListener('synctex-forward', onSyncTexForward as EventListener)
  window.addEventListener('synctex-backward', onSyncTexBackward as EventListener)

  // 发送到墨灵
  window.addEventListener('send-to-moling', onSendToMoling as EventListener)
})

onUnmounted(() => {
  resizeCleanup?.()
  document.removeEventListener('dragover', onDragOver)
  document.removeEventListener('drop', onDrop)
  window.removeEventListener('keydown', onGlobalKeydown)
  window.removeEventListener('synctex-forward', onSyncTexForward as EventListener)
  window.removeEventListener('synctex-backward', onSyncTexBackward as EventListener)
  window.removeEventListener('send-to-moling', onSendToMoling as EventListener)
  if (autoCompileTimer) clearTimeout(autoCompileTimer)
})

function onGlobalKeydown(e: KeyboardEvent) {
  if (e.ctrlKey && e.shiftKey && e.key === 'P') {
    e.preventDefault()
    showCommandPalette.value = !showCommandPalette.value
  } else if (e.key === 'Escape') {
    if (showCommandPalette.value) {
      showCommandPalette.value = false
    }
  }
}

function onDragOver(e: DragEvent) {
  e.preventDefault()
}

async function onDrop(e: DragEvent) {
  e.preventDefault()
  const files = e.dataTransfer?.files
  if (!files || files.length === 0) return
  for (const f of Array.from(files)) {
    const path = (f as any).path
    if (path && /\.(tex|bib|sty|cls|md|txt)$/i.test(path)) {
      await docStore.openFile(path)
    }
  }
}

async function handleMenuAction(action: string) {
  switch (action) {
    case 'new-file': newFile(); break
    case 'open-file': openFile(); break
    case 'open-folder': openFolder(); break
    case 'save': await save(); break
    case 'save-as': await saveAs(); break
    case 'compile': await compileDoc(); break
    case 'clean': await cleanAux(); break
    case 'open-pdf': openPdfExternal(); break
    case 'toggle-sidebar': toggleSidebar(); break
    case 'toggle-preview': showPreview.value = !showPreview.value; break
    case 'toggle-log': panelOpen.value = !panelOpen.value; break
    case 'distraction-free': distractionFree.value = !distractionFree.value; break
    case 'settings': configStore.showSettings = true; break
    case 'command-palette': showCommandPalette.value = true; break
  }
}

function newFile() {
  const tpl = `\\documentclass[UTF8,a4paper,12pt]{ctexart}
\\usepackage{ctex}
\\setCJKmainfont{SimSun}
\\setCJKsansfont{Microsoft YaHei}
\\setCJKmonofont{FangSong}
\\parindent = 2em

\\title{未命名文档}
\\author{作者}
\\date{\\today}

\\begin{document}
\\maketitle

\\section{引言}

在这里输入内容……

\\end{document}
`
  docStore.newTab('未命名.tex', tpl)
}

async function openFile() {
  const path = await window.electronAPI.openFile()
  if (path) await docStore.openFile(path)
}

async function openFolder() {
  const path = await window.electronAPI.openFolder()
  if (path) {
    await docStore.openProjectFolder(path)
    showSidebar.value = true
    // 自动扫描项目中的 .bib 文件
    scanProjectBibs(path).then((count) => {
      if (count > 0) {
        compileStore.appendLiveLog(`[BibTeX] 已扫描到 ${count} 个引用键\n`)
      }
    })
  }
}

async function save(): Promise<boolean> {
  const tab = docStore.activeTab
  if (!tab) return false
  if (!tab.path) return saveAs()
  const ok = await docStore.saveTab()
  if (ok && configStore.config?.autoCompile) {
    scheduleAutoCompile()
  }
  return ok
}

function scheduleAutoCompile() {
  if (autoCompileTimer) clearTimeout(autoCompileTimer)
  autoCompileTimer = setTimeout(() => {
    compileDoc()
  }, 800)
}

async function saveAs(): Promise<boolean> {
  const tab = docStore.activeTab
  if (!tab) return false
  const defaultName = tab.name || '未命名.tex'
  const newPath = await window.electronAPI.saveAs(defaultName)
  if (!newPath) return false
  return docStore.saveTabAs(tab.id, newPath)
}

async function compileDoc(mode: CompileMode = 'quick') {
  if (docStore.activeTab?.isDirty) {
    const ok = await save()
    if (!ok) return
  }
  // 优先编译当前激活的 .tex 文件
  const activeTab = docStore.activeTab
  let mainPath: string | null = null
  if (activeTab?.path && /\.tex$/i.test(activeTab.path)) {
    mainPath = activeTab.path
    docStore.setMainTex(activeTab.path)
  } else {
    mainPath = docStore.mainTexPath
  }
  if (!mainPath) {
    alert('请先打开并保存一个 .tex 文件后再编译')
    return
  }
  if (!compileStore.texLiveFound) {
    const setup = confirm(
      '未检测到 TeX Live。\n\n是否打开设置手动指定 TeX Live 安装路径？\n（例如 C:\\texlive\\2024\\bin\\windows）'
    )
    if (setup) configStore.showSettings = true
    return
  }
  const cfg = configStore.config
  const extraArgs = (cfg?.extraArgs || '').split(/\s+/).filter(Boolean)
  if (!extraArgs.some((a: string) => a.includes('synctex'))) {
    extraArgs.push('-synctex=1')
  }
  await compileStore.compile(mainPath, cfg?.engine || 'xelatex', extraArgs, cfg?.timeout || 120, mode)

  if (compileStore.lastResult?.success && mainPath) {
    loadSyncTexForDoc(mainPath)
  }
}

async function loadSyncTexForDoc(texPath: string) {
  const synctexPath = texPath.replace(/\.tex$/i, '.synctex.gz')
  const plainPath = texPath.replace(/\.tex$/i, '.synctex')
  syncTexData = (await loadSyncTex(synctexPath)) || (await loadSyncTex(plainPath))
  if (syncTexData) {
    compileStore.appendLiveLog('[SyncTeX] 已加载同步数据\n')
  }
}

// 正向同步：编辑器 Ctrl+Click → 跳转 PDF
async function onSyncTexForward(e: CustomEvent) {
  const { line } = e.detail
  if (!syncTexData) {
    // 尝试加载
    const mainPath = docStore.mainTexPath || docStore.activeTab?.path
    if (mainPath) await loadSyncTexForDoc(mainPath)
    if (!syncTexData) return
  }
  const point = forwardSearch(syncTexData, line, docStore.activeTab?.path || undefined)
  if (point) {
    window.dispatchEvent(
      new CustomEvent('synctex-goto-pdf', {
        detail: { page: point.page, x: point.x, y: point.y }
      })
    )
  }
}

// 反向同步：PDF Ctrl+Click → 跳转编辑器
async function onSyncTexBackward(e: CustomEvent) {
  const { page, x, y } = e.detail
  if (!syncTexData) return
  const result = inverseSearch(syncTexData, page, x, y)
  if (result) {
    // 如果跳转目标文件不同，先打开它
    if (result.file && docStore.activeTab?.path && !result.file.includes(docStore.activeTab.name)) {
      // 尝试打开目标文件
      try {
        await docStore.openFile(result.file)
      } catch {
        // ignore
      }
    }
    window.dispatchEvent(
      new CustomEvent('jump-to-line', {
        detail: { line: result.line, file: result.file }
      })
    )
  }
}

function onSendToMoling(e: CustomEvent) {
  const { text, filePath, fileName } = e.detail || {}
  if (!text) return
  showAi.value = true
  window.dispatchEvent(new CustomEvent('moling-prefill', {
    detail: { text, filePath, fileName }
  }))
}

async function cleanAux() {
  const mainPath = docStore.mainTexPath || docStore.activeTab?.path
  if (!mainPath) return
  const deleted = await compileStore.cleanAux(mainPath)
  if (deleted.length > 0) {
    alert(`已清理 ${deleted.length} 个辅助文件：\n${deleted.join('\n')}`)
  } else {
    alert('没有找到需要清理的辅助文件')
  }
}

function openPdfExternal() {
  const pdf = compileStore.lastResult?.pdfPath
  if (pdf) {
    window.electronAPI.openPdfExternal(pdf)
  } else {
    alert('请先编译生成 PDF')
  }
}

function jumpToLine(line: number | null, file?: string | null) {
  if (line == null) return
  window.dispatchEvent(new CustomEvent('jump-to-line', { detail: { line, file } }))
}

// 工作区分割线拖拽
function startSidebarResize(e: MouseEvent) {
  e.preventDefault()
  function onMove(ev: MouseEvent) {
    sidebarWidth.value = Math.min(400, Math.max(160, ev.clientX - 12))
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}

function startResize(e: MouseEvent) {
  e.preventDefault()
  const container = (e.currentTarget as HTMLElement).parentElement
  if (!container) return
  const rect = container.getBoundingClientRect()
  function onMove(ev: MouseEvent) {
    const pct = ((ev.clientX - rect.left) / rect.width) * 100
    editorWidth.value = Math.min(80, Math.max(20, pct))
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}

function startPanelResize(e: MouseEvent) {
  e.preventDefault()
  function onMove(ev: MouseEvent) {
    panelHeight.value = Math.min(500, Math.max(80, window.innerHeight - ev.clientY - 28))
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    document.body.style.cursor = ''
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
  document.body.style.cursor = 'row-resize'
}

function startAiResize(e: MouseEvent) {
  e.preventDefault()
  function onMove(ev: MouseEvent) {
    aiWidth.value = Math.min(600, Math.max(200, window.innerWidth - ev.clientX))
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}

// 提供给子组件的编译函数
provide('compileDoc', compileDoc)
provide('saveActiveTab', save)

function toggleSidebar() {
  showSidebar.value = !showSidebar.value
}

const hasProject = computed(() => !!docStore.projectRoot)
const showWelcome = computed(() => docStore.tabs.length === 0)
const errorCount = computed(() => compileStore.lastResult?.errors.length || 0)
const warningCount = computed(() => compileStore.lastResult?.warnings.length || 0)

function onCommandRun(cmd: string) {
  showCommandPalette.value = false
  handleMenuAction(cmd)
}

// 窗口控制
const isMaximized = ref(false)
function windowMinimize() { window.electronAPI.windowMinimize() }
async function windowToggleMaximize() {
  isMaximized.value = await window.electronAPI.windowToggleMaximize()
}
function windowClose() { window.electronAPI.windowClose() }
function onTitlebarDblclick(e: MouseEvent) {
  // 只在双击工具栏空白区域时触发最大化，按钮上双击不触发
  const target = e.target as HTMLElement
  if (target.closest('button') || target.closest('.texlive-badge') || target.closest('.win-controls')) return
  windowToggleMaximize()
}

// 编辑器工具栏动作
function editorAction(action: string) {
  window.dispatchEvent(new CustomEvent('editor-action', { detail: { action } }))
}
</script>

<template>
  <div class="app-root" :class="{ 'distraction-free': distractionFree }">
    <!-- 顶部工具栏（无边框标题栏） -->
    <header v-if="!distractionFree" class="toolbar" @dblclick="onTitlebarDblclick">
      <div class="toolbar-left drag-region">
        <span class="app-title">LaTeX编辑器</span>
        <div class="toolbar-actions">
          <button title="新建 (Ctrl+N)" @click="newFile">新建</button>
          <button title="打开文件 (Ctrl+O)" @click="openFile">打开</button>
          <button title="打开文件夹 (Ctrl+K)" @click="openFolder">文件夹</button>
          <span class="divider"></span>
          <button title="保存 (Ctrl+S)" @click="save">保存</button>
          <button title="外部打开 PDF" @click="openPdfExternal">外部 PDF</button>
          <span class="divider"></span>
          <button title="命令面板 (Ctrl+Shift+P)" @click="showCommandPalette = true">命令</button>
          <button title="设置 (Ctrl+,)" @click="configStore.showSettings = true">设置</button>
        </div>
      </div>
      <div class="toolbar-right">
        <span
          class="texlive-badge"
          :class="compileStore.texLiveFound ? 'ok' : 'missing'"
          :title="compileStore.texLiveFound ? `TeX Live: ${compileStore.texLivePath}` : '未检测到 TeX Live'"
        >
          {{ compileStore.texLiveFound ? 'TeX Live ✓' : 'TeX Live ✗' }}
        </span>
        <span class="right-divider"></span>
        <button
          class="icon-btn"
          :class="{ active: showAi }"
          title="墨灵 AI 助手"
          @click="showAi = !showAi"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="1" y="1" width="14" height="14" rx="3" fill="#2563EB"/>
            <path d="M5.5 4.5v7h1.8V8.8h1.4c1.5 0 2.5-.9 2.5-2.2S10.2 4.5 8.7 4.5H5.5zm1.8 1.5h1.3c.6 0 1 .3 1 .9s-.4.9-1 .9H7.3V6z" fill="#fff"/>
          </svg>
        </button>
        <button
          class="icon-btn"
          :title="`主题：${configStore.themeLabel()}（点击切换）`"
          @click="configStore.toggleTheme()"
        >
          {{ configStore.themeIcon() }}
        </button>
        <button class="icon-btn" title="全屏编辑 (F11)" @click="distractionFree = !distractionFree">⛶</button>
        <span class="right-divider"></span>
        <!-- 布局切换图标（紧邻窗口控制） -->
        <button
          class="icon-btn layout-btn"
          :class="{ active: showSidebar }"
          title="切换文件树 (Ctrl+B)"
          @click="toggleSidebar"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="1" y="2" width="14" height="12" rx="1.5" stroke="currentColor" stroke-width="1.2"/>
            <line x1="6" y1="2" x2="6" y2="14" stroke="currentColor" stroke-width="1.2"/>
          </svg>
        </button>
        <button
          class="icon-btn layout-btn"
          :class="{ active: showPreview }"
          title="切换 PDF 预览 (Ctrl+Alt+P)"
          @click="showPreview = !showPreview"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="1" y="2" width="14" height="12" rx="1.5" stroke="currentColor" stroke-width="1.2"/>
            <line x1="10" y1="2" x2="10" y2="14" stroke="currentColor" stroke-width="1.2"/>
          </svg>
        </button>
        <!-- 布局互换 -->
        <button
          class="icon-btn layout-btn"
          :class="{ active: layoutMode === 'swap' }"
          title="切换布局：工作区与墨灵互换位置"
          @click="cycleLayout"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M4 5h8M4 5l2-2M4 5l2 2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M12 11H4M12 11l-2-2M12 11l-2 2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <!-- 窗口控制按钮 -->
        <span class="win-controls">
          <button class="win-btn" title="最小化" @click="windowMinimize">
            <svg width="12" height="12" viewBox="0 0 12 12"><line x1="1" y1="6" x2="11" y2="6" stroke="currentColor" stroke-width="1.2"/></svg>
          </button>
          <button class="win-btn" title="最大化/还原" @click="windowToggleMaximize">
            <svg v-if="!isMaximized" width="12" height="12" viewBox="0 0 12 12"><rect x="1.5" y="1.5" width="9" height="9" rx="1" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>
            <svg v-else width="12" height="12" viewBox="0 0 12 12"><rect x="1.5" y="3.5" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.2" fill="none"/><polyline points="3.5,1.5 10.5,1.5 10.5,8.5" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>
          </button>
          <button class="win-btn win-close" title="关闭" @click="windowClose">
            <svg width="12" height="12" viewBox="0 0 12 12"><line x1="2" y1="2" x2="10" y2="10" stroke="currentColor" stroke-width="1.2"/><line x1="10" y1="2" x2="2" y2="10" stroke="currentColor" stroke-width="1.2"/></svg>
          </button>
        </span>
      </div>
    </header>

    <!-- 主体 -->
    <div class="main-body">
      <!-- 默认布局：工作区在左 -->
      <template v-if="layoutMode === 'default'">
        <aside v-if="showSidebar && !distractionFree" class="panel sidebar-panel" :style="{ width: sidebarWidth + 'px' }">
          <FileTree />
        </aside>
        <div v-if="showSidebar && !distractionFree" class="panel-divider v" @mousedown="startSidebarResize"></div>
      </template>

      <!-- 互换布局：墨灵在左 -->
      <template v-if="layoutMode === 'swap' && showAi && !distractionFree">
        <aside class="panel ai-panel" :style="{ width: aiWidth + 'px' }">
          <AiPanel />
        </aside>
        <div class="panel-divider v" @mousedown="startAiResize" @dblclick="aiWidth = 300"></div>
      </template>

      <div class="center-area">
        <div class="editor-preview">
          <!-- TEX 编辑器面板 -->
          <div class="panel editor-panel" :style="showPreview && !showWelcome ? { flex: editorWidth } : { flex: 1 }">
            <Tabs v-if="!showWelcome" />
            <!-- 编辑器功能栏 -->
            <div v-if="!showWelcome" class="editor-toolbar">
              <div class="et-group">
                <button class="et-btn" title="撤销 (Ctrl+Z)" @click="editorAction('undo')">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 7h6a3 3 0 0 1 0 6H7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><polyline points="5.5,4.5 3,7 5.5,9.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>
                </button>
                <button class="et-btn" title="重做 (Ctrl+Y)" @click="editorAction('redo')">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M11 7H5a3 3 0 0 0 0 6h2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><polyline points="8.5,4.5 11,7 8.5,9.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>
                </button>
              </div>
              <div class="et-sep"></div>
              <div class="et-group">
                <button class="et-btn" :class="{ active: showSearch }" title="查找 / 替换 (Ctrl+F / Ctrl+H)" @click="showSearch = !showSearch">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="4.5" stroke="currentColor" stroke-width="1.3"/><line x1="9.5" y1="9.5" x2="13" y2="13" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
                </button>
              </div>
            </div>
            <Welcome v-if="showWelcome" @new-file="newFile" @open-file="openFile" @open-folder="openFolder" />
            <Editor v-else :show-search="showSearch" @close-search="showSearch = false" />
          </div>

          <!-- TEX/PDF 分割线 -->
          <div v-if="showPreview && !showWelcome" class="panel-divider v" @mousedown="startResize" @dblclick="editorWidth = 50"></div>

          <!-- PDF 预览面板 -->
          <div v-if="showPreview && !showWelcome" class="panel preview-panel" :style="{ flex: 100 - editorWidth }">
            <PdfViewer />
          </div>
        </div>

        <!-- VS Code 风格底部面板 -->
        <div class="bottom-panel" :class="{ open: panelOpen }">
          <!-- 面板把手（默认可见的细条） -->
          <div class="panel-handle" @click="panelOpen = !panelOpen">
            <div class="handle-tabs">
              <button
                class="handle-tab"
                :class="{ active: panelOpen && panelTab === 'problems' }"
                @click.stop="panelTab = 'problems'; panelOpen = true"
              >
                问题
                <span v-if="errorCount > 0" class="badge error">{{ errorCount }}</span>
                <span v-if="warningCount > 0" class="badge warning">{{ warningCount }}</span>
              </button>
              <button
                class="handle-tab"
                :class="{ active: panelOpen && panelTab === 'log' }"
                @click.stop="panelTab = 'log'; panelOpen = true"
              >
                编译日志
              </button>
              <button
                class="handle-tab"
                :class="{ active: panelOpen && panelTab === 'output' }"
                @click.stop="panelTab = 'output'; panelOpen = true"
              >
                输出
              </button>
            </div>
            <div class="handle-actions">
              <button
                class="handle-btn"
                :title="panelOpen ? '收起面板' : '展开面板'"
                @click.stop="panelOpen = !panelOpen"
              >
                {{ panelOpen ? '▼' : '▲' }}
              </button>
            </div>
          </div>

          <!-- 面板内容 -->
          <div v-if="panelOpen" class="panel-body" :style="{ height: panelHeight + 'px' }">
            <div class="panel-resize" @mousedown="startPanelResize"></div>
            <LogPanel
              v-if="panelTab === 'log' || panelTab === 'problems' || panelTab === 'output'"
              :mode="panelTab"
              @jump="jumpToLine"
            />
          </div>
        </div>
      </div>

      <!-- 默认布局：墨灵在右 -->
      <template v-if="layoutMode === 'default' && showAi && !distractionFree">
        <div class="panel-divider v" @mousedown="startAiResize" @dblclick="aiWidth = 300"></div>
        <aside class="panel ai-panel" :style="{ width: aiWidth + 'px' }">
          <AiPanel />
        </aside>
      </template>

      <!-- 互换布局：工作区在右 -->
      <template v-if="layoutMode === 'swap'">
        <div v-if="showSidebar && !distractionFree" class="panel-divider v" @mousedown="startSidebarResize"></div>
        <aside v-if="showSidebar && !distractionFree" class="panel sidebar-panel" :style="{ width: sidebarWidth + 'px' }">
          <FileTree />
        </aside>
      </template>
    </div>

    <StatusBar v-if="!distractionFree" />
    <Settings v-if="configStore.showSettings" />

    <!-- 命令面板 -->
    <CommandPalette
      v-if="showCommandPalette"
      @close="showCommandPalette = false"
      @run="onCommandRun"
    />

    <!-- 全屏退出按钮 -->
    <button
      v-if="distractionFree"
      class="exit-fullscreen-btn"
      title="退出全屏 (F11)"
      @click="distractionFree = false"
    >
      <span class="exit-icon">⛶</span>
      <span class="exit-text">退出全屏</span>
    </button>
  </div>
</template>

<style scoped>
.app-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-primary);
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: var(--titlebar-height);
  padding: 0 10px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  -webkit-app-region: drag;
  user-select: none;
}
.toolbar button { -webkit-app-region: no-drag; }
.toolbar-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.app-title {
  font-weight: 600;
  font-size: 13px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-wrap: nowrap;
  overflow: hidden;
}
.toolbar-actions button {
  font-size: 12px;
  padding: 3px 8px;
  white-space: nowrap;
  color: var(--text-primary);
}
.toolbar-actions button.active {
  background: var(--accent-light);
  color: var(--accent);
}
.toolbar-actions .compile-btn {
  background: var(--accent);
  color: #fff;
  border-radius: var(--radius-sm);
}
.toolbar-actions .compile-btn:hover:not(:disabled) {
  background: var(--accent-hover);
}
.divider {
  width: 1px;
  height: 16px;
  background: var(--border);
  margin: 0 4px;
}
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.texlive-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  font-weight: 500;
}
.texlive-badge.ok {
  background: var(--success-bg);
  color: var(--success);
}
.texlive-badge.missing {
  background: var(--error-bg);
  color: var(--error);
}
.right-divider {
  width: 1px;
  height: 16px;
  background: var(--border);
  margin: 0 2px;
}
.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 14px;
  border: none;
  background: transparent;
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
}
.icon-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.icon-btn.active {
  background: var(--accent-light);
  color: var(--accent);
}
.layout-btn svg {
  display: block;
}

/* 窗口控制按钮 */
.win-controls {
  display: flex;
  align-items: center;
  margin-left: 4px;
  -webkit-app-region: no-drag;
}
.win-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: var(--titlebar-height);
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 0;
  transition: background 0.1s;
}
.win-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.win-close:hover {
  background: #e81123;
  color: #fff;
}
.win-btn svg {
  display: block;
}
.drag-region {
  -webkit-app-region: drag;
}

/* ===== 面板化布局 ===== */
.main-body {
  display: flex;
  flex: 1;
  min-height: 0;
  padding: 2px;
  gap: 2px;
  background: var(--bg-primary);
}

/* 通用面板样式：圆角矩形 */
.panel {
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-secondary);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.sidebar-panel {
  flex-shrink: 0;
  min-width: 160px;
  max-width: 400px;
}

.editor-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.preview-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.ai-panel {
  flex-shrink: 0;
  min-width: 200px;
  max-width: 600px;
}

/* 面板间分割线（可拖拽） */
.panel-divider {
  flex-shrink: 0;
  border-radius: 1px;
  transition: background 0.15s;
}
.panel-divider.v {
  width: 1px;
  cursor: col-resize;
  background: transparent;
  min-width: 1px;
}
.panel-divider.v:hover {
  background: var(--accent);
  opacity: 0.5;
}

.center-area {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  gap: 2px;
}

.editor-preview {
  display: flex;
  flex: 1;
  min-height: 0;
  gap: 2px;
}

.editor-wrap {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

/* 编辑器功能栏 — 分割线内缩 */
.editor-toolbar {
  display: flex;
  align-items: center;
  padding: 4px 12px;
  background: transparent;
  flex-shrink: 0;
  gap: 6px;
  min-height: 32px;
  position: relative;
}
.editor-toolbar::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 10px;
  right: 10px;
  height: 1px;
  background: var(--border);
}
.et-group {
  display: flex;
  align-items: center;
  gap: 2px;
}
.et-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 24px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  border-radius: 3px;
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
}
.et-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.et-btn.active {
  background: var(--accent-light);
  color: var(--accent);
}
.et-sep {
  width: 1px;
  height: 16px;
  background: var(--border);
  margin: 0 2px;
}

/* ========== VS Code 风格底部面板 ========== */
.bottom-panel {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: transparent;
  position: relative;
}
.bottom-panel::before {
  content: '';
  position: absolute;
  top: 0;
  left: 10px;
  right: 10px;
  height: 1px;
  background: var(--border);
}

.panel-handle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 28px;
  padding: 0 12px;
  background: transparent;
  cursor: pointer;
  user-select: none;
  flex-shrink: 0;
}
.panel-handle:hover {
  background: var(--bg-hover);
}

.handle-tabs {
  display: flex;
  gap: 2px;
  align-items: center;
}

.handle-tab {
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 3px;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  gap: 4px;
  position: relative;
}
.handle-tab:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}
.handle-tab.active {
  color: var(--text-primary);
  background: var(--bg-active);
}
.handle-tab.active::after {
  content: '';
  position: absolute;
  bottom: -1px;
  left: 8px;
  right: 8px;
  height: 2px;
  background: var(--accent);
  border-radius: 1px;
}

.badge {
  font-size: 10px;
  padding: 0 4px;
  border-radius: 8px;
  font-weight: 600;
  min-width: 14px;
  text-align: center;
}
.badge.error {
  background: var(--error);
  color: #fff;
}
.badge.warning {
  background: var(--warning);
  color: #fff;
}

.handle-actions {
  display: flex;
  gap: 2px;
}
.handle-btn {
  font-size: 10px;
  padding: 2px 6px;
  color: var(--text-tertiary);
  border-radius: 3px;
}
.handle-btn:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.panel-body {
  position: relative;
  border-top: 1px solid var(--border);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.panel-resize {
  position: absolute;
  top: -3px;
  left: 0;
  right: 0;
  height: 6px;
  cursor: row-resize;
  z-index: 10;
}
.panel-resize:hover {
  background: var(--accent);
  opacity: 0.5;
}

.distraction-free .main-body { padding: 0; }

.exit-fullscreen-btn {
  position: fixed;
  top: 12px;
  right: 12px;
  z-index: 9999;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 20px;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  opacity: 0.5;
  transition: opacity 0.2s, background 0.2s;
  box-shadow: var(--shadow);
}
.exit-fullscreen-btn:hover {
  opacity: 1;
  background: var(--bg-hover);
  color: var(--text-primary);
}
.exit-icon { font-size: 14px; }
</style>
