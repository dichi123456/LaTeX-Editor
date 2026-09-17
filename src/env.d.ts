/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

declare module '*.svg' {
  const src: string
  export default src
}

interface Window {
  electronAPI: {
    // 文件
    openFile: () => Promise<string | null>
    openFolder: () => Promise<string | null>
    readFile: (filePath: string) => Promise<{ content: string; encoding: string }>
    writeFile: (filePath: string, content: string) => Promise<boolean>
    writeBinaryFile: (filePath: string, base64: string) => Promise<boolean>
    readPdf: (filePath: string) => Promise<string | null>
    listDir: (dirPath: string) => Promise<DirEntry[]>
    createFile: (dirPath: string, fileName: string) => Promise<string | null>
    createDir: (dirPath: string, dirName: string) => Promise<string | null>
    deleteFile: (filePath: string) => Promise<boolean>
    renameFile: (oldPath: string, newPath: string) => Promise<boolean>
    getFileStats: (filePath: string) => Promise<{ size: number; mtime: number } | null>
    getRecentFiles: () => Promise<string[]>
    addRecentFile: (filePath: string) => Promise<void>
    getRecentWorkspaces: () => Promise<string[]>
    addRecentWorkspace: (wsPath: string) => Promise<void>
    getTemplateDir: () => Promise<string>

    // 编译
    detectTexLive: () => Promise<{ found: boolean; path: string | null; engine: string | null }>
    compile: (options: CompileOptions) => Promise<CompileResult>
    cancelCompile: () => Promise<boolean>
    isCompiling: () => Promise<boolean>
    cleanAuxFiles: (mainPath: string) => Promise<string[]>
    runBibtex: (mainPath: string, texlivePath: string | null) => Promise<{ success: boolean; log: string }>
    synctexForward: (texPath: string, line: number, pdfPath: string, texlivePath: string | null) => Promise<{
      success: boolean
      page: number | null
      x: number | null
      y: number | null
      error?: string
    }>
    synctexBackward: (page: number, x: number, y: number, pdfPath: string, texlivePath: string | null) => Promise<{
      success: boolean
      line: number | null
      file: string | null
      error?: string
    }>

    // 配置
    loadConfig: () => Promise<AppConfig>
    saveConfig: (config: AppConfig) => Promise<boolean>

    // 对话框 / 系统
    chooseDirectory: (options?: { title?: string; defaultPath?: string }) => Promise<string | null>
    saveAs: (defaultName: string) => Promise<string | null>
    openExternal: (url: string) => Promise<void>
    openPdfExternal: (pdfPath: string) => Promise<void>
    showInExplorer: (targetPath: string) => Promise<boolean>
    openTexLiveGuide: () => Promise<boolean>
    exportPdf: (srcPath: string) => Promise<string | null>
    showNotification: (title: string, body: string) => Promise<void>
    setTitle: (title: string) => Promise<void>
    checkUpdate: () => Promise<{ success: boolean; current: string; latest?: string; hasUpdate?: boolean; url?: string; downloadUrl?: string | null; error?: string }>
    downloadUpdate: (url: string) => Promise<{ success: boolean; path?: string; error?: string }>
    showAbout: () => Promise<void>
    windowMinimize: () => Promise<void>
    windowMaximize: () => Promise<void>
    windowClose: () => Promise<void>
    windowToggleMaximize: () => Promise<boolean>
    windowIsMaximized: () => Promise<boolean>
    aiFetchModels: (options: { apiBase: string; apiKey: string }) => Promise<{ success: boolean; error?: string; models: Array<{ id: string; name: string; owned_by: string }> }>
    aiCancel: () => Promise<boolean>
    aiChat: (options: {
      apiKey: string
      apiBase: string
      model: string
      messages: Array<{ role: string; content: string }>
      temperature?: number
      workspaceRoot?: string | null
      texlivePath?: string | null
      enableTools?: boolean
      permissionMode?: string
    }) => Promise<{ success: boolean; content?: string; error?: string; reasoning?: string }>
    onAiStream: (cb: (data: { type: string; text?: string; toolName?: string; args?: string; result?: string; success?: boolean }) => void) => () => void
    onFileChanged: (cb: (data: { path: string }) => void) => () => void
    notifyCompileDone: (success: boolean) => Promise<void>

    // 事件
    onCompileProgress: (cb: (data: { message: string; type: string }) => void) => () => void
    onFileOpened: (cb: (filePath: string) => void) => () => void
    onMenuAction: (cb: (action: string) => void) => () => void
  }
}

interface DirEntry {
  name: string
  path: string
  isDirectory: boolean
  children?: DirEntry[]
}

interface CompileOptions {
  filePath: string
  engine: string
  extraArgs?: string[]
  timeout?: number
  texlivePath?: string | null
}

interface CompileResult {
  success: boolean
  pdfPath: string | null
  logPath: string | null
  log: string
  errors: CompileIssue[]
  warnings: CompileIssue[]
  duration: number
}

interface CompileIssue {
  type: 'error' | 'warning'
  message: string
  line: number | null
  file: string | null
}

interface AppConfig {
  engine: string
  extraArgs: string
  timeout: number
  autoSave: boolean
  autoSaveInterval: number
  autoCompile: boolean
  theme: 'light' | 'dark' | 'system'
  texlivePath: string
  showLineNumbers: boolean
  fontSize: number
  fontFamily: string
  lastOpenFolder: string | null
  lastOpenFile: string | null
  notifications: boolean
  mainWindow: { width: number; height: number }
}
