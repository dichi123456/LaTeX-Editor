import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Ref } from 'vue'

export interface OpenTab {
  id: string
  path: string | null // null 表示未保存的新文件
  name: string
  content: string
  originalContent: string
  encoding: string
  isDirty: boolean
}

export const useDocStore = defineStore('doc', () => {
  const tabs: Ref<OpenTab[]> = ref([])
  const activeTabId: Ref<string | null> = ref(null)
  const projectRoot: Ref<string | null> = ref(null)
  const extraFolders: Ref<string[]> = ref([])
  /** 侧栏项目显示顺序（路径列表；与 projectRoot/extraFolders 同步） */
  const projectOrder: Ref<string[]> = ref([])
  const mainTexPath: Ref<string | null> = ref(null)
  const recentFiles: Ref<string[]> = ref([])
  const recentWorkspaces: Ref<string[]> = ref([])
  // 状态栏光标位置（1-based）
  const cursorLine: Ref<number> = ref(1)
  const cursorCol: Ref<number> = ref(1)

  const activeTab = computed(() =>
    tabs.value.find((t) => t.id === activeTabId.value) || null
  )

  const hasDirty = computed(() => tabs.value.some((t) => t.isDirty))

  function newTab(name = '未命名.tex', content = ''): OpenTab {
    const tab: OpenTab = {
      id: `tab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      path: null,
      name,
      content,
      originalContent: content,
      encoding: 'utf-8',
      isDirty: false
    }
    tabs.value.push(tab)
    activeTabId.value = tab.id
    return tab
  }

  async function openFile(filePath: string): Promise<OpenTab> {
    // 已打开则激活
    const existing = tabs.value.find((t) => t.path === filePath)
    if (existing) {
      activeTabId.value = existing.id
      return existing
    }

    const { content, encoding } = await window.electronAPI.readFile(filePath)
    const name = filePath.split(/[\\/]/).pop() || filePath
    const tab: OpenTab = {
      id: `tab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      path: filePath,
      name,
      content,
      originalContent: content,
      encoding,
      isDirty: false
    }
    tabs.value.push(tab)
    activeTabId.value = tab.id
    await window.electronAPI.addRecentFile(filePath)
    loadRecent()

    // 如果是项目中第一个 .tex，设为主文档
    if (!mainTexPath.value && /\.tex$/i.test(filePath)) {
      mainTexPath.value = filePath
    }

    return tab
  }

  function closeTab(id: string): void {
    const idx = tabs.value.findIndex((t) => t.id === id)
    if (idx === -1) return
    tabs.value.splice(idx, 1)
    if (activeTabId.value === id) {
      if (tabs.value.length > 0) {
        const next = tabs.value[Math.min(idx, tabs.value.length - 1)]
        activeTabId.value = next.id
      } else {
        activeTabId.value = null
      }
    }
  }

  function moveTab(fromId: string, toId: string): void {
    const fromIdx = tabs.value.findIndex((t) => t.id === fromId)
    const toIdx = tabs.value.findIndex((t) => t.id === toId)
    if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return
    const [item] = tabs.value.splice(fromIdx, 1)
    tabs.value.splice(toIdx, 0, item)
  }

  async function saveTab(id?: string): Promise<boolean> {
    const tab = tabs.value.find((t) => t.id === (id || activeTabId.value))
    if (!tab) return false

    if (!tab.path) {
      // 未保存文件，触发另存为
      return false
    }

    const ok = await window.electronAPI.writeFile(tab.path, tab.content)
    if (ok) {
      tab.originalContent = tab.content
      tab.isDirty = false
      await window.electronAPI.addRecentFile(tab.path)
    }
    return ok
  }

  async function saveTabAs(id: string | undefined, newPath: string): Promise<boolean> {
    const tab = tabs.value.find((t) => t.id === (id || activeTabId.value))
    if (!tab) return false

    const ok = await window.electronAPI.writeFile(newPath, tab.content)
    if (ok) {
      tab.path = newPath
      tab.name = newPath.split(/[\\/]/).pop() || newPath
      tab.originalContent = tab.content
      tab.isDirty = false
      await window.electronAPI.addRecentFile(newPath)
      if (/\.tex$/i.test(newPath) && !mainTexPath.value) {
        mainTexPath.value = newPath
      }
    }
    return ok
  }

  function updateContent(id: string, content: string): void {
    const tab = tabs.value.find((t) => t.id === id)
    if (tab) {
      tab.content = content
      tab.isDirty = content !== tab.originalContent
    }
  }

  function setMainTex(path: string): void {
    mainTexPath.value = path
  }

  async function loadRecent(): Promise<void> {
    recentFiles.value = await window.electronAPI.getRecentFiles()
    recentWorkspaces.value = await window.electronAPI.getRecentWorkspaces()
  }

  async function openProjectFolder(folderPath: string): Promise<void> {
    const prev = projectRoot.value
    projectRoot.value = folderPath
    await window.electronAPI.addRecentWorkspace(folderPath)
    recentWorkspaces.value = await window.electronAPI.getRecentWorkspaces()
    syncOrderFromStores()
    if (!projectOrder.value.includes(folderPath)) {
      projectOrder.value = [...projectOrder.value, folderPath]
    }
    // 切换到不同工作区时清空主文档指针，避免编译指向旧项目
    if (prev && prev !== folderPath) {
      mainTexPath.value = null
    }
  }

  /**
   * 打开工作区：无主工作区则设为主；已有主工作区且 path 不同则**追加**到列表下方，不替换。
   * 返回 'opened' | 'added' | 'exists'
   */
  async function openOrAddWorkspace(folderPath: string): Promise<'opened' | 'added' | 'exists'> {
    if (projectRoot.value === folderPath || extraFolders.value.includes(folderPath)) {
      await window.electronAPI.addRecentWorkspace(folderPath)
      recentWorkspaces.value = await window.electronAPI.getRecentWorkspaces()
      return 'exists'
    }
    await window.electronAPI.addRecentWorkspace(folderPath)
    recentWorkspaces.value = await window.electronAPI.getRecentWorkspaces()
    syncOrderFromStores()
    if (!projectRoot.value) {
      projectRoot.value = folderPath
      projectOrder.value = [...projectOrder.value, folderPath]
      return 'opened'
    }
    // 已有 A：B 追加在 A 下方（extraFolders 顺序即侧栏顺序）
    extraFolders.value = [...extraFolders.value, folderPath]
    projectOrder.value = [...projectOrder.value.filter((p) => p !== folderPath), folderPath]
    return 'added'
  }

  function addExtraFolder(path: string): void {
    if (!extraFolders.value.includes(path)) {
      extraFolders.value.push(path)
      if (!projectOrder.value.includes(path)) {
        projectOrder.value = [...projectOrder.value, path]
      }
    }
  }

  function removeExtraFolder(path: string): void {
    extraFolders.value = extraFolders.value.filter((p) => p !== path)
    projectOrder.value = projectOrder.value.filter((p) => p !== path)
  }

  /** 同步显示顺序与 store 中的 root/extra（内部一致性） */
  function syncOrderFromStores(): void {
    const known = new Set<string>()
    if (projectRoot.value) known.add(projectRoot.value)
    for (const f of extraFolders.value) known.add(f)
    const kept = projectOrder.value.filter((p) => known.has(p))
    const missing: string[] = []
    if (projectRoot.value && !kept.includes(projectRoot.value)) missing.push(projectRoot.value)
    for (const f of extraFolders.value) {
      if (!kept.includes(f)) missing.push(f)
    }
    projectOrder.value = [...kept, ...missing]
  }

  /**
   * 互换两个项目在侧栏中的显示位置。
   * 不分主次：只交换 projectOrder 中的位置；projectRoot 编译根角色不变。
   */
  function swapProjects(pathA: string, pathB: string): void {
    if (!pathA || !pathB || pathA === pathB) return
    syncOrderFromStores()
    const order = [...projectOrder.value]
    const i = order.indexOf(pathA)
    const j = order.indexOf(pathB)
    if (i < 0 || j < 0) return

    // 先记录原 extras 集合
    const origExtras = new Set(extraFolders.value)
    const root = projectRoot.value
    // 若有一方是 root，另一方必须在 extras 中（否则先补上）
    if (root === pathA && pathB !== root && !origExtras.has(pathB)) origExtras.add(pathB)
    if (root === pathB && pathA !== root && !origExtras.has(pathA)) origExtras.add(pathA)

    const tmp = order[i]
    order[i] = order[j]
    order[j] = tmp
    projectOrder.value = order

    // extras 内容集合不变（仍排除 root），仅按新 order 排序
    extraFolders.value = order.filter((p) => p !== root && origExtras.has(p))
    // order 里有但不在 extras 的非 root（异常）补回
    for (const p of order) {
      if (p !== root && !extraFolders.value.includes(p) && origExtras.has(p)) {
        extraFolders.value.push(p)
      }
    }
  }

  return {
    tabs,
    activeTabId,
    activeTab,
    projectRoot,
    extraFolders,
    projectOrder,
    mainTexPath,
    recentFiles,
    recentWorkspaces,
    hasDirty,
    cursorLine,
    cursorCol,
    newTab,
    openFile,
    closeTab,
    moveTab,
    saveTab,
    saveTabAs,
    updateContent,
    setMainTex,
    loadRecent,
    addExtraFolder,
    removeExtraFolder,
    openProjectFolder,
    openOrAddWorkspace,
    swapProjects,
    syncOrderFromStores
  }
})
