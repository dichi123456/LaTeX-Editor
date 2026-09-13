import { ipcRenderer, contextBridge } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { DirEntry } from './file'
import type { CompileOptions, CompileResult } from './compiler'
import type { AppConfig } from './config'

// 自定义 API
const api = {
  // 文件
  openFile: (): Promise<string | null> => ipcRenderer.invoke('open-file-dialog'),
  openFolder: (): Promise<string | null> => ipcRenderer.invoke('open-folder-dialog'),
  readFile: (filePath: string): Promise<{ content: string; encoding: string }> =>
    ipcRenderer.invoke('read-file', filePath),
  readPdf: (filePath: string): Promise<string | null> =>
    ipcRenderer.invoke('read-pdf', filePath),
  writeFile: (filePath: string, content: string): Promise<boolean> =>
    ipcRenderer.invoke('write-file', filePath, content),
  listDir: (dirPath: string): Promise<DirEntry[]> => ipcRenderer.invoke('list-dir', dirPath),
  createFile: (dirPath: string, fileName: string): Promise<string | null> =>
    ipcRenderer.invoke('create-file', dirPath, fileName),
  createDir: (dirPath: string, dirName: string): Promise<string | null> =>
    ipcRenderer.invoke('create-dir', dirPath, dirName),
  deleteFile: (filePath: string): Promise<boolean> => ipcRenderer.invoke('delete-file', filePath),
  renameFile: (oldPath: string, newPath: string): Promise<boolean> =>
    ipcRenderer.invoke('rename-file', oldPath, newPath),
  getFileStats: (filePath: string): Promise<{ size: number; mtime: number } | null> =>
    ipcRenderer.invoke('file-stats', filePath),
  getRecentFiles: (): Promise<string[]> => ipcRenderer.invoke('get-recent-files'),
  addRecentFile: (filePath: string): Promise<void> =>
    ipcRenderer.invoke('add-recent-file', filePath),
  getRecentWorkspaces: (): Promise<string[]> => ipcRenderer.invoke('get-recent-workspaces'),
  addRecentWorkspace: (wsPath: string): Promise<void> =>
    ipcRenderer.invoke('add-recent-workspace', wsPath),
  getTemplateDir: (): Promise<string> => ipcRenderer.invoke('get-template-dir'),

  // 编译
  detectTexLive: (): Promise<{ found: boolean; path: string | null; engine: string | null }> =>
    ipcRenderer.invoke('detect-texlive'),
  compile: (options: CompileOptions): Promise<CompileResult> =>
    ipcRenderer.invoke('compile', options),
  cancelCompile: (): Promise<boolean> => ipcRenderer.invoke('cancel-compile'),
  isCompiling: (): Promise<boolean> => ipcRenderer.invoke('is-compiling'),
  cleanAuxFiles: (mainPath: string): Promise<string[]> => ipcRenderer.invoke('clean-aux', mainPath),
  runBibtex: (mainPath: string, texlivePath: string | null): Promise<{ success: boolean; log: string }> =>
    ipcRenderer.invoke('run-bibtex', mainPath, texlivePath),
  synctexForward: (texPath: string, line: number, pdfPath: string, texlivePath: string | null): Promise<{
    success: boolean
    page: number | null
    x: number | null
    y: number | null
    error?: string
  }> => ipcRenderer.invoke('synctex-forward', texPath, line, pdfPath, texlivePath),
  synctexBackward: (page: number, x: number, y: number, pdfPath: string, texlivePath: string | null): Promise<{
    success: boolean
    line: number | null
    file: string | null
    error?: string
  }> => ipcRenderer.invoke('synctex-backward', page, x, y, pdfPath, texlivePath),

  // 配置
  loadConfig: (): Promise<AppConfig> => ipcRenderer.invoke('load-config'),
  saveConfig: (config: AppConfig): Promise<boolean> => ipcRenderer.invoke('save-config', config),

  // 系统
  chooseDirectory: (): Promise<string | null> => ipcRenderer.invoke('choose-directory'),
  saveAs: (defaultName: string): Promise<string | null> =>
    ipcRenderer.invoke('save-as-dialog', defaultName),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('open-external', url),
  openPdfExternal: (pdfPath: string): Promise<void> =>
    ipcRenderer.invoke('open-pdf-external', pdfPath),
  exportPdf: (srcPath: string): Promise<string | null> =>
    ipcRenderer.invoke('export-pdf-dialog', srcPath),
  showNotification: (title: string, body: string): Promise<void> =>
    ipcRenderer.invoke('show-notification', title, body),
  setTitle: (title: string): Promise<void> => ipcRenderer.invoke('set-title', title),
  checkUpdate: (): Promise<{ success: boolean; current: string; latest?: string; hasUpdate?: boolean; url?: string; downloadUrl?: string | null; error?: string }> =>
    ipcRenderer.invoke('check-update'),
  downloadUpdate: (url: string): Promise<{ success: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('download-update', url),
  showAbout: (): Promise<void> => ipcRenderer.invoke('show-about'),
  notifyCompileDone: (success: boolean): Promise<void> =>
    ipcRenderer.invoke('notify-compile-done', success),

  // 窗口控制
  windowMinimize: (): Promise<void> => ipcRenderer.invoke('window-minimize'),
  windowMaximize: (): Promise<void> => ipcRenderer.invoke('window-maximize'),
  windowClose: (): Promise<void> => ipcRenderer.invoke('window-close'),
  windowToggleMaximize: (): Promise<boolean> => ipcRenderer.invoke('window-toggle-maximize'),
  windowIsMaximized: (): Promise<boolean> => ipcRenderer.invoke('window-is-maximized'),

  // AI 助手
  aiFetchModels: (options: { apiBase: string; apiKey: string }): Promise<{ success: boolean; error?: string; models: Array<{ id: string; name: string; owned_by: string }> }> =>
    ipcRenderer.invoke('ai-fetch-models', options),
  aiCancel: (): Promise<boolean> => ipcRenderer.invoke('ai-cancel'),
  aiChat: (options: {
    apiKey: string
    apiBase: string
    model: string
    messages: Array<{ role: string; content: string }>
    temperature?: number
    workspaceRoot?: string | null
    texlivePath?: string | null
    enableTools?: boolean
  }): Promise<{ success: boolean; content?: string; error?: string; reasoning?: string }> =>
    ipcRenderer.invoke('ai-chat', options),
  onAiStream: (cb: (data: { type: string; text?: string; toolName?: string; args?: string; result?: string; success?: boolean }) => void): (() => void) => {
    const handler = (_e: unknown, data: any): void => cb(data)
    ipcRenderer.on('ai-stream', handler)
    return () => ipcRenderer.removeListener('ai-stream', handler)
  },
  onFileChanged: (cb: (data: { path: string }) => void): (() => void) => {
    const handler = (_e: unknown, data: { path: string }): void => cb(data)
    ipcRenderer.on('file-changed', handler)
    return () => ipcRenderer.removeListener('file-changed', handler)
  },

  // 事件
  onCompileProgress: (cb: (data: { message: string; type: string }) => void): (() => void) => {
    const handler = (_e: unknown, data: { message: string; type: string }): void => cb(data)
    ipcRenderer.on('compile-progress', handler)
    return () => ipcRenderer.removeListener('compile-progress', handler)
  },
  onFileOpened: (cb: (filePath: string) => void): (() => void) => {
    const handler = (_e: unknown, filePath: string): void => cb(filePath)
    ipcRenderer.on('file-opened', handler)
    return () => ipcRenderer.removeListener('file-opened', handler)
  },
  onMenuAction: (cb: (action: string) => void): (() => void) => {
    const handler = (_e: unknown, action: string): void => cb(action)
    ipcRenderer.on('menu-action', handler)
    return () => ipcRenderer.removeListener('menu-action', handler)
  }
}

// 使用 contextBridge 安全暴露
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electronAPI', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electronAPI = api
}
