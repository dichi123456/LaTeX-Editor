/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

interface Window {
  electronAPI: {
    // 文件
    openFile: () => Promise<string | null>
    openFolder: () => Promise<string | null>
    readFile: (filePath: string) => Promise<{ content: string; encoding: string }>
    writeFile: (filePath: string, content: string) => Promise<boolean>
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

    // 配置
    loadConfig: () => Promise<AppConfig>
    saveConfig: (config: AppConfig) => Promise<boolean>

    // 对话框 / 系统
    chooseDirectory: () => Promise<string | null>
    saveAs: (defaultName: string) => Promise<string | null>
    openExternal: (url: string) => Promise<void>
    openPdfExternal: (pdfPath: string) => Promise<void>
    exportPdf: (srcPath: string) => Promise<string | null>
    showNotification: (title: string, body: string) => Promise<void>
    setTitle: (title: string) => Promise<void>
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
      maxTokens?: number
      workspaceRoot?: string | null
      texlivePath?: string | null
      enableTools?: boolean
      permissionMode?: string
    }) => Promise<{ success: boolean; content?: string; error?: string; reasoning?: string }>
    onAiStream: (cb: (data: { type: string; text?: string; toolName?: string; args?: string; result?: string; success?: boolean }) => void) => () => void

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
