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
  const mainTexPath: Ref<string | null> = ref(null)
  const recentFiles: Ref<string[]> = ref([])
  const recentWorkspaces: Ref<string[]> = ref([])

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
    projectRoot.value = folderPath
    await window.electronAPI.addRecentWorkspace(folderPath)
    recentWorkspaces.value = await window.electronAPI.getRecentWorkspaces()
  }

  function addExtraFolder(path: string): void {
    if (!extraFolders.value.includes(path)) {
      extraFolders.value.push(path)
    }
  }

  function removeExtraFolder(path: string): void {
    extraFolders.value = extraFolders.value.filter((p) => p !== path)
  }

  return {
    tabs,
    activeTabId,
    activeTab,
    projectRoot,
    extraFolders,
    mainTexPath,
    recentFiles,
    recentWorkspaces,
    hasDirty,
    newTab,
    openFile,
    closeTab,
    saveTab,
    saveTabAs,
    updateContent,
    setMainTex,
    loadRecent,
    addExtraFolder,
    removeExtraFolder,
    openProjectFolder
  }
})
