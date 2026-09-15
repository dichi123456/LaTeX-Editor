<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed, nextTick } from 'vue'
import { useDocStore } from '../stores/docs'
import { useCompileStore } from '../stores/compile'
import TreeNode from './TreeNode.vue'
import Outline from './Outline.vue'
import type { DirEntry } from '../types'

const docStore = useDocStore()
const compileStore = useCompileStore()

const tree = ref<DirEntry[]>([])
const extraTrees = ref<Map<string, DirEntry[]>>(new Map())
const expanded = ref<Set<string>>(new Set())
const selectedPath = ref<string | null>(null)
const renaming = ref<string | null>(null)
const renameValue = ref('')
const showNewInput = ref(false)
const newFileName = ref('')
const newIsDir = ref(false)
const workspaceOpen = ref(true)
const extraOpen = ref<Set<string>>(new Set())
const showOutline = ref(false)

// 右键菜单
const ctxMenu = ref({ show: false, x: 0, y: 0 })

const workspaceName = computed(() => {
  if (!docStore.projectRoot) return ''
  const parts = docStore.projectRoot.split(/[\\/]/)
  return parts[parts.length - 1] || docStore.projectRoot
})

function folderName(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

async function loadTree() {
  if (!docStore.projectRoot) {
    tree.value = []
    return
  }
  tree.value = await window.electronAPI.listDir(docStore.projectRoot)
  // 加载附加文件夹
  for (const folder of docStore.extraFolders) {
    extraTrees.value.set(folder, await window.electronAPI.listDir(folder))
  }
}

async function loadExtraTree(folder: string) {
  extraTrees.value.set(folder, await window.electronAPI.listDir(folder))
  extraTrees.value = new Map(extraTrees.value)
}

function toggleWorkspace() {
  workspaceOpen.value = !workspaceOpen.value
}

function toggleExtra(path: string) {
  if (extraOpen.value.has(path)) {
    extraOpen.value.delete(path)
  } else {
    extraOpen.value.add(path)
  }
  extraOpen.value = new Set(extraOpen.value)
}

function toggleDir(path: string) {
  if (expanded.value.has(path)) {
    expanded.value.delete(path)
  } else {
    expanded.value.add(path)
  }
  expanded.value = new Set(expanded.value)
}

async function openEntry(entry: DirEntry) {
  if (entry.isDirectory) {
    toggleDir(entry.path)
    return
  }
  selectedPath.value = entry.path
  if (/\.pdf$/i.test(entry.name)) {
    compileStore.openPdfTab(entry.path)
    return
  }
  if (/\.(tex|bib|sty|cls|md|txt|bbl|bst|dtx|ins|ltx)$/i.test(entry.name)) {
    await docStore.openFile(entry.path)
  }
}

async function openExtraEntry(entry: DirEntry) {
  if (entry.isDirectory) {
    toggleDir(entry.path)
    return
  }
  selectedPath.value = entry.path
  if (/\.pdf$/i.test(entry.name)) {
    compileStore.openPdfTab(entry.path)
    return
  }
  if (/\.(tex|bib|sty|cls|md|txt|bbl|bst|dtx|ins|ltx)$/i.test(entry.name)) {
    await docStore.openFile(entry.path)
  }
}

function createParentDir(): string {
  // 若选中的是目录，则在该目录下新建；否则用工作区根
  const sel = selectedPath.value
  if (!sel || !docStore.projectRoot) return docStore.projectRoot || ''
  const entry = findEntryByPath(tree.value, sel)
  if (entry?.isDirectory) return entry.path
  // 选中文件时，在其父目录创建
  return sel.replace(/[^\\/]+$/, '').replace(/[\\/]+$/, '') || docStore.projectRoot
}

function findEntryByPath(entries: DirEntry[], path: string): DirEntry | null {
  for (const e of entries) {
    if (e.path === path) return e
    if (e.children) {
      const hit = findEntryByPath(e.children, path)
      if (hit) return hit
    }
  }
  return null
}

function parentDirOf(path: string): string {
  const p = path.replace(/[^\\/]+$/, '').replace(/[\\/]+$/, '')
  return p || path
}

async function createNewFile() {
  showNewInput.value = true
  newIsDir.value = false
  newFileName.value = ''
  await focusNewInput()
}

async function createNewFolder() {
  showNewInput.value = true
  newIsDir.value = true
  newFileName.value = ''
  await focusNewInput()
}

async function focusNewInput() {
  await nextTick()
  const input = document.querySelector<HTMLInputElement>('.new-input-row input')
  input?.focus()
  input?.select()
}

async function createNew() {
  const name = newFileName.value.trim()
  if (!name) return
  const parent = createParentDir()
  if (!parent) {
    alert('请先打开工作区')
    return
  }
  if (newIsDir.value) {
    const created = await window.electronAPI.createDir(parent, name)
    if (!created) {
      alert('创建文件夹失败：可能已存在或无权限')
      return
    }
  } else {
    const path = await window.electronAPI.createFile(parent, name)
    if (!path) {
      alert('创建文件失败：可能已存在或无权限')
      return
    }
    await docStore.openFile(path)
    selectedPath.value = path
  }
  await loadTree()
  // 若在子目录创建，展开父目录
  const parentEntry = tree.value.find((e) => e.path === parent || parent.startsWith(e.path))
  if (parentEntry?.isDirectory) toggleDir(parentEntry.path)
  showNewInput.value = false
  newFileName.value = ''
  newIsDir.value = false
}

async function addFolderToWorkspace() {
  const dir = await window.electronAPI.chooseDirectory()
  if (dir && dir !== docStore.projectRoot) {
    docStore.addExtraFolder(dir)
    await loadExtraTree(dir)
    extraOpen.value.add(dir)
  }
}

function removeFolderFromWorkspace(path: string) {
  docStore.removeExtraFolder(path)
  extraTrees.value.delete(path)
  extraTrees.value = new Map(extraTrees.value)
}

async function deleteEntry(entry: DirEntry) {
  const msg = entry.isDirectory
    ? `确定删除文件夹「${entry.name}」及其中所有文件？此操作不可撤销。`
    : `确定删除文件「${entry.name}」？`
  if (!confirm(msg)) return
  await window.electronAPI.deleteFile(entry.path)
  // 若删除的是已打开的 PDF，关闭对应预览标签
  if (!entry.isDirectory && /\.pdf$/i.test(entry.name)) {
    compileStore.closePdfTabByPath(entry.path)
  }
  await loadTree()
  for (const folder of docStore.extraFolders) {
    if (folder === entry.path || entry.path.startsWith(folder)) {
      await loadExtraTree(folder)
    }
  }
}

function startRename(entry: DirEntry) {
  renaming.value = entry.path
  renameValue.value = entry.name
}

async function confirmRename(entry: DirEntry) {
  renaming.value = null
  const newName = renameValue.value.trim()
  if (!newName || newName === entry.name) return
  const newPath = entry.path.replace(/[^\\/]+$/, newName)
  const ok = await window.electronAPI.renameFile(entry.path, newPath)
  if (!ok) {
    alert('重命名失败：可能已存在同名文件或无权限')
    return
  }
  if (docStore.mainTexPath === entry.path) {
    docStore.setMainTex(newPath)
  }
  const tab = docStore.tabs.find((t) => t.path === entry.path)
  if (tab) {
    tab.path = newPath
    tab.name = newName
  }
  await loadTree()
}

function isMain(entry: DirEntry): boolean {
  return docStore.mainTexPath === entry.path
}

function iconFor(entry: DirEntry): string {
  if (entry.isDirectory) return '📁'
  const ext = entry.name.split('.').pop()?.toLowerCase() || ''
  const map: Record<string, string> = {
    tex: '📄', bib: '📚', sty: '⚙️', cls: '📦',
    png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️',
    pdf: '📕', md: '📝', txt: '📃'
  }
  return map[ext] || '📄'
}

// 右键菜单
function onContextMenu(e: MouseEvent) {
  e.preventDefault()
  // 关闭其他菜单
  window.dispatchEvent(new CustomEvent('close-all-menus'))
  ctxMenu.value = { show: true, x: e.clientX, y: e.clientY }
}

function closeCtxMenu() {
  ctxMenu.value.show = false
}

async function openFolderDialog() {
  const path = await window.electronAPI.openFolder()
  if (path) await docStore.openProjectFolder(path)
}

function exitWorkspace() {
  if (!docStore.projectRoot) return
  const dirtyCount = docStore.tabs.filter((t) => t.isDirty).length
  const msg = dirtyCount > 0
    ? `退出当前工作区？\n\n已打开的 ${docStore.tabs.length} 个文件标签将全部关闭，其中 ${dirtyCount} 个有未保存更改（会丢失）。\n\n确定退出？`
    : `退出当前工作区？\n\n已打开的 ${docStore.tabs.length} 个文件标签将全部关闭。\n\n确定退出？`
  if (!confirm(msg)) return
  // 真正关闭所有标签
  docStore.tabs.splice(0, docStore.tabs.length)
  docStore.activeTabId = null
  docStore.mainTexPath = null
  docStore.projectRoot = null
  tree.value = []
  expanded.value.clear()
  extraTrees.value.clear()
  extraOpen.value.clear()
  workspaceOpen.value = false
  loadTree()
}

function ctxAction(action: string) {
  closeCtxMenu()
  requestAnimationFrame(() => {
    switch (action) {
      case 'new-file': createNewFile(); break
      case 'new-folder': createNewFolder(); break
      case 'add-folder': addFolderToWorkspace(); break
      case 'remove-last-folder':
        if (docStore.extraFolders.length > 0) {
          removeFolderFromWorkspace(docStore.extraFolders[docStore.extraFolders.length - 1])
        }
        break
    }
  })
}

function cancelNewInput() {
  showNewInput.value = false
  newFileName.value = ''
  newIsDir.value = false
}

function onGlobalClick(e: Event) {
  const target = e.target as HTMLElement
  if (!target.closest('.ctx-menu')) {
    closeCtxMenu()
  }
  if (
    showNewInput.value &&
    !target.closest('.new-input-row') &&
    !target.closest('.ctx-menu') &&
    !target.closest('.ws-icon-btn') &&
    !target.closest('[data-new-input-trigger]')
  ) {
    cancelNewInput()
  }
}

function onCloseAllMenus() {
  closeCtxMenu()
  showNewInput.value = false
}

watch(
  () => docStore.projectRoot,
  () => {
    loadTree()
    expanded.value.clear()
    workspaceOpen.value = true
  },
  { immediate: true }
)

onMounted(() => {
  loadTree()
  document.addEventListener('click', onGlobalClick)
  window.addEventListener('refresh-file-tree', loadTree)
  window.addEventListener('close-all-menus', onCloseAllMenus)
})

onUnmounted(() => {
  document.removeEventListener('click', onGlobalClick)
  window.removeEventListener('refresh-file-tree', loadTree)
  window.removeEventListener('close-all-menus', onCloseAllMenus)
})
</script>

<template>
  <div class="file-tree">
    <div class="tree-header">
      <span class="tree-title">工作区</span>
      <button
        v-if="docStore.projectRoot"
        class="ws-icon-btn exit-ws-btn"
        title="退出当前工作区"
        @click="exitWorkspace"
      >
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
          <path d="M5.5 2.5H3.5C2.67 2.5 2 3.17 2 4v6c0 .83.67 1.5 1.5 1.5h2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
          <path d="M8.5 4.5L11 7l-2.5 2.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
          <line x1="6" y1="7" x2="11" y2="7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
        </svg>
      </button>
    </div>

    <div class="tree-scroll" @contextmenu="onContextMenu">
      <!-- 主工作区根节点 -->
      <div v-if="docStore.projectRoot" class="workspace-node">
        <div class="workspace-row" @click="toggleWorkspace">
          <span class="ws-arrow" :class="{ open: workspaceOpen }">▶</span>
          <span class="ws-icon">📁</span>
          <span class="ws-name truncate">{{ workspaceName }}</span>
          <div class="ws-actions" @click.stop>
            <button class="ws-icon-btn" title="新建文件" @click.stop="createNewFile">
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                <path d="M8 1H3.5C2.67 1 2 1.67 2 2.5v9C2 12.33 2.67 13 3.5 13h7c.83 0 1.5-.67 1.5-1.5V5L8 1z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
                <path d="M8 1v4h4" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
                <line x1="7" y1="7.5" x2="7" y2="11.5" stroke="currentColor" stroke-width="1.2"/>
                <line x1="5" y1="9.5" x2="9" y2="9.5" stroke="currentColor" stroke-width="1.2"/>
              </svg>
            </button>
            <button class="ws-icon-btn" title="新建文件夹" @click.stop="createNewFolder">
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                <path d="M1.5 3.5C1.5 2.67 2.17 2 3 2h3l1.5 1.5H11c.83 0 1.5.67 1.5 1.5v6c0 .83-.67 1.5-1.5 1.5H3c-.83 0-1.5-.67-1.5-1.5v-7z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
                <line x1="7" y1="6.5" x2="7" y2="10.5" stroke="currentColor" stroke-width="1.2"/>
                <line x1="5" y1="8.5" x2="9" y2="8.5" stroke="currentColor" stroke-width="1.2"/>
              </svg>
            </button>
            <button class="ws-icon-btn" title="刷新" @click="loadTree">
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                <path d="M12 7A5 5 0 1 1 7 2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
                <polyline points="12,2 12,5.5 8.5,5.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
              </svg>
            </button>
          </div>
        </div>

        <div v-if="workspaceOpen" class="workspace-children">
          <div v-if="showNewInput" class="new-input-row">
            <input
              v-model="newFileName"
              :placeholder="newIsDir ? '文件夹名' : '文件名（Esc 取消）'"
              @keyup.enter="createNew"
              @keyup.esc="cancelNewInput"
              autofocus
            />
            <button @click="createNew" class="btn-create">创建</button>
          </div>
          <template v-for="entry in tree" :key="entry.path">
            <TreeNode
              :entry="entry"
              :depth="1"
              :expanded-set="expanded"
              :selected-path="selectedPath"
              :renaming="renaming"
              :rename-value="renameValue"
              :is-main="isMain"
              :icon-for="iconFor"
              @toggle="toggleDir"
              @open="openEntry"
              @delete="deleteEntry"
              @start-rename="startRename"
              @confirm-rename="confirmRename"
              @update-rename="(v: string) => (renameValue = v)"
            />
          </template>
        </div>
      </div>

      <!-- 附加文件夹 -->
      <div v-for="folder in docStore.extraFolders" :key="folder" class="workspace-node">
        <div class="workspace-row" @click="toggleExtra(folder)">
          <span class="ws-arrow" :class="{ open: extraOpen.has(folder) }">▶</span>
          <span class="ws-icon">📁</span>
          <span class="ws-name truncate">{{ folderName(folder) }}</span>
          <div class="ws-actions" @click.stop>
            <button class="ws-icon-btn" title="从工作区移除" @click="removeFolderFromWorkspace(folder)">
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                <line x1="3" y1="7" x2="11" y2="7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
              </svg>
            </button>
          </div>
        </div>
        <div v-if="extraOpen.has(folder)" class="workspace-children">
          <template v-for="entry in (extraTrees.get(folder) || [])" :key="entry.path">
            <TreeNode
              :entry="entry"
              :depth="1"
              :expanded-set="expanded"
              :selected-path="selectedPath"
              :renaming="renaming"
              :rename-value="renameValue"
              :is-main="isMain"
              :icon-for="iconFor"
              @toggle="toggleDir"
              @open="openExtraEntry"
              @delete="deleteEntry"
              @start-rename="startRename"
              @confirm-rename="confirmRename"
              @update-rename="(v: string) => (renameValue = v)"
            />
          </template>
        </div>
      </div>

      <!-- 未打开工作区 -->
      <div v-if="!docStore.projectRoot" class="tree-empty">
        <div class="empty-icon">📁</div>
        <p>未打开文件夹</p>
        <button class="open-folder-btn" @click="openFolderDialog">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M1.5 3.5C1.5 2.67 2.17 2 3 2h3l1.5 1.5H11c.83 0 1.5.67 1.5 1.5v6c0 .83-.67 1.5-1.5 1.5H3c-.83 0-1.5-.67-1.5-1.5v-7z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
          </svg>
          打开文件夹
        </button>
        <small>或通过「文件 → 打开文件夹」打开项目</small>
      </div>
    </div>

    <!-- 右键菜单 -->
    <Teleport to="body">
      <div
        v-if="ctxMenu.show"
        class="ctx-menu"
        :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }"
        @click.stop
      >
        <button class="ctx-item" @click="ctxAction('new-file')">
          <span class="ctx-icon">📄</span> 新建文件
        </button>
        <button class="ctx-item" @click="ctxAction('new-folder')">
          <span class="ctx-icon">📁</span> 新建文件夹
        </button>
        <div class="ctx-divider"></div>
        <button class="ctx-item" @click="ctxAction('add-folder')">
          <span class="ctx-icon">➕</span> 将文件夹加入工作区
        </button>
        <button
          v-if="docStore.extraFolders.length > 0"
          class="ctx-item"
          @click="ctxAction('remove-last-folder')"
        >
          <span class="ctx-icon">➖</span> 将文件夹从工作区删除
        </button>
      </div>
    </Teleport>

    <!-- 大纲面板 -->
    <div class="outline-section">
      <button class="outline-toggle" @click="showOutline = !showOutline">
        <span class="outline-arrow" :class="{ open: showOutline }">▶</span>
        <span>大纲</span>
      </button>
      <Outline v-if="showOutline" class="outline-body" />
    </div>
  </div>
</template>

<style scoped>
.file-tree {
  display: flex;
  flex-direction: column;
  height: 100%;
  font-size: 13px;
}
.tree-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px 6px 12px;
  flex-shrink: 0;
  position: relative;
}
.tree-header::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 10px;
  right: 10px;
  height: 1px;
  background: var(--border);
}
.tree-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  letter-spacing: 0.5px;
}
.exit-ws-btn {
  flex-shrink: 0;
}
.exit-ws-btn:hover {
  color: var(--error);
  background: var(--error-bg);
}
.tree-scroll {
  flex: 1;
  overflow: auto;
  min-height: 0;
}
.workspace-node {
  user-select: none;
}
.workspace-row {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 6px 0 4px;
  cursor: pointer;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 600;
}
.workspace-row:hover {
  background: var(--bg-hover);
}
.ws-arrow {
  font-size: 8px;
  color: var(--text-tertiary);
  transition: transform 0.15s;
  flex-shrink: 0;
  width: 14px;
  text-align: center;
  transform: rotate(90deg);
}
.ws-arrow:not(.open) {
  transform: rotate(0deg);
}
.ws-icon {
  font-size: 14px;
  flex-shrink: 0;
}
.ws-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ws-actions {
  display: flex;
  gap: 1px;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s;
}
.workspace-row:hover .ws-actions {
  opacity: 1;
}
.ws-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  border-radius: 3px;
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
}
.ws-icon-btn:hover {
  background: var(--bg-active);
  color: var(--text-primary);
}
.new-input-row {
  display: flex;
  gap: 4px;
  padding: 2px 8px 2px 24px;
  align-items: center;
}
.new-input-row input {
  flex: 1;
  min-width: 0;
  padding: 2px 6px;
  font-size: 12px;
}
.btn-create {
  padding: 2px 8px;
  font-size: 11px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 3px;
  cursor: pointer;
}
.btn-create:hover {
  background: var(--accent-hover);
}
.tree-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 28px 16px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 12px;
  line-height: 1.6;
}
.tree-empty .empty-icon {
  font-size: 28px;
  opacity: 0.5;
  margin-bottom: 4px;
}
.open-folder-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  font-size: 12px;
  color: var(--text-primary);
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.open-folder-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-light);
}
.tree-empty small {
  font-size: 11px;
  color: var(--text-tertiary);
  opacity: 0.7;
}

/* 右键菜单 */
.ctx-menu {
  position: fixed;
  z-index: 10000;
  background: rgba(30, 30, 46, 0.3);
  backdrop-filter: blur(20px) saturate(1.6);
  -webkit-backdrop-filter: blur(20px) saturate(1.6);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  box-shadow: var(--shadow-lg);
  min-width: 200px;
  padding: 4px 0;
  animation: menuPop 0.14s ease;
}
[data-theme="light"] .ctx-menu {
  background: rgba(255, 255, 255, 0.3);
  border-color: rgba(0, 0, 0, 0.06);
}
@keyframes menuPop {
  from { opacity: 0; transform: translateY(-4px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.ctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 14px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-primary);
  text-align: left;
}
.ctx-item:hover {
  background: var(--bg-hover);
}
.ctx-icon {
  font-size: 14px;
  width: 18px;
  text-align: center;
}
.ctx-divider {
  height: 1px;
  background: var(--border);
  margin: 4px 0;
}

/* 大纲面板 */
.outline-section {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  max-height: 40%;
  position: relative;
}
.outline-section::before {
  content: '';
  position: absolute;
  top: 0;
  left: 10px;
  right: 10px;
  height: 1px;
  background: var(--border);
}
.outline-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 12px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  flex-shrink: 0;
  text-align: left;
}
.outline-toggle:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.outline-arrow {
  font-size: 8px;
  transition: transform 0.15s;
}
.outline-arrow.open {
  transform: rotate(90deg);
}
.outline-body {
  flex: 1;
  overflow: auto;
  min-height: 0;
}
</style>
