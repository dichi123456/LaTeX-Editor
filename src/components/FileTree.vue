<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed, nextTick } from 'vue'
import { useDocStore } from '../stores/docs'
import { useCompileStore } from '../stores/compile'
import TreeNode from './TreeNode.vue'
import Outline from './Outline.vue'
import type { DirEntry } from '../types'

const emit = defineEmits<{
  (e: 'open-template-library', targetDir?: string): void
}>()

const docStore = useDocStore()
const compileStore = useCompileStore()

const tree = ref<DirEntry[]>([])
const extraTrees = ref<Map<string, DirEntry[]>>(new Map())
const expanded = ref<Set<string>>(new Set())
const selectedPath = ref<string | null>(null)
/** 多选集合；size===0 表示未选 */
const selectedPaths = ref<Set<string>>(new Set())
/** Shift 范围选择锚点 */
const selectAnchor = ref<string | null>(null)
/** 剪贴板：复制/剪切的路径 */
const clipboard = ref<{ paths: string[]; cut: boolean } | null>(null)
const renaming = ref<string | null>(null)
const renameValue = ref('')
const showNewInput = ref(false)
const newFileName = ref('')
const newIsDir = ref(false)
/** 文件树名称过滤 */
const filterQuery = ref('')
const workspaceOpen = ref(true)
/** 「工作区」整组折叠（MiMo 项目分组） */
const projectsSectionOpen = ref(true)
/** 点击互换：第一次点击记为 A，第二次点击与 A 互换位置 */
const swapSource = ref<string | null>(null)
/** 拖拽互换 */
const dragPath = ref<string | null>(null)
const dropTargetPath = ref<string | null>(null)
const extraOpen = ref<Set<string>>(new Set())
const showOutline = ref(false)
const treeFocused = ref(false)
const treeScrollRef = ref<HTMLElement | null>(null)

// 右键菜单
const ctxMenu = ref({ show: false, x: 0, y: 0 })
const itemCtx = ref({ show: false, x: 0, y: 0, entry: null as DirEntry | null })
/** 右键「从模板导入」的目标项目路径 */
const ctxTargetProject = ref<string | null>(null)

const workspaceName = computed(() => {
  if (!docStore.projectRoot) return ''
  const parts = docStore.projectRoot.split(/[\\/]/)
  return parts[parts.length - 1] || docStore.projectRoot
})

/** 多项目列表：按 projectOrder 排序，不分主次 */
const projectList = computed<Array<{ path: string; name: string; isMain: boolean }>>(() => {
  // 依赖 root/extra 变化；order 在 store 方法里维护
  const order = docStore.projectOrder
  const known = new Map<string, boolean>()
  if (docStore.projectRoot) known.set(docStore.projectRoot, true)
  for (const f of docStore.extraFolders) {
    if (!known.has(f)) known.set(f, false)
  }

  const list: Array<{ path: string; name: string; isMain: boolean }> = []
  const seen = new Set<string>()
  for (const path of order) {
    if (!known.has(path) || seen.has(path)) continue
    seen.add(path)
    list.push({
      path,
      name: folderName(path),
      isMain: path === docStore.projectRoot
    })
  }
  for (const [path, isMain] of known) {
    if (seen.has(path)) continue
    list.push({ path, name: folderName(path), isMain })
  }
  return list
})

function toggleProjectsSection() {
  projectsSectionOpen.value = !projectsSectionOpen.value
}

function folderName(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

/** 点击项目名：第一次记为互换源，第二次与之互换位置 */
function onProjectNameClick(path: string) {
  if (!swapSource.value) {
    swapSource.value = path
    return
  }
  if (swapSource.value === path) {
    swapSource.value = null
    return
  }
  docStore.swapProjects(swapSource.value, path)
  swapSource.value = null
}

/** 拖拽互换项目位置 */
function onProjDragStart(path: string, e: DragEvent) {
  dragPath.value = path
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', path)
  }
}

function onProjDragOver(path: string, e: DragEvent) {
  if (!dragPath.value || dragPath.value === path) return
  e.preventDefault()
  e.stopPropagation()
  dropTargetPath.value = path
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
}

function onProjDragLeave(path: string) {
  if (dropTargetPath.value === path) dropTargetPath.value = null
}

function onProjDrop(path: string, e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  const from = dragPath.value
  dragPath.value = null
  dropTargetPath.value = null
  if (!from || from === path) return
  docStore.swapProjects(from, path)
}

function onProjDragEnd() {
  dragPath.value = null
  dropTargetPath.value = null
}

/** 新建前把目标项目树加载好（任意项目均可新建） */
function setMainForNew(path: string) {
  if (path === docStore.projectRoot) {
    workspaceOpen.value = true
    return
  }
  extraOpen.value.add(path)
  extraOpen.value = new Set(extraOpen.value)
  void loadExtraTree(path)
  selectedPath.value = path
}

// ===== 多选 =====
function setSingleSelect(path: string | null) {
  selectedPath.value = path
  selectedPaths.value = path ? new Set([path]) : new Set()
  selectAnchor.value = path
}

function toggleSelect(path: string) {
  const s = new Set(selectedPaths.value)
  if (s.has(path)) {
    s.delete(path)
  } else {
    s.add(path)
  }
  selectedPaths.value = s
  selectedPath.value = s.has(path) ? path : (Array.from(s).pop() ?? null)
  selectAnchor.value = path
}

function rangeSelect(path: string) {
  const flat = flattenVisible()
  const paths = flat.map((e) => e.path)
  const anchor = selectAnchor.value && paths.includes(selectAnchor.value)
    ? selectAnchor.value
    : selectedPath.value && paths.includes(selectedPath.value)
      ? selectedPath.value
      : paths[0]
  if (!anchor) {
    setSingleSelect(path)
    return
  }
  const i = paths.indexOf(anchor)
  const j = paths.indexOf(path)
  if (i < 0 || j < 0) {
    setSingleSelect(path)
    return
  }
  const [a, b] = i <= j ? [i, j] : [j, i]
  selectedPaths.value = new Set(paths.slice(a, b + 1))
  selectedPath.value = path
}

function selectAll() {
  const flat = flattenVisible()
  selectedPaths.value = new Set(flat.map((e) => e.path))
  selectedPath.value = flat.length ? flat[flat.length - 1].path : null
}

/** 可见（已展开路径上）的扁平列表，顺序与渲染一致 */
function flattenVisible(entries?: DirEntry[], onlyExpanded = false): DirEntry[] {
  const roots = entries ?? [
    ...(workspaceOpen.value ? tree.value : []),
    ...(docStore.extraFolders.flatMap((f) => extraOpen.value.has(f) ? (extraTrees.value.get(f) || []) : []))
  ]
  const out: DirEntry[] = []
  const walk = (list: DirEntry[]) => {
    for (const e of list) {
      out.push(e)
      if (e.isDirectory && e.children && (!onlyExpanded || expanded.value.has(e.path))) {
        walk(e.children)
      }
    }
  }
  walk(roots)
  return out
}

function findEntryAny(path: string): DirEntry | null {
  return (
    findEntryByPath(tree.value, path) ||
    findEntryByPath(flattenVisible(), path)
  )
}

function isSelected(path: string): boolean {
  return selectedPaths.value.size > 0
    ? selectedPaths.value.has(path)
    : selectedPath.value === path
}

function selectedEntries(): DirEntry[] {
  const out: DirEntry[] = []
  for (const p of selectedPaths.value) {
    const e = findEntryAny(p)
    if (e) out.push(e)
  }
  if (out.length === 0 && selectedPath.value) {
    const e = findEntryAny(selectedPath.value)
    if (e) out.push(e)
  }
  return out
}

/** 树区获得焦点（便于快捷键） */
function focusTree() {
  treeFocused.value = true
  treeScrollRef.value?.focus({ preventScroll: true })
}

function onTreeFocus() { treeFocused.value = true }
function onTreeBlur(e: FocusEvent) {
  const next = e.relatedTarget as HTMLElement | null
  if (next && treeScrollRef.value?.contains(next)) return
  // 重命名/新建输入中保持焦点逻辑由各自处理
  if ((next as HTMLElement | null)?.closest?.('.rename-input, .new-input-row')) return
  treeFocused.value = false
}

// ===== 快捷键 =====
function isEditableTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  if (!t) return false
  const tag = t.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable
}

async function onTreeKeydown(e: KeyboardEvent) {
  if (isEditableTarget(e)) return
  if (!docStore.projectRoot) return
  // 仅当焦点在文件树内（点击树行/点树空白），避免抢编辑器快捷键
  const active = document.activeElement
  const inTree =
    !!treeScrollRef.value &&
    (active === treeScrollRef.value || treeScrollRef.value.contains(active))
  if (!inTree) return

  const ctrl = e.ctrlKey || e.metaKey

  // Ctrl+A 全选
  if (ctrl && (e.key === 'a' || e.key === 'A')) {
    e.preventDefault()
    selectAll()
    return
  }

  // Delete / Backspace 删除
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault()
    await deleteSelected()
    return
  }

  // F2 重命名（仅单选）
  if (e.key === 'F2') {
    e.preventDefault()
    const entries = selectedEntries()
    if (entries.length === 1) startRename(entries[0])
    return
  }

  // Enter 打开（仅单选）
  if (e.key === 'Enter') {
    e.preventDefault()
    const entries = selectedEntries()
    if (entries.length === 1) {
      const e0 = entries[0]
      if (docStore.extraFolders.some((f) => e0.path.startsWith(f))) {
        void openExtraEntry(e0)
      } else {
        void openEntry(e0)
      }
    }
    return
  }

  // Ctrl+C 复制
  if (ctrl && (e.key === 'c' || e.key === 'C')) {
    e.preventDefault()
    copySelected(false)
    return
  }
  // Ctrl+X 剪切
  if (ctrl && (e.key === 'x' || e.key === 'X')) {
    e.preventDefault()
    copySelected(true)
    return
  }
  // Ctrl+V 粘贴
  if (ctrl && (e.key === 'v' || e.key === 'V')) {
    e.preventDefault()
    await pasteClipboard()
    return
  }
  // Ctrl+Shift+V 也可粘贴（部分输入法吞 Ctrl+V）
  if (ctrl && e.shiftKey && (e.key === 'v' || e.key === 'V' || e.code === 'KeyV')) {
    e.preventDefault()
    await pasteClipboard()
    return
  }

  // Esc 清除选择
  if (e.key === 'Escape') {
    setSingleSelect(null)
  }
}

function copySelected(cut: boolean) {
  const entries = selectedEntries()
  if (entries.length === 0) return
  clipboard.value = { paths: entries.map((e) => e.path), cut }
}

async function pasteClipboard() {
  const clip = clipboard.value
  if (!clip || clip.paths.length === 0) return

  // 目标目录：选中文件夹 → 该文件夹；选中文件 → 父目录；否则工作区根
  let destDir = docStore.projectRoot || ''
  const sel = selectedEntries()
  if (sel.length === 1 && sel[0].isDirectory) {
    destDir = sel[0].path
  } else if (sel.length >= 1) {
    destDir = parentDirOf(sel[0].path)
  }
  if (!destDir) {
    alert('请先打开工作区')
    return
  }

  let okCount = 0
  const movedTabMaps: Array<{ oldPath: string; newPath: string; isDir: boolean }> = []
  for (const src of clip.paths) {
    if (clip.cut) {
      if (parentDirOf(src) === destDir) continue
      const base = src.split(/[\\/]/).pop() || src
      const dest = destDir + (destDir.includes('\\') ? '\\' : '/') + base
      if (src === dest) continue
      // 检测是否为目录：先尝试看路径在树里
      const srcEntry = findEntryAny(src)
      const isDir = !!srcEntry?.isDirectory
      const moved = await window.electronAPI.renameFile(src, dest)
      if (moved) {
        okCount++
        movedTabMaps.push({ oldPath: src, newPath: dest, isDir })
      }
    } else {
      const newPath = await window.electronAPI.copyPathToDir(src, destDir)
      if (newPath) okCount++
    }
  }

  if (clip.cut) {
    // 剪切成功后映射标签路径（而非粗暴关闭），失败项保留
    for (const m of movedTabMaps) {
      remapOpenPaths(m.oldPath, m.newPath, m.isDir)
    }
    clipboard.value = null
    // 关闭因移动失效的 PDF（若路径未映射成功）
    for (const src of clip.paths) {
      if (!movedTabMaps.some((m) => m.oldPath === src) && /\.pdf$/i.test(src)) {
        compileStore.closePdfTabByPath(src)
      }
    }
  }

  await loadTree()
  for (const folder of docStore.extraFolders) {
    await loadExtraTree(folder)
  }
  if (okCount === 0 && !clip.cut) {
    alert('粘贴失败：目标目录不可写或源文件不存在')
  } else if (clip.cut && okCount === 0) {
    alert('剪切失败：可能跨卷权限问题，请改用复制')
  }
}

async function deleteSelected() {
  const entries = selectedEntries()
  if (entries.length === 0) return
  const names = entries.map((e) => e.name)
  const msg = entries.length === 1
    ? (entries[0].isDirectory
      ? `确定删除文件夹「${entries[0].name}」及其中所有文件？此操作不可撤销。`
      : `确定删除文件「${entries[0].name}」？`)
    : `确定删除选中的 ${entries.length} 项？\n\n${names.slice(0, 20).join('\n')}${names.length > 20 ? '\n…' : ''}\n\n此操作不可撤销。`
  if (!confirm(msg)) return

  let deleted = 0
  for (const entry of entries) {
    const ok = await window.electronAPI.deleteFile(entry.path)
    if (ok) {
      deleted++
      closePathRange(entry.path, entry.isDirectory)
      if (entry.isDirectory) {
        const mp = docStore.mainTexPath
        if (mp && isUnder(mp, entry.path)) docStore.mainTexPath = null
      }
    }
  }
  selectedPaths.value = new Set()
  selectedPath.value = null
  selectAnchor.value = null
  await loadTree()
  for (const folder of docStore.extraFolders) {
    if (folder.startsWith(docStore.projectRoot || '~~')) await loadExtraTree(folder)
  }
  if (deleted < entries.length) {
    alert(`已删除 ${deleted}/${entries.length} 项，其余可能无权限或被占用`)
  }
}

/** 树行点击：处理多选修饰键 + 打开 */
function onTreeItemClick(entry: DirEntry, event?: MouseEvent) {
  focusTree()
  const ctrl = !!(event && (event.ctrlKey || event.metaKey))
  const shift = !!(event && event.shiftKey)
  if (shift) {
    rangeSelect(entry.path)
  } else if (ctrl) {
    toggleSelect(entry.path)
    // Ctrl 点击：仅切换选中（与资源管理器一致）；文件夹仍切换展开
    if (entry.isDirectory) toggleDir(entry.path)
    return
  } else {
    setSingleSelect(entry.path)
  }
  const inExtra = docStore.extraFolders.some(
    (f) => entry.path === f || entry.path.startsWith(f + '\\') || entry.path.startsWith(f + '/')
  )
  if (inExtra) {
    void openExtraEntry(entry)
  } else {
    void openEntry(entry)
  }
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
  if (!selectedPaths.value.has(entry.path) || selectedPaths.value.size !== 1) {
    // 单击打开时由 onTreeItemClick 已设置；此处兜底
    if (selectedPaths.value.size === 0) setSingleSelect(entry.path)
  }
  if (/\.pdf$/i.test(entry.name)) {
    compileStore.openPdfTab(entry.path)
    return
  }
  if (/\.(tex|bib|sty|cls|md|txt|bbl|bst|dtx|ins|ltx|json|yaml|yml|toml|in|log|toc|aux|out)$/i.test(entry.name)) {
    await docStore.openFile(entry.path)
  }
}

function openExtraEntry(entry: DirEntry) {
  if (entry.isDirectory) {
    toggleDir(entry.path)
    return
  }
  selectedPath.value = entry.path
  if (/\.pdf$/i.test(entry.name)) {
    compileStore.openPdfTab(entry.path)
    return
  }
  if (/\.(tex|bib|sty|cls|md|txt|bbl|bst|dtx|ins|ltx|json|yaml|yml|toml|in|log|toc|aux|out)$/i.test(entry.name)) {
    void docStore.openFile(entry.path)
  }
}

/** 点击项目行：展开/折叠该项目的文件树；必要时加载 */
function toggleProject(path: string, isMain: boolean) {
  if (isMain) {
    workspaceOpen.value = !workspaceOpen.value
    return
  }
  if (extraOpen.value.has(path)) {
    extraOpen.value.delete(path)
  } else {
    extraOpen.value.add(path)
    void loadExtraTree(path)
  }
  extraOpen.value = new Set(extraOpen.value)
}

/** 把附加项目提升为主工作区（点击项目名旁星标或双击） */
function promoteToMain(path: string) {
  // 不分主次：保留函数兼容旧双击，改为与第一个项目互换显示位置
  const first = projectList.value[0]?.path
  if (first && first !== path) {
    docStore.swapProjects(first, path)
  }
}

function mainTexPathClear() {
  // openProjectFolder 已在切换时清空 mainTexPath
}

async function loadExtraTreeFrom(path: string) {
  await loadExtraTree(path)
  if (!extraOpen.value.has(path)) {
    extraOpen.value.add(path)
    extraOpen.value = new Set(extraOpen.value)
  }
}

function createParentDir(): string {
  // 若选中的是目录，则在该目录下新建；否则用工作区根
  const sel = selectedPath.value
  if (sel) {
    // 附加项目根
    if (docStore.extraFolders.includes(sel)) return sel
    const inExtra = docStore.extraFolders.find(
      (f) => sel.startsWith(f + '\\') || sel.startsWith(f + '/')
    )
    if (inExtra) {
      const entry =
        findEntryByPath(extraTrees.value.get(inExtra) || [], sel) ||
        findEntryByPath(tree.value, sel)
      if (entry?.isDirectory) return entry.path
      return parentDirOf(sel)
    }
    const entry = findEntryByPath(tree.value, sel)
    if (entry?.isDirectory) return entry.path
    return parentDirOf(sel) || docStore.projectRoot || ''
  }
  return docStore.projectRoot || ''
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
  for (const folder of docStore.extraFolders) {
    await loadExtraTree(folder)
  }
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
  const ok = await window.electronAPI.deleteFile(entry.path)
  if (!ok) {
    alert('删除失败：可能无权限或文件被占用')
    return
  }
  // 关闭路径落在删除范围内的标签 / PDF / 主文档
  closePathRange(entry.path, entry.isDirectory)
  if (entry.isDirectory) {
    // 主文档若在目录内则清空
    const mp = docStore.mainTexPath
    if (mp && (mp === entry.path || isUnder(mp, entry.path))) {
      docStore.mainTexPath = null
    }
  }
  await loadTree()
  for (const folder of docStore.extraFolders) {
    if (folder === entry.path || entry.path.startsWith(folder)) {
      await loadExtraTree(folder)
    }
  }
}

function isUnder(path: string, root: string): boolean {
  return path === root || path.startsWith(root + '\\') || path.startsWith(root + '/')
}

/** 关闭路径在 [root] 下（或等于 root）的标签与 PDF */
function closePathRange(root: string, isDir: boolean): void {
  const hit = (p: string | null): p is string => {
    if (!p) return false
    if (p === root) return true
    return isDir && isUnder(p, root)
  }
  for (const tab of [...docStore.tabs]) {
    if (!hit(tab.path)) continue
    const idx = docStore.tabs.findIndex((t) => t.id === tab.id)
    if (idx >= 0) {
      docStore.tabs.splice(idx, 1)
      if (docStore.activeTabId === tab.id) {
        docStore.activeTabId = docStore.tabs[Math.min(idx, docStore.tabs.length - 1)]?.id || null
      }
    }
  }
  if (isDir) {
    // 目录内 PDF 预览标签
    const pdfTabs = Array.isArray(compileStore.pdfTabs) ? compileStore.pdfTabs : []
    for (const t of pdfTabs) {
      if (t.path && hit(t.path)) {
        try { compileStore.closePdfTabByPath(t.path) } catch { /* ignore */ }
      }
    }
  } else if (/\.pdf$/i.test(root)) {
    compileStore.closePdfTabByPath(root)
  }
  if (hit(docStore.mainTexPath)) {
    docStore.mainTexPath = null
  }
}

/** 重命名/移动后：把旧路径（或前缀）映射到新路径上的标签与主文档 */
function remapOpenPaths(oldPath: string, newPath: string, isDir: boolean): void {
  const mapPath = (p: string | null): string | null => {
    if (!p) return null
    if (p === oldPath) return newPath
    if (isDir && isUnder(p, oldPath)) {
      return newPath + p.slice(oldPath.length)
    }
    return p
  }
  for (const tab of docStore.tabs) {
    const next = mapPath(tab.path)
    if (next && next !== tab.path) {
      tab.path = next
      tab.name = next.split(/[\\/]/).pop() || tab.name
    }
  }
  const mp = mapPath(docStore.mainTexPath)
  if (mp && mp !== docStore.mainTexPath) {
    docStore.mainTexPath = mp
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
  // 目录重命名：同步其下已打开标签 / 主文档路径
  remapOpenPaths(entry.path, newPath, entry.isDirectory)
  await loadTree()
  for (const folder of docStore.extraFolders) {
    await loadExtraTree(folder)
  }
}

function isMain(entry: DirEntry): boolean {
  return docStore.mainTexPath === entry.path
}

function iconFor(entry: DirEntry): string {
  if (entry.isDirectory) return '📁'
  const ext = entry.name.split('.').pop()?.toLowerCase() || ''
  const map: Record<string, string> = {
    tex: '📄', bib: '📚', sty: '⚙️', cls: '📦',
    png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', svg: '🖼️', webp: '🖼️',
    pdf: '📕', md: '📝', txt: '📃',
    json: '🔧', yaml: '🔧', yml: '🔧', toml: '🔧', in: '📃',
    log: '📜', aux: '📜', toc: '📜', out: '📜', bbl: '📚', bst: '📚'
  }
  return map[ext] || '📄'
}

/** 过滤：名称匹配 query 时显示；目录命中则显示整棵子树 */
function matchesFilter(entry: DirEntry): boolean {
  const q = filterQuery.value.trim().toLowerCase()
  if (!q) return true
  if (entry.name.toLowerCase().includes(q)) return true
  if (entry.isDirectory && entry.children) {
    return entry.children.some(matchesFilter)
  }
  return false
}

function filterEntries(list: DirEntry[]): DirEntry[] {
  if (!filterQuery.value.trim()) return list
  const out: DirEntry[] = []
  for (const e of list) {
    if (!matchesFilter(e)) continue
    if (e.isDirectory && e.children) {
      out.push({ ...e, children: filterEntries(e.children) })
    } else {
      out.push(e)
    }
  }
  return out
}

/** 有过滤时自动展开命中目录 */
watch(filterQuery, (q) => {
  if (!q.trim()) return
  const walk = (list: DirEntry[]) => {
    for (const e of list) {
      if (e.isDirectory && matchesFilter(e)) {
        expanded.value.add(e.path)
        if (e.children) walk(e.children)
      }
    }
  }
  walk(tree.value)
  for (const folder of docStore.extraFolders) {
    walk(extraTrees.value.get(folder) || [])
  }
  expanded.value = new Set(expanded.value)
  workspaceOpen.value = true
  for (const f of docStore.extraFolders) {
    if (!extraOpen.value.has(f)) {
      extraOpen.value.add(f)
    }
  }
  extraOpen.value = new Set(extraOpen.value)
})

const filteredTree = computed(() => filterEntries(tree.value))
const hasFilter = computed(() => !!filterQuery.value.trim())
const filterCount = computed(() => flattenVisible(filteredTree.value).length)

function pathSep(p: string) {
  return p.includes('\\') ? '\\' : '/'
}

/** 由任意路径反推所属工作区项目根 */
function resolveProjectForPath(path: string | null): string | null {
  if (!path) return null
  const roots: string[] = []
  if (docStore.projectRoot) roots.push(docStore.projectRoot)
  roots.push(...docStore.extraFolders)
  for (const root of roots) {
    if (!root) continue
    if (path === root) return root
    const rootN = root.replace(/[\\/]+$/, '')
    if (path.startsWith(rootN + pathSep(rootN)) || path.startsWith(rootN + '/') || path.startsWith(rootN + '\\')) {
      return root
    }
  }
  return null
}

// 右键菜单
function onContextMenu(e: MouseEvent) {
  e.preventDefault()
  window.dispatchEvent(new CustomEvent('close-all-menus'))
  itemCtx.value = { show: false, x: 0, y: 0, entry: null }
  // 点在项目节点上 → 该项目；否则用当前选中项所属项目 / 主项目
  const projEl = (e.target as HTMLElement | null)?.closest?.('[data-project-path]') as HTMLElement | null
  const fromNode = projEl?.dataset?.projectPath || null
  ctxTargetProject.value =
    fromNode ||
    resolveProjectForPath(selectedPath.value) ||
    resolveProjectForPath(Array.from(selectedPaths.value)[0] || null) ||
    docStore.projectRoot ||
    projectList.value[0]?.path ||
    null
  // 避免贴边溢出
  const menuW = 220
  const menuH = 200
  const x = Math.max(8, Math.min(e.clientX, window.innerWidth - menuW - 8))
  const y = Math.max(8, Math.min(e.clientY, window.innerHeight - menuH - 8))
  ctxMenu.value = { show: true, x, y }
}

function onItemContextMenu(payload: { entry: DirEntry; x: number; y: number }) {
  window.dispatchEvent(new CustomEvent('close-all-menus'))
  ctxMenu.value = { show: false, x: 0, y: 0 }
  // 右键：若不在多选内则改为单选该项
  if (!selectedPaths.value.has(payload.entry.path)) {
    setSingleSelect(payload.entry.path)
  } else {
    selectedPath.value = payload.entry.path
  }
  focusTree()
  // 避免菜单贴边溢出屏幕
  const menuW = 220
  const menuH = 280
  const x = Math.max(8, Math.min(payload.x, window.innerWidth - menuW - 8))
  const y = Math.max(8, Math.min(payload.y, window.innerHeight - menuH - 8))
  itemCtx.value = { show: true, x, y, entry: payload.entry }
}

function closeItemCtx() {
  itemCtx.value = { show: false, x: 0, y: 0, entry: null }
}

async function revealInExplorer(entry: DirEntry) {
  closeItemCtx()
  try {
    await window.electronAPI.showInExplorer(entry.path)
  } catch (err: any) {
    alert(`打开资源管理器失败：${err.message}`)
  }
}

function itemCtxAction(action: string) {
  const entry = itemCtx.value.entry
  if (!entry) return
  closeItemCtx()
  if (action === 'reveal') {
    void revealInExplorer(entry)
  } else if (action === 'open') {
    void openEntry(entry)
  } else if (action === 'delete') {
    void deleteEntry(entry)
  } else if (action === 'rename') {
    startRename(entry)
  } else if (action === 'set-main') {
    if (!entry.isDirectory && /\.tex$/i.test(entry.name)) {
      docStore.setMainTex(entry.path)
    }
  } else if (action === 'copy' || action === 'cut') {
    setSingleSelect(entry.path)
    copySelected(action === 'cut')
  } else if (action === 'paste') {
    setSingleSelect(entry.path)
    void pasteClipboard()
  } else if (action === 'new-file' || action === 'new-folder') {
    setSingleSelect(entry.path)
    if (action === 'new-file') void createNewFile()
    else void createNewFolder()
  }
}

function onSetMain(entry: DirEntry) {
  if (!entry.isDirectory && /\.tex$/i.test(entry.name)) {
    docStore.setMainTex(entry.path)
  }
}

function closeCtxMenu() {
  ctxMenu.value.show = false
}

/** 项目行右键：锁定目标项目路径，再走统一工作区菜单 */
function onProjectContextMenu(path: string, e: MouseEvent) {
  e.preventDefault()
  e.stopPropagation()
  ctxTargetProject.value = path
  onContextMenu(e)
  // onContextMenu 会重算目标，项目行右键以 path 为准
  ctxTargetProject.value = path
}

async function openFolderDialog() {
  const path = await window.electronAPI.openFolder()
  if (!path) return
  await docStore.openOrAddWorkspace(path)
}

function exitWorkspace() {
  if (!docStore.projectRoot) return
  const dirtyCount = docStore.tabs.filter((t) => t.isDirty).length
  const msg = dirtyCount > 0
    ? `退出当前工作区？\n\n已打开的 ${docStore.tabs.length} 个文件标签将全部关闭，其中 ${dirtyCount} 个有未保存更改（会丢失）。\n\n确定退出？`
    : `退出当前工作区？\n\n已打开的 ${docStore.tabs.length} 个文件标签将全部关闭。\n\n确定退出？`
  if (!confirm(msg)) return
  // 真正关闭所有标签与工作区状态
  docStore.tabs.splice(0, docStore.tabs.length)
  docStore.activeTabId = null
  docStore.mainTexPath = null
  docStore.projectRoot = null
  docStore.extraFolders = []
  docStore.projectOrder = []
  tree.value = []
  expanded.value.clear()
  extraTrees.value.clear()
  extraOpen.value.clear()
  selectedPath.value = null
  selectedPaths.value = new Set()
  selectAnchor.value = null
  clipboard.value = null
  workspaceOpen.value = false
  loadTree()
}

function ctxAction(action: string) {
  // 先取目标，再关菜单（close 可能重置状态）
  const targetDir = action === 'from-template' ? (ctxTargetProject.value || undefined) : undefined
  closeCtxMenu()
  requestAnimationFrame(() => {
    switch (action) {
      case 'new-file': createNewFile(); break
      case 'new-folder': createNewFolder(); break
      case 'add-folder': addFolderToWorkspace(); break
      case 'from-template':
        // 工作区内有目标项目 → 直接带路径打开模板库（不再弹选目录）
        emit('open-template-library', targetDir)
        ctxTargetProject.value = null
        break
      case 'remove-last-folder':
        if (docStore.extraFolders.length > 0) {
          removeFolderFromWorkspace(docStore.extraFolders[docStore.extraFolders.length - 1])
        }
        break
    }
    if (action !== 'from-template') ctxTargetProject.value = null
  })
}

function cancelNewInput() {
  showNewInput.value = false
  newFileName.value = ''
  newIsDir.value = false
}

function onGlobalClick(e: Event) {
  const target = e.target as HTMLElement
  if (!target.closest('.ctx-menu') && !target.closest('.item-ctx-menu')) {
    closeCtxMenu()
    closeItemCtx()
  }
  // 点到项目名以外则取消互换源
  if (!target.closest('.proj-name')) {
    swapSource.value = null
  }
  if (
    showNewInput.value &&
    !target.closest('.new-input-row') &&
    !target.closest('.ctx-menu') &&
    !target.closest('.item-ctx-menu') &&
    !target.closest('.ws-icon-btn') &&
    !target.closest('[data-new-input-trigger]')
  ) {
    cancelNewInput()
  }
}

function onCloseAllMenus() {
  closeCtxMenu()
  closeItemCtx()
  showNewInput.value = false
}

watch(
  () => docStore.projectRoot,
  () => {
    loadTree()
    expanded.value.clear()
    workspaceOpen.value = true
    projectsSectionOpen.value = true
    docStore.syncOrderFromStores()
  },
  { immediate: true }
)

// extra 列表变化时同步显示顺序
watch(
  () => [...docStore.extraFolders],
  () => {
    docStore.syncOrderFromStores()
  }
)

// 新附加项目出现时自动加载其树并展开
watch(
  () => [...docStore.extraFolders],
  async (folders) => {
    for (const f of folders) {
      if (!extraTrees.value.has(f)) {
        await loadExtraTree(f)
        extraOpen.value.add(f)
        extraOpen.value = new Set(extraOpen.value)
      }
    }
    // 移除已不在列表中的
    for (const key of [...extraTrees.value.keys()]) {
      if (!folders.includes(key)) {
        extraTrees.value.delete(key)
        extraOpen.value.delete(key)
      }
    }
    extraTrees.value = new Map(extraTrees.value)
    extraOpen.value = new Set(extraOpen.value)
  }
)

onMounted(() => {
  loadTree()
  document.addEventListener('click', onGlobalClick)
  window.addEventListener('refresh-file-tree', loadTree)
  window.addEventListener('close-all-menus', onCloseAllMenus)
  window.addEventListener('keydown', onTreeKeydown, true)
})

onUnmounted(() => {
  document.removeEventListener('click', onGlobalClick)
  window.removeEventListener('refresh-file-tree', loadTree)
  window.removeEventListener('close-all-menus', onCloseAllMenus)
  window.removeEventListener('keydown', onTreeKeydown, true)
})
</script>

<template>
  <div class="file-tree">
    <!-- 分组头：工作区（可整组折叠，MiMo 项目风格） -->
    <div class="tree-header section-header">
      <button
        class="section-toggle"
        type="button"
        :title="projectsSectionOpen ? '折叠工作区' : '展开工作区'"
        @click="toggleProjectsSection"
      >
        <span class="section-chevron" :class="{ open: projectsSectionOpen }" aria-hidden="true">▸</span>
        <span class="tree-title">工作区</span>
        <span v-if="projectList.length" class="section-count">{{ projectList.length }}</span>
      </button>
      <button
        class="ws-icon-btn"
        title="打开/新建项目"
        @click="openFolderDialog"
      >
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
          <line x1="7" y1="3" x2="7" y2="11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
          <line x1="3" y1="7" x2="11" y2="7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        </svg>
      </button>
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

    <div
      v-show="projectsSectionOpen"
      ref="treeScrollRef"
      class="tree-scroll"
      tabindex="0"
      @contextmenu="onContextMenu"
      @focus="onTreeFocus"
      @blur="onTreeBlur"
      @keydown="onTreeKeydown"
    >
      <!-- 名称过滤 -->
      <div class="tree-filter" data-new-input-trigger>
        <svg class="filter-icon" width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <circle cx="6" cy="6" r="4.5" stroke="currentColor" stroke-width="1.3"/>
          <line x1="9.5" y1="9.5" x2="12.5" y2="12.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
        </svg>
        <input
          v-model="filterQuery"
          class="filter-input"
          placeholder="筛选文件…"
          @keydown.esc.stop="filterQuery = ''"
          @keydown.stop
        />
        <span v-if="hasFilter" class="filter-count">{{ filterCount }}</span>
        <button
          v-if="hasFilter"
          class="filter-clear"
          title="清除筛选"
          @click="filterQuery = ''"
        >✕</button>
      </div>
      <!-- 多项目列表：不分主次，可拖动或点名称两次互换位置 -->
      <template v-for="proj in projectList" :key="proj.path">
        <div
          class="workspace-node project-node"
          :data-project-path="proj.path"
          :class="{
            active: proj.isMain,
            'swap-src': swapSource === proj.path,
            'dragging': dragPath === proj.path,
            'drop-over': dropTargetPath === proj.path && dragPath !== proj.path
          }"
        >
          <div
            class="workspace-row project-row"
            draggable="true"
            @click="toggleProject(proj.path, proj.isMain)"
            @contextmenu.stop="onProjectContextMenu(proj.path, $event)"
            @dragstart="onProjDragStart(proj.path, $event)"
            @dragover="onProjDragOver(proj.path, $event)"
            @dragleave="onProjDragLeave(proj.path)"
            @drop="onProjDrop(proj.path, $event)"
            @dragend="onProjDragEnd"
            :title="swapSource === proj.path ? '已选中：再点另一个项目即可互换位置' : '点击展开/折叠 · 拖动可与其它项目互换 · 点项目名亦可互换'"
          >
            <span
              class="ws-arrow"
              :class="{ open: proj.isMain ? workspaceOpen : extraOpen.has(proj.path) }"
            >▸</span>
            <span class="ws-icon">📂</span>
            <span
              class="ws-name truncate proj-name"
              :class="{ 'swap-target': swapSource && swapSource !== proj.path }"
              :title="swapSource ? '点击与「' + (projectList.find(p => p.path === swapSource)?.name || '') + '」互换位置' : proj.name"
              @click.stop="onProjectNameClick(proj.path)"
            >{{ proj.name }}</span>
            <span v-if="swapSource === proj.path" class="swap-hint">互换源</span>
            <span v-else-if="swapSource" class="swap-hint pick">点此互换</span>
            <div class="ws-actions" @click.stop>
              <button
                class="ws-icon-btn"
                title="新建文件"
                @click.stop="setMainForNew(proj.path); createNewFile()"
              >
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                  <path d="M8 1H3.5C2.67 1 2 1.67 2 2.5v9C2 12.33 2.67 13 3.5 13h7c.83 0 1.5-.67 1.5-1.5V5L8 1z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
                  <path d="M8 1v4h4" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
                </svg>
              </button>
              <button
                class="ws-icon-btn"
                title="新建文件夹"
                @click.stop="setMainForNew(proj.path); createNewFolder()"
              >
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                  <path d="M1.5 3.5C1.5 2.67 2.17 2 3 2h3l1.5 1.5H11c.83 0 1.5.67 1.5 1.5v6c0 .83-.67 1.5-1.5 1.5H3c-.83 0-1.5-.67-1.5-1.5v-7z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
                </svg>
              </button>
              <button class="ws-icon-btn" title="刷新" @click.stop="proj.isMain ? loadTree() : loadExtraTree(proj.path)">
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                  <path d="M12 7A5 5 0 1 1 7 2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
                  <polyline points="12,2 12,5.5 8.5,5.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
                </svg>
              </button>
              <button
                v-if="!proj.isMain"
                class="ws-icon-btn"
                title="从工作区移除"
                @click.stop="removeFolderFromWorkspace(proj.path)"
              >
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                  <line x1="3" y1="7" x2="11" y2="7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
                </svg>
              </button>
            </div>
          </div>

          <!-- 主项目：文件树 -->
          <div v-if="proj.isMain && workspaceOpen" class="workspace-children">
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
            <div
              v-if="hasFilter && filteredTree.length === 0"
              class="tree-empty filter-empty"
            >
              <p>无匹配「{{ filterQuery }}」</p>
            </div>
            <template v-for="entry in filteredTree" :key="entry.path">
              <TreeNode
                :entry="entry"
                :depth="1"
                :expanded-set="expanded"
                :selected-path="selectedPath"
                :selected-paths="selectedPaths"
                :renaming="renaming"
                :rename-value="renameValue"
                :is-main="isMain"
                :icon-for="iconFor"
                @toggle="toggleDir"
                @open="(e: DirEntry, ev?: MouseEvent) => onTreeItemClick(e, ev)"
                @delete="deleteEntry"
                @start-rename="startRename"
                @confirm-rename="confirmRename"
                @update-rename="(v: string) => (renameValue = v)"
                @set-main="onSetMain"
                @item-context="onItemContextMenu"
              />
            </template>
          </div>

          <!-- 附加项目：文件树 -->
          <div v-if="!proj.isMain && extraOpen.has(proj.path)" class="workspace-children">
            <template v-for="entry in filterEntries(extraTrees.get(proj.path) || [])" :key="entry.path">
              <TreeNode
                :entry="entry"
                :depth="1"
                :expanded-set="expanded"
                :selected-path="selectedPath"
                :selected-paths="selectedPaths"
                :renaming="renaming"
                :rename-value="renameValue"
                :is-main="isMain"
                :icon-for="iconFor"
                @toggle="toggleDir"
                @open="(e: DirEntry, ev?: MouseEvent) => onTreeItemClick(e, ev)"
                @delete="deleteEntry"
                @start-rename="startRename"
                @confirm-rename="confirmRename"
                @update-rename="(v: string) => (renameValue = v)"
                @set-main="onSetMain"
                @item-context="onItemContextMenu"
              />
            </template>
          </div>
        </div>
      </template>

      <!-- 未打开工作区 -->
      <div v-if="projectList.length === 0" class="tree-empty">
        <div class="empty-icon">📁</div>
        <p>未打开项目</p>
        <button class="open-folder-btn" @click="openFolderDialog">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M1.5 3.5C1.5 2.67 2.17 2 3 2h3l1.5 1.5H11c.83 0 1.5.67 1.5 1.5v6c0 .83-.67 1.5-1.5 1.5H3c-.83 0-1.5-.67-1.5-1.5v-7z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
          </svg>
          打开项目
        </button>
        <small>可同时打开多个项目，分别折叠</small>
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
        <button class="ctx-item" @click="ctxAction('from-template')">
          <span class="ctx-icon">📋</span> 从模板导入到{{ ctxTargetProject ? folderName(ctxTargetProject) : '项目' }}…
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

    <!-- 文件/文件夹右键菜单 -->
    <Teleport to="body">
      <div
        v-if="itemCtx.show && itemCtx.entry"
        class="ctx-menu item-ctx-menu"
        :style="{ left: itemCtx.x + 'px', top: itemCtx.y + 'px' }"
        @click.stop
      >
        <button class="ctx-item" @click="itemCtxAction('open')">
          <span class="ctx-icon">📂</span> {{ itemCtx.entry.isDirectory ? '打开文件夹' : '打开文件' }}
        </button>
        <button
          v-if="!itemCtx.entry.isDirectory && /\.tex$/i.test(itemCtx.entry.name)"
          class="ctx-item"
          @click="itemCtxAction('set-main')"
        >
          <span class="ctx-icon">★</span> 设为编译主文档
        </button>
        <button class="ctx-item" @click="itemCtxAction('reveal')">
          <span class="ctx-icon">🗂</span> 在文件资源管理器中打开
        </button>
        <div class="ctx-divider"></div>
        <button
          v-if="itemCtx.entry.isDirectory"
          class="ctx-item"
          @click="itemCtxAction('new-file')"
        >
          <span class="ctx-icon">📄</span> 新建文件…
        </button>
        <button
          v-if="itemCtx.entry.isDirectory"
          class="ctx-item"
          @click="itemCtxAction('new-folder')"
        >
          <span class="ctx-icon">📁</span> 新建文件夹…
        </button>
        <button class="ctx-item" @click="itemCtxAction('copy')">
          <span class="ctx-icon">📋</span> 复制
          <span class="ctx-key">Ctrl+C</span>
        </button>
        <button class="ctx-item" @click="itemCtxAction('cut')">
          <span class="ctx-icon">✂️</span> 剪切
          <span class="ctx-key">Ctrl+X</span>
        </button>
        <button
          class="ctx-item"
          :disabled="!clipboard"
          :class="{ dim: !clipboard }"
          @click="itemCtxAction('paste')"
        >
          <span class="ctx-icon">📌</span> 粘贴到此处
          <span class="ctx-key">Ctrl+V</span>
        </button>
        <div class="ctx-divider"></div>
        <button class="ctx-item" @click="itemCtxAction('rename')">
          <span class="ctx-icon">✎</span> 重命名
          <span class="ctx-key">F2</span>
        </button>
        <button class="ctx-item danger" @click="itemCtxAction('delete')">
          <span class="ctx-icon">🗑</span> 删除
          <span class="ctx-key">Del</span>
        </button>
      </div>
    </Teleport>

    <!-- 大纲面板 -->
    <div class="outline-section">
      <button class="outline-toggle" @click="showOutline = !showOutline">
        <span class="outline-arrow" :class="{ open: showOutline }" aria-hidden="true">▸</span>
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
  padding: 6px 8px 6px 8px;
  flex-shrink: 0;
  position: relative;
  gap: 4px;
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
.section-header {
  gap: 2px;
}
.section-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
  padding: 5px 6px;
  border: none;
  background: transparent;
  border-radius: 5px;
  cursor: pointer;
  color: var(--sidebar-strong);
  text-align: left;
}
.section-toggle:hover {
  background: var(--bg-hover);
  color: var(--sidebar-strong);
}
/* 三处三角统一规格：▸ / 9px / 400 / 12px（工作区分组 · 项目行 · 大纲） */
.section-chevron {
  display: inline-block;
  font-size: 9px;
  font-weight: 400;
  line-height: 1;
  width: 12px;
  text-align: center;
  flex-shrink: 0;
  transition: transform 0.15s;
  transform: rotate(0deg);
  opacity: 1;
  color: var(--text-secondary);
}
.section-chevron.open {
  transform: rotate(90deg);
}
.section-count {
  font-size: 10px;
  color: var(--text-tertiary);
  background: var(--bg-tertiary);
  border-radius: 8px;
  padding: 0 6px;
  line-height: 14px;
}
.tree-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--sidebar-strong);
  letter-spacing: 0.04em;
}
/* 项目行（MiMo 风）：不分主次 */
.project-node.active > .project-row {
  background: transparent;
}
.project-row {
  margin: 2px 6px;
  border-radius: 6px;
  min-height: 30px;
}
.project-row:hover {
  background: var(--bg-hover);
}
.proj-name {
  cursor: pointer;
  border-radius: 4px;
  padding: 1px 4px;
  margin: -1px -4px;
}
.proj-name.swap-target:hover {
  background: var(--accent-light);
  color: var(--accent);
}
.project-node.swap-src > .project-row {
  outline: 1px dashed var(--accent);
  outline-offset: -1px;
  background: var(--accent-light);
}
.project-node.dragging > .project-row {
  opacity: 0.45;
}
.project-node.drop-over > .project-row {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
  background: var(--accent-light);
}
.swap-hint {
  font-size: 10px;
  color: var(--accent);
  flex-shrink: 0;
  padding: 0 4px;
  white-space: nowrap;
}
.swap-hint.pick {
  color: var(--text-tertiary);
}
.main-badge {
  font-size: 11px;
  color: var(--accent);
  flex-shrink: 0;
  margin-right: 2px;
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
  outline: none;
}
.tree-scroll:focus-visible {
  box-shadow: inset 0 0 0 1px var(--accent-light);
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
  color: var(--sidebar-strong);
  font-size: 12px;
  font-weight: 600;
}
.workspace-row:hover {
  background: var(--bg-hover);
}
/* 与 section-chevron / outline-arrow 一致 */
.ws-arrow {
  display: inline-block;
  font-size: 9px;
  font-weight: 400;
  line-height: 1;
  color: var(--text-secondary);
  transition: transform 0.15s;
  flex-shrink: 0;
  width: 12px;
  text-align: center;
  transform: rotate(0deg);
}
.ws-arrow.open {
  transform: rotate(90deg);
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
.tree-filter {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 6px 8px 4px;
  padding: 3px 8px;
  background: var(--bg-tertiary, var(--bg-secondary));
  border: 1px solid var(--border);
  border-radius: 6px;
}
.tree-filter:focus-within {
  border-color: var(--accent);
}
.filter-icon {
  flex-shrink: 0;
  color: var(--text-tertiary);
}
.filter-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 12px;
  padding: 2px 0;
}
.filter-input::placeholder {
  color: var(--text-tertiary);
}
.filter-count {
  font-size: 10px;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}
.filter-clear {
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 11px;
  cursor: pointer;
  padding: 0 2px;
  border-radius: 3px;
}
.filter-clear:hover {
  color: var(--error);
  background: var(--error-bg);
}
.filter-empty {
  padding: 16px 8px;
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
  background: rgba(30, 30, 46, 0.8);
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
  background: rgba(255, 255, 255, 0.8);
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
.ctx-item.danger {
  color: var(--error);
}
.ctx-item.danger:hover {
  background: var(--error-bg);
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
.ctx-item:disabled,
.ctx-item.dim {
  opacity: 0.4;
  cursor: not-allowed;
}
.ctx-key {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-tertiary);
  font-family: var(--font-mono);
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
  color: var(--sidebar-strong);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  flex-shrink: 0;
  text-align: left;
}
.outline-toggle:hover {
  background: var(--bg-hover);
  color: var(--sidebar-strong);
}
/* 与 section-chevron / ws-arrow 完全一致：▸ / 9px / 400 / 12px */
.outline-arrow {
  display: inline-block;
  font-size: 9px;
  font-weight: 400;
  line-height: 1;
  width: 12px;
  text-align: center;
  flex-shrink: 0;
  transition: transform 0.15s;
  transform: rotate(0deg);
  color: inherit;
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
