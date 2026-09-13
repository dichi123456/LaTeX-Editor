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
import { scanProjectImages } from './utils/images'
import type { CompileMode } from './stores/compile'
import logoUrl from './assets/logo.svg'

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
const openFileMenu = ref(false)
const openRecentMenu = ref(false)
const openHelpMenu = ref(false)
// 最近一次编译成功的 PDF 路径（供 SyncTeX 使用）
let lastPdfPath: string | null = null

let resizeCleanup: (() => void) | null = null
let autoCompileTimer: ReturnType<typeof setTimeout> | null = null
let autoSaveTimer: ReturnType<typeof setInterval> | null = null
let titleCleanup: (() => void) | null = null

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

  const offRequestCompile = () => {
    window.addEventListener('request-compile', onRequestCompile)
  }
  offRequestCompile()

  resizeCleanup = () => {
    offMenu()
    offProgress()
    offFileChanged()
    window.removeEventListener('request-compile', onRequestCompile)
  }

  // 自动保存定时器
  setupAutoSave()
  // 窗口标题跟随文件名
  setupWindowTitle()

  document.addEventListener('dragover', onDragOver)
  document.addEventListener('drop', onDrop)
  window.addEventListener('keydown', onGlobalKeydown)
  document.addEventListener('click', onOutsideMenuClick)
  window.addEventListener('close-all-menus', onCloseAllMenusApp)

  // SyncTeX 正向/反向同步事件
  window.addEventListener('synctex-forward', onSyncTexForward as unknown as EventListener)
  window.addEventListener('synctex-backward', onSyncTexBackward as unknown as EventListener)

  // 发送到墨灵
  window.addEventListener('send-to-moling', onSendToMoling as unknown as EventListener)
})

onUnmounted(() => {
  resizeCleanup?.()
  document.removeEventListener('dragover', onDragOver)
  document.removeEventListener('drop', onDrop)
  window.removeEventListener('keydown', onGlobalKeydown)
  document.removeEventListener('click', onOutsideMenuClick)
  window.removeEventListener('close-all-menus', onCloseAllMenusApp)
  window.removeEventListener('synctex-forward', onSyncTexForward as unknown as EventListener)
  window.removeEventListener('synctex-backward', onSyncTexBackward as unknown as EventListener)
  window.removeEventListener('send-to-moling', onSendToMoling as unknown as EventListener)
  if (autoCompileTimer) clearTimeout(autoCompileTimer)
  if (autoSaveTimer) clearInterval(autoSaveTimer)
  titleCleanup?.()
})

function closeFileMenu() {
  openFileMenu.value = false
  openRecentMenu.value = false
  openHelpMenu.value = false
}

function closeHelpMenu() {
  openHelpMenu.value = false
}

function toggleFileMenu() {
  if (!openFileMenu.value) {
    window.dispatchEvent(new CustomEvent('close-all-menus'))
  }
  openFileMenu.value = !openFileMenu.value
  openRecentMenu.value = false
  openHelpMenu.value = false
}

function toggleHelpMenu() {
  if (!openHelpMenu.value) {
    window.dispatchEvent(new CustomEvent('close-all-menus'))
  }
  openHelpMenu.value = !openHelpMenu.value
  openFileMenu.value = false
  openRecentMenu.value = false
}

async function onCheckUpdate() {
  closeFileMenu()
  closeHelpMenu()
  try {
    const result = await window.electronAPI.checkUpdate()
    if (result.success && result.hasUpdate) {
      const buttons = result.downloadUrl ? ['下载并安装', '前往网页', '稍后'] : ['前往网页', '稍后']
      const choice = confirm(`发现新版本 v${result.latest}（当前 v${result.current}）\n\n点击「确定」在应用内下载并安装，点击「取消」前往 GitHub 页面。`)
      if (choice && result.downloadUrl) {
        const ok = confirm(`将下载安装包并自动启动安装程序，安装完成后当前应用会退出。\n\n确认下载？`)
        if (ok) {
          alert('正在下载更新包，请稍候…')
          const dl = await window.electronAPI.downloadUpdate(result.downloadUrl)
          if (!dl.success) {
            alert(`下载失败：${dl.error}`)
          }
          // 成功时应用会自动退出并启动安装器
        }
      } else if (result.url) {
        window.electronAPI.openExternal(result.url)
      }
    } else if (result.success) {
      alert(`已是最新版本（v${result.current}）`)
    } else {
      alert(`检查更新失败：${result.error || '未知错误'}`)
    }
  } catch (err: any) {
    alert(`检查更新异常：${err.message}`)
  }
}

function onShowAbout() {
  closeFileMenu()
  closeHelpMenu()
  window.electronAPI.showAbout()
}

function onOutsideMenuClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (!target.closest('.menu-bar') && !target.closest('.menu-dropdown')) {
    closeFileMenu()
  }
}

function onCloseAllMenusApp() {
  closeFileMenu()
  openHelpMenu.value = false
}

function runFileAction(action: string) {
  closeFileMenu()
  switch (action) {
    case 'new-file': newFile(); break
    case 'open-file': openFile(); break
    case 'open-folder': openFolder(); break
    case 'save': save(); break
    case 'save-as': saveAs(); break
    case 'open-pdf': openPdfExternal(); break
    case 'clean': cleanAux(); break
    case 'settings': configStore.showSettings = true; break
    case 'command': showCommandPalette.value = true; break
  }
}

async function openRecentFile(path: string) {
  closeFileMenu()
  await docStore.openFile(path)
}

function onRequestCompile() {
  compileDoc()
}

function setupAutoSave() {
  if (autoSaveTimer) clearInterval(autoSaveTimer)
  const enabled = configStore.config?.autoSave !== false
  const intervalSec = configStore.config?.autoSaveInterval || 30
  if (!enabled) return
  autoSaveTimer = setInterval(async () => {
    if (!docStore.hasDirty) return
    const tab = docStore.activeTab
    if (!tab?.path) return // 未保存过路径的跳过，避免弹另存为
    await docStore.saveTab(tab.id)
  }, Math.max(5, intervalSec) * 1000)
}

// 配置变化时重建自动保存定时器
watch(
  () => [configStore.config?.autoSave, configStore.config?.autoSaveInterval],
  () => setupAutoSave()
)

function setupWindowTitle() {
  const update = () => {
    const tab = docStore.activeTab
    const name = tab ? `${tab.isDirty ? '● ' : ''}${tab.name}` : '墨灵TeX'
    window.electronAPI.setTitle(`${name} — 墨灵TeX`)
  }
  watch(() => [docStore.activeTabId, docStore.activeTab?.isDirty, docStore.activeTab?.name], update, { immediate: true })
  titleCleanup = () => { /* watcher 自动随组件卸载清理 */ }
}

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
    // 自动扫描项目中的图片文件
    scanProjectImages(path).then((imgs) => {
      if (imgs.length > 0) {
        compileStore.appendLiveLog(`[图片] 已扫描到 ${imgs.length} 个图片文件\n`)
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
    lastPdfPath = compileStore.lastResult.pdfPath
    if (lastPdfPath) {
      compileStore.appendLiveLog('[SyncTeX] 已就绪（双击编辑器/PDF 可双向跳转）\n')
    }
  }
}

// 正向同步：编辑器 双击/Ctrl+Click/右键 → 跳转 PDF（走官方 synctex CLI）
async function onSyncTexForward(e: CustomEvent) {
  const { line } = e.detail
  if (!line) return

  const texPath = docStore.activeTab?.path || docStore.mainTexPath
  const pdfPath = lastPdfPath || compileStore.lastResult?.pdfPath
  if (!texPath || !/\.tex$/i.test(texPath)) {
    compileStore.appendLiveLog('[SyncTeX] 请先打开一个 .tex 文件\n')
    return
  }
  if (!pdfPath) {
    compileStore.appendLiveLog('[SyncTeX] 请先编译生成 PDF\n')
    return
  }

  const tl = compileStore.texLivePath
  const result = await window.electronAPI.synctexForward(texPath, line, pdfPath, tl)
  if (result.success && result.page) {
    window.dispatchEvent(
      new CustomEvent('synctex-goto-pdf', {
        detail: { page: result.page, x: result.x, y: result.y }
      })
    )
  } else {
    compileStore.appendLiveLog(`[SyncTeX] 正向同步失败：${result.error || '未找到对应位置'}（第 ${line} 行）\n`)
  }
}

// 反向同步：PDF 双击/Ctrl+Click → 跳转编辑器（走官方 synctex CLI）
async function onSyncTexBackward(e: CustomEvent) {
  const { page, x, y } = e.detail
  if (!page) return

  const pdfPath = lastPdfPath || compileStore.lastResult?.pdfPath || compileStore.activePdfTab?.path
  if (!pdfPath) {
    compileStore.appendLiveLog('[SyncTeX] 未找到 PDF 路径\n')
    return
  }

  const tl = compileStore.texLivePath
  const result = await window.electronAPI.synctexBackward(page, x, y, pdfPath, tl)
  if (result.success && result.line != null) {
    // 如果目标文件不同，先打开
    if (result.file && docStore.activeTab?.path) {
      const activeName = docStore.activeTab.name
      const targetName = result.file.split(/[\\/]/).pop() || ''
      if (targetName && targetName !== activeName) {
        try {
          await docStore.openFile(result.file)
        } catch { /* ignore */ }
      }
    }
    window.dispatchEvent(
      new CustomEvent('jump-to-line', {
        detail: { line: result.line, file: result.file }
      })
    )
  } else {
    compileStore.appendLiveLog(`[SyncTeX] 反向同步失败：${result.error || '未匹配到源码行'}（第 ${page} 页）\n`)
  }
}

function onSendToMoling(e: CustomEvent) {
  const { text, filePath, fileName, lineRange } = e.detail || {}
  if (!text) return
  showAi.value = true
  window.dispatchEvent(new CustomEvent('moling-prefill', {
    detail: { text, filePath, fileName, lineRange }
  }))
}

async function cleanAux() {
  const mainPath = docStore.mainTexPath || docStore.activeTab?.path
  if (!mainPath) return
  const deleted = await compileStore.cleanAux(mainPath)
  // 刷新文件树
  window.dispatchEvent(new CustomEvent('refresh-file-tree'))
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
const showWelcome = computed(() => docStore.tabs.length === 0 && !docStore.projectRoot)
const errorCount = computed(() => compileStore.lastResult?.errors.length || 0)
const warningCount = computed(() => compileStore.lastResult?.warnings.length || 0)

function onTogglePanel(tab: 'problems' | 'log' | 'output') {
  if (panelOpen.value && panelTab.value === tab) {
    panelOpen.value = false
  } else {
    panelTab.value = tab
    panelOpen.value = true
  }
}

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
function windowClose() {
  if (docStore.hasDirty) {
    const names = docStore.tabs.filter((t) => t.isDirty).map((t) => t.name).join('、')
    const ok = confirm(`以下文件有未保存的更改：\n${names}\n\n确定退出？未保存内容将丢失。`)
    if (!ok) return
  }
  window.electronAPI.windowClose()
}
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
        <!-- VS Code 风格菜单栏 -->
        <div class="menu-bar">
          <img class="app-logo" :src="logoUrl" alt="墨灵TeX" draggable="false" />
          <div class="menu-item-wrap">
            <button
              class="menu-btn"
              :class="{ open: openFileMenu }"
              @click.stop="toggleFileMenu()"
            >文件</button>
            <div v-if="openFileMenu" class="menu-dropdown" @click.stop>
              <button class="menu-entry" @click="runFileAction('new-file')">
                <span>新建文件</span><span class="menu-key">Ctrl+N</span>
              </button>
              <button class="menu-entry" @click="runFileAction('open-file')">
                <span>打开文件…</span><span class="menu-key">Ctrl+O</span>
              </button>
              <button class="menu-entry" @click="runFileAction('open-folder')">
                <span>打开文件夹…</span><span class="menu-key">Ctrl+K</span>
              </button>

              <div class="menu-sep"></div>

              <!-- 打开最近的文件 -->
              <div class="menu-item-wrap nested">
                <button
                  class="menu-entry has-sub"
                  @click="openRecentMenu = !openRecentMenu"
                  @mouseenter="openRecentMenu = true"
                >
                  <span>打开最近的文件</span><span class="menu-arrow">▸</span>
                </button>
                <div v-if="openRecentMenu" class="menu-dropdown submenu">
                  <template v-if="docStore.recentFiles.length">
                    <button
                      v-for="rf in docStore.recentFiles.slice(0, 12)"
                      :key="rf"
                      class="menu-entry"
                      :title="rf"
                      @click="openRecentFile(rf)"
                    >
                      <span class="truncate">{{ rf.split(/[\\/]/).pop() }}</span>
                    </button>
                  </template>
                  <div v-else class="menu-empty">暂无最近文件</div>
                </div>
              </div>

              <div class="menu-sep"></div>

              <button class="menu-entry" @click="runFileAction('save')">
                <span>保存</span><span class="menu-key">Ctrl+S</span>
              </button>
              <button class="menu-entry" @click="runFileAction('save-as')">
                <span>另存为…</span><span class="menu-key">Ctrl+Shift+S</span>
              </button>

              <div class="menu-sep"></div>

              <button class="menu-entry" @click="runFileAction('open-pdf')">
                <span>外部打开 PDF</span><span class="menu-key">F7</span>
              </button>
              <button class="menu-entry" @click="runFileAction('clean')">
                <span>清理辅助文件</span><span class="menu-key">Ctrl+Shift+D</span>
              </button>

              <div class="menu-sep"></div>

              <button class="menu-entry" @click="runFileAction('settings')">
                <span>设置</span><span class="menu-key">Ctrl+,</span>
              </button>
              <button class="menu-entry" @click="runFileAction('command')">
                <span>命令面板</span><span class="menu-key">Ctrl+Shift+P</span>
              </button>
            </div>
          </div>

          <button class="menu-btn" title="命令面板 (Ctrl+Shift+P)" @click="showCommandPalette = true">命令</button>
          <button class="menu-btn" title="设置 (Ctrl+,)" @click="configStore.showSettings = true">设置</button>
          <!-- 帮助菜单 -->
          <div class="menu-item-wrap">
            <button class="menu-btn" :class="{ open: openHelpMenu }" @click.stop="toggleHelpMenu()">帮助</button>
            <div v-if="openHelpMenu" class="menu-dropdown" @click.stop>
              <button class="menu-entry" @click="onCheckUpdate">
                <span>检查更新</span>
              </button>
              <button class="menu-entry" @click="onShowAbout">
                <span>关于 墨灵TeX</span>
              </button>
            </div>
          </div>
        </div>
      </div>
      <div class="toolbar-right">
        <button
          class="icon-btn"
          :class="{ active: showAi }"
          title="墨灵 AI 助手"
          @click="showAi = !showAi"
        >
          <!-- 聊天框图标 -->
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M2.5 3.5A1.5 1.5 0 0 1 4 2h8a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 12 11H6.5L3.5 13.5V11H4a1.5 1.5 0 0 1-1.5-1.5v-6z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
            <circle cx="5.5" cy="6.5" r="0.7" fill="currentColor"/>
            <circle cx="8" cy="6.5" r="0.7" fill="currentColor"/>
            <circle cx="10.5" cy="6.5" r="0.7" fill="currentColor"/>
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
          <!-- 细条把手（标签已移至状态栏） -->
          <div class="panel-handle slim" @click="panelOpen = !panelOpen">
            <span class="handle-chevron">{{ panelOpen ? '▼' : '▲' }}</span>
          </div>

          <!-- 面板内容：带展开过渡 -->
          <Transition name="panel-slide">
            <div v-if="panelOpen" class="panel-body" :style="{ height: panelHeight + 'px' }">
              <div class="panel-resize" @mousedown="startPanelResize"></div>
              <LogPanel
                v-if="panelTab === 'log' || panelTab === 'problems' || panelTab === 'output'"
                :mode="panelTab"
                @jump="jumpToLine"
              />
            </div>
          </Transition>
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

    <StatusBar
      v-if="!distractionFree"
      :panel-open="panelOpen"
      :panel-tab="panelTab"
      :error-count="errorCount"
      :warning-count="warningCount"
      @toggle-panel="onTogglePanel"
    />
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

/* VS Code 风格菜单栏 */
.menu-bar {
  display: flex;
  align-items: center;
  gap: 2px;
}
.app-logo {
  width: 22px;
  height: 22px;
  margin-right: 6px;
  border-radius: 5px;
  flex-shrink: 0;
  -webkit-user-select: none;
  user-select: none;
  pointer-events: none;
}
.menu-item-wrap {
  position: relative;
}
.menu-btn {
  font-size: 13px;
  padding: 4px 10px;
  white-space: nowrap;
  color: var(--text-primary);
  border-radius: var(--radius-sm);
  background: transparent;
  border: none;
  cursor: pointer;
}
.menu-btn:hover,
.menu-btn.open {
  background: var(--bg-hover);
}
.menu-dropdown {
  position: absolute;
  top: calc(100% + 2px);
  left: 0;
  min-width: 220px;
  background: rgba(30, 30, 46, 0.3);
  backdrop-filter: blur(20px) saturate(1.6);
  -webkit-backdrop-filter: blur(20px) saturate(1.6);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  box-shadow: var(--shadow-lg);
  padding: 4px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 1px;
  animation: menuPop 0.14s ease;
}
[data-theme="light"] .menu-dropdown {
  background: rgba(255, 255, 255, 0.3);
  border-color: rgba(0, 0, 0, 0.06);
}
@keyframes menuPop {
  from {
    opacity: 0;
    transform: translateY(-4px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
.menu-entry {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  width: 100%;
  padding: 6px 12px;
  font-size: 13px;
  color: var(--text-primary);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  text-align: left;
}
.menu-entry:hover {
  background: var(--accent);
  color: #fff;
}
.menu-entry:hover .menu-key,
.menu-entry:hover .menu-arrow {
  color: rgba(255, 255, 255, 0.85);
}
.menu-key {
  font-size: 11px;
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.menu-arrow {
  font-size: 11px;
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.menu-sep {
  height: 1px;
  background: var(--border);
  margin: 4px 8px;
}
.menu-entry.has-sub {
  justify-content: space-between;
}
.menu-dropdown.submenu {
  position: absolute;
  top: 0;
  left: 100%;
  min-width: 240px;
  margin-left: 2px;
  background: rgba(30, 30, 46, 0.88);
  backdrop-filter: blur(24px) saturate(1.8);
  -webkit-backdrop-filter: blur(24px) saturate(1.8);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  box-shadow: var(--shadow-lg);
  animation: menuPop 0.14s ease;
}
[data-theme="light"] .menu-dropdown.submenu {
  background: rgba(255, 255, 255, 0.88);
  border-color: rgba(0, 0, 0, 0.08);
}
.menu-empty {
  padding: 8px 12px;
  font-size: 12px;
  color: var(--text-tertiary);
}
.menu-entry .truncate {
  overflow: hidden;
  text-overflow: ellipsis;
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
  justify-content: center;
  height: 18px;
  background: transparent;
  cursor: pointer;
  user-select: none;
  flex-shrink: 0;
}
.panel-handle.slim:hover {
  background: var(--bg-hover);
}
.handle-chevron {
  font-size: 9px;
  color: var(--text-tertiary);
}

.panel-body {
  position: relative;
  border-top: 1px solid var(--border);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* 面板展开/收起过渡 */
.panel-slide-enter-active {
  transition: height 0.18s ease, opacity 0.15s ease;
}
.panel-slide-leave-active {
  transition: height 0.15s ease, opacity 0.1s ease;
}
.panel-slide-enter-from,
.panel-slide-leave-to {
  opacity: 0;
  height: 0 !important;
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
