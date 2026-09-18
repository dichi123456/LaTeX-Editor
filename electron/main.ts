import { app, BrowserWindow, ipcMain, dialog, shell, Notification, Menu, nativeImage } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import * as path from 'path'

import { detectTexLive, getEnginePath } from './texlive'
import { compileDocument, cancelCompile, isCompiling, cleanAuxFiles, runBibtex } from './compiler'
import { synctexForward, synctexBackward } from './synctex'
import { loadConfig, saveConfig } from './config'
import { setWorkspace, setTexlivePath } from './tools'
import { runAgentLoop, setAgentLoopWindow } from './agent-loop'
import {
  readTextFile,
  writeTextFile,
  writeBinaryFile,
  listDirectory,
  createFile,
  createDir,
  deletePath,
  renamePath,
  copyPathToDir,
  getFileStats,
  getRecentFiles,
  addRecentFile,
  getRecentWorkspaces,
  addRecentWorkspace
} from './file'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    title: '墨灵TeX',
    backgroundColor: '#0f172a',
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  setAgentLoopWindow(mainWindow)

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.moling.tex')

  // 版本升级时清理最近文件等痕迹（不删 localStorage，保留 API Key）
  try {
    const fs = require('fs')
    const versionFile = join(app.getPath('userData'), '.app-version')
    const current = app.getVersion()
    let prev = ''
    try { prev = fs.readFileSync(versionFile, 'utf-8').trim() } catch { /* first run */ }
    if (prev && prev !== current) {
      const ud = app.getPath('userData')
      for (const f of ['recent.json', 'recent-workspaces.json']) {
        try { fs.unlinkSync(join(ud, f)) } catch { /* ignore */ }
      }
    }
    fs.writeFileSync(versionFile, current, 'utf-8')
  } catch { /* ignore */ }

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  buildMenu()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  cancelCompile()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  cancelCompile()
})

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        { label: '新建文件', accelerator: 'CmdOrCtrl+N', click: () => sendMenu('new-file') },
        { label: '打开文件…', accelerator: 'CmdOrCtrl+O', click: () => sendMenu('open-file') },
        { label: '打开文件夹…', accelerator: 'CmdOrCtrl+K', click: () => sendMenu('open-folder') },
        { type: 'separator' },
        { label: '保存', accelerator: 'CmdOrCtrl+S', click: () => sendMenu('save') },
        { label: '另存为…', accelerator: 'Ctrl+Shift+S', click: () => sendMenu('save-as') },
        { type: 'separator' },
        { label: '设置', accelerator: 'Ctrl+,', click: () => sendMenu('settings') },
        { type: 'separator' },
        { role: 'quit', label: '退出' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '编译',
      submenu: [
        { label: '编译文档', accelerator: 'F5', click: () => sendMenu('compile') },
        { label: '清理辅助文件', accelerator: 'Ctrl+Shift+D', click: () => sendMenu('clean') },
        { type: 'separator' },
        { label: '在外部打开 PDF', accelerator: 'F7', click: () => sendMenu('open-pdf') }
      ]
    },
    {
      label: '查看',
      submenu: [
        { label: '切换文件树', accelerator: 'Ctrl+B', click: () => sendMenu('toggle-sidebar') },
        { label: '切换预览', accelerator: 'Ctrl+Alt+P', click: () => sendMenu('toggle-preview') },
        { label: '切换日志', accelerator: 'Ctrl+J', click: () => sendMenu('toggle-log') },
        { type: 'separator' },
        { label: '全屏编辑', accelerator: 'F11', click: () => sendMenu('distraction-free') },
        { type: 'separator' },
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于',
          click: () => {
            dialog.showMessageBox({
              type: 'info',
              title: '关于 墨灵TeX',
              message: '墨灵TeX v1.0.1',
              detail:
                '本地 LaTeX 文档编辑、编译、预览一体化工具。\n依赖本机 TeX Live 2024。\n\n快捷键：\nF5 编译 | Ctrl+S 保存 | Ctrl+O 打开\nCtrl+B 文件树 | Ctrl+J 日志 | F11 专注模式'
            })
          }
        }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function sendMenu(action: string): void {
  mainWindow?.webContents.send('menu-action', action)
}

// ========== IPC Handlers ==========

// TeX Live
ipcMain.handle('detect-texlive', async () => {
  return detectTexLive()
})

// 编译
ipcMain.handle('compile', async (_event, options) => {
  if (!mainWindow) return null
  const config = await loadConfig()
  const binPath = options.texlivePath || config.texlivePath
  return compileDocument(options, binPath, (message, type) => {
    mainWindow?.webContents.send('compile-progress', { message, type })
  })
})

ipcMain.handle('cancel-compile', async () => cancelCompile())
ipcMain.handle('is-compiling', async () => isCompiling())
ipcMain.handle('clean-aux', async (_event, mainPath: string) => cleanAuxFiles(mainPath))
ipcMain.handle('run-bibtex', async (_event, mainPath: string, texlivePath: string | null) => {
  return runBibtex(mainPath, texlivePath, (message, type) => {
    mainWindow?.webContents.send('compile-progress', { message, type })
  })
})

// SyncTeX 正向：源码行 → PDF 位置
ipcMain.handle('synctex-forward', async (_event, texPath: string, line: number, pdfPath: string, texlivePath: string | null) => {
  return synctexForward(texPath, line, pdfPath, texlivePath)
})

// SyncTeX 反向：PDF 坐标 → 源码行
ipcMain.handle('synctex-backward', async (_event, page: number, x: number, y: number, pdfPath: string, texlivePath: string | null) => {
  return synctexBackward(page, x, y, pdfPath, texlivePath)
})

// 文件
ipcMain.handle('open-file-dialog', async () => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '打开文件',
    filters: [
      { name: 'LaTeX 文件', extensions: ['tex', 'ltx', 'sty', 'cls', 'bib', 'bbl', 'txt'] },
      { name: '所有文件', extensions: ['*'] }
    ],
    properties: ['openFile']
  })
  if (result.canceled || result.filePaths.length === 0) return null
  const filePath = result.filePaths[0]
  await addRecentFile(filePath)
  return filePath
})

ipcMain.handle('open-folder-dialog', async () => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '打开文件夹',
    properties: ['openDirectory']
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

ipcMain.handle('read-file', async (_event, filePath: string) => readTextFile(filePath))
ipcMain.handle('read-pdf', async (_event, filePath: string) => {
  try {
    const fs = require('fs')
    const buf = fs.readFileSync(filePath)
    console.log('[read-pdf] read', filePath, 'size =', buf.length)
    // 返回 base64，避免 IPC 传输 ArrayBuffer 的序列化问题
    return buf.toString('base64')
  } catch (err: any) {
    console.error('[read-pdf] failed:', err?.message)
    return null
  }
})
ipcMain.handle('write-file', async (_event, filePath: string, content: string) =>
  writeTextFile(filePath, content)
)
ipcMain.handle('write-binary-file', async (_event, filePath: string, base64: string) =>
  writeBinaryFile(filePath, base64)
)
ipcMain.handle('list-dir', async (_event, dirPath: string) => listDirectory(dirPath))
ipcMain.handle('create-file', async (_event, dirPath: string, fileName: string) =>
  createFile(dirPath, fileName)
)
ipcMain.handle('create-dir', async (_event, dirPath: string, dirName: string) =>
  createDir(dirPath, dirName)
)
ipcMain.handle('delete-file', async (_event, filePath: string) => deletePath(filePath))
ipcMain.handle('rename-file', async (_event, oldPath: string, newPath: string) =>
  renamePath(oldPath, newPath)
)
ipcMain.handle('copy-path-to-dir', async (_event, srcPath: string, destDir: string) =>
  copyPathToDir(srcPath, destDir)
)
ipcMain.handle('file-stats', async (_event, filePath: string) => getFileStats(filePath))
ipcMain.handle('get-recent-files', async () => getRecentFiles())
ipcMain.handle('add-recent-file', async (_event, filePath: string) => addRecentFile(filePath))
ipcMain.handle('get-recent-workspaces', async () => getRecentWorkspaces())
ipcMain.handle('add-recent-workspace', async (_event, wsPath: string) => addRecentWorkspace(wsPath))
ipcMain.handle('get-template-dir', async () => {
  const config = await loadConfig()
  const userTemplates = path.join(config.texlivePath || '', '..', '..', 'latex-editor-templates')
  // 使用应用内置模板
  if (is.dev) {
    return join(app.getAppPath(), 'src', 'templates')
  }
  return join(process.resourcesPath || app.getAppPath(), 'templates')
})

// 配置
ipcMain.handle('load-config', async () => {
  const c = await loadConfig()
  console.log('[main] load-config →', c.theme, c.showLineNumbers)
  return c
})
ipcMain.handle('save-config', async (_event, config) => {
  console.log('[main] save-config ←', JSON.stringify(config).slice(0, 200))
  const ok = await saveConfig(config)
  console.log('[main] save-config result:', ok)
  return ok
})

// 对话框
ipcMain.handle('choose-directory', async (_event, options?: { title?: string; defaultPath?: string }) => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    title: options?.title || '选择目录',
    defaultPath: options?.defaultPath || undefined,
    properties: ['openDirectory', 'createDirectory']
  })
  if (result.canceled) return null
  return result.filePaths[0] || null
})

ipcMain.handle('save-as-dialog', async (_event, defaultName: string) => {
  if (!mainWindow) return null
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '另存为',
    defaultPath: defaultName,
    filters: [{ name: 'LaTeX 文件', extensions: ['tex'] }]
  })
  if (result.canceled || !result.filePath) return null
  return result.filePath
})

ipcMain.handle('export-pdf-dialog', async (_event, srcPath: string) => {
  if (!mainWindow) return null
  const defaultName = srcPath.replace(/\.tex$/i, '.pdf')
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '导出 PDF',
    defaultPath: defaultName,
    filters: [{ name: 'PDF 文件', extensions: ['pdf'] }]
  })
  if (result.canceled || !result.filePath) return null
  const fs = require('fs')
  try {
    fs.copyFileSync(srcPath, result.filePath)
    return result.filePath
  } catch {
    return null
  }
})

ipcMain.handle('open-external', async (_event, url: string) => {
  await shell.openExternal(url)
})

ipcMain.handle('open-pdf-external', async (_event, pdfPath: string) => {
  await shell.openPath(pdfPath)
})

// 在系统文件资源管理器中打开文件/文件夹
ipcMain.handle('show-in-explorer', async (_event, targetPath: string) => {
  if (!targetPath) return false
  const fs = require('fs')
  try {
    if (!fs.existsSync(targetPath)) return false
    shell.showItemInFolder(targetPath)
    return true
  } catch (err: any) {
    console.error('[show-in-explorer]', err)
    return false
  }
})

// 打开内置 TeX Live 安装说明 PDF
ipcMain.handle('open-texlive-guide', async () => {
  const fs = require('fs')
  const candidates = [
    is.dev
      ? join(app.getAppPath(), 'resources', 'texlive-install-guide.pdf')
      : join(process.resourcesPath || '', 'texlive-install-guide.pdf'),
    join(app.getAppPath(), 'resources', 'texlive-install-guide.pdf')
  ]
  for (const p of candidates) {
    if (p && fs.existsSync(p)) {
      const err = await shell.openPath(p)
      if (!err) return true
    }
  }
  // 兜底：打开官方下载页
  await shell.openExternal('https://tug.org/texlive/windows.html')
  return false
})

ipcMain.handle('show-notification', async (_event, title: string, body: string) => {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show()
  }
})

ipcMain.handle('set-title', async (_event, title: string) => {
  mainWindow?.setTitle(title)
})

// 检查更新（GitHub API）
ipcMain.handle('check-update', async () => {
  const current = app.getVersion()
  const https = require('https')
  const fetchRelease = (secure: boolean) => new Promise<any>((resolve, reject) => {
    const req = https.get(
      'https://api.github.com/repos/dichi123456/LaTeX-Editor/releases/latest',
      {
        headers: {
          'User-Agent': 'MoLingTeX-Updater',
          'Accept': 'application/vnd.github+json'
        },
        rejectUnauthorized: secure
      },
      (res: any) => {
        let body = ''
        res.on('data', (chunk: string) => { body += chunk })
        res.on('end', () => {
          try { resolve(JSON.parse(body)) } catch { reject(new Error('解析响应失败')) }
        })
      }
    )
    req.on('error', reject)
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('请求超时')) })
  })
  try {
    let data: any
    try {
      data = await fetchRelease(true)
    } catch {
      // 系统证书异常时降级重试
      data = await fetchRelease(false)
    }
    const latest = String(data.tag_name || '').replace(/^v/, '')
    // 语义化版本比较，避免 1.0.10 < 1.0.5 误判
    const parseVer = (v: string) => v.split('.').map((n) => parseInt(n, 10) || 0)
    const lv = parseVer(latest)
    const cv = parseVer(current)
    let hasUpdate = false
    for (let i = 0; i < Math.max(lv.length, cv.length); i++) {
      const a = lv[i] || 0
      const b = cv[i] || 0
      if (a > b) { hasUpdate = true; break }
      if (a < b) { hasUpdate = false; break }
    }
    // 找 exe 安装包下载地址
    const assets = Array.isArray(data.assets) ? data.assets : []
    const exeAsset = assets.find((a: any) => /\.exe$/i.test(a.name || ''))
    return {
      success: true,
      current,
      latest,
      hasUpdate,
      url: data.html_url || 'https://github.com/dichi123456/LaTeX-Editor/releases/latest',
      downloadUrl: exeAsset?.browser_download_url || null,
      body: String(data.body || '').slice(0, 500)
    }
  } catch (err: any) {
    return { success: false, error: err?.message || '网络请求失败', current }
  }
})

// 下载更新包并启动安装
let downloading = false
ipcMain.handle('download-update', async (_event, downloadUrl: string) => {
  if (downloading) return { success: false, error: '正在下载中，请稍候' }
  if (!downloadUrl || !downloadUrl.startsWith('https://')) {
    return { success: false, error: '无效的下载地址' }
  }
  downloading = true
  const fs = require('fs')
  const os = require('os')
  const path = require('path')
  const { spawn } = require('child_process')
  const tmpDir = os.tmpdir()
  const fileName = path.basename(downloadUrl) || 'MoLingTeX-Setup.exe'
  const savePath = path.join(tmpDir, fileName)

  try {
    const https = require('https')
    await new Promise<void>((resolve, reject) => {
      const file = fs.createWriteStream(savePath)
      const req = https.get(
        downloadUrl,
        { rejectUnauthorized: false, headers: { 'User-Agent': 'MoLingTeX-Updater' } },
        (res: any) => {
          // GitHub 可能 302 重定向到 objects.githubusercontent.com
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            file.close()
            try { fs.unlinkSync(savePath) } catch { /* ignore */ }
            https.get(
              res.headers.location,
              { rejectUnauthorized: false },
              (res2: any) => {
                if (res2.statusCode !== 200) {
                  reject(new Error(`下载失败 HTTP ${res2.statusCode}`))
                  return
                }
                const file2 = fs.createWriteStream(savePath)
                res2.pipe(file2)
                file2.on('finish', () => { file2.close(); resolve() })
                file2.on('error', reject)
              }
            ).on('error', reject)
            return
          }
          if (res.statusCode !== 200) {
            reject(new Error(`下载失败 HTTP ${res.statusCode}`))
            return
          }
          res.pipe(file)
          file.on('finish', () => { file.close(); resolve() })
          file.on('error', reject)
        }
      )
      req.on('error', reject)
      req.setTimeout(120000, () => { req.destroy(); reject(new Error('下载超时')) })
    })

    // 下载完成，启动安装器并退出当前应用
    const child = spawn(savePath, [], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    })
    child.unref()
    setTimeout(() => { app.quit() }, 500)
    return { success: true, path: savePath }
  } catch (err: any) {
    try { fs.unlinkSync(savePath) } catch { /* ignore */ }
    return { success: false, error: err?.message || '下载失败' }
  } finally {
    downloading = false
  }
})

// 关于墨灵TeX
ipcMain.handle('show-about', async () => {
  if (!mainWindow) return
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: '关于 墨灵TeX',
    message: `墨灵TeX v${app.getVersion()}`,
    detail: '本地 LaTeX 编辑器 — 编辑·编译·预览·AI 助手\n\n开源协议：MIT\n仓库：github.com/dichi123456/LaTeX-Editor\n\n依赖本机 TeX Live，数据不出本机。'
  })
})

// 窗口控制（无边框窗口）
ipcMain.handle('window-minimize', () => { mainWindow?.minimize() })
ipcMain.handle('window-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize()
  else mainWindow?.maximize()
})
ipcMain.handle('window-close', () => { mainWindow?.close() })
ipcMain.handle('window-is-maximized', () => mainWindow?.isMaximized() ?? false)
ipcMain.handle('window-toggle-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize()
  else mainWindow?.maximize()
  return mainWindow?.isMaximized() ?? false
})

// 编译完成后通知
ipcMain.handle('notify-compile-done', async (_event, success: boolean) => {
  const config = await loadConfig()
  if (config.notifications && Notification.isSupported()) {
    new Notification({
      title: success ? '编译成功' : '编译失败',
      body: success ? 'PDF 已更新' : '请查看编译日志中的错误信息'
    }).show()
  }
})

// AI 助手：获取可用模型列表
ipcMain.handle('ai-fetch-models', async (_event, options: { apiBase: string; apiKey: string }) => {
  const { apiBase, apiKey } = options
  try {
    const url = apiBase.replace(/\/+$/, '') + '/models'
    const resp = await fetch(url, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    })
    if (!resp.ok) {
      return { success: false, error: `HTTP ${resp.status}`, models: [] }
    }
    const data = await resp.json()
    const models = (data.data || []).map((m: any) => ({
      id: m.id,
      name: m.id,
      owned_by: m.owned_by || ''
    }))
    return { success: true, models }
  } catch (err: any) {
    return { success: false, error: err.message, models: [] }
  }
})

// AI 助手：中断当前请求
let aiAbortController: AbortController | null = null
ipcMain.handle('ai-cancel', () => {
  if (aiAbortController) {
    aiAbortController.abort()
    aiAbortController = null
    mainWindow?.webContents.send('ai-stream', { type: 'cancelled' })
    return true
  }
  return false
})

// AI 助手：Kilo Code 风格 agent 循环（用户可配步数 + doom loop + 末轮收束）
ipcMain.handle('ai-chat', async (_event, options: {
  apiKey: string
  apiBase: string
  model: string
  messages: Array<{ role: string; content: string }>
  temperature?: number
  workspaceRoot?: string | null
  texlivePath?: string | null
  enableTools?: boolean
  permissionMode?: string
  maxSteps?: number
}) => {
  const {
    apiKey, apiBase, model, messages,
    temperature = 0.7,
    workspaceRoot, texlivePath: tlPath,
    enableTools = true, permissionMode = 'full',
    maxSteps
  } = options

  if (workspaceRoot) setWorkspace(workspaceRoot)
  if (tlPath) setTexlivePath(tlPath)

  aiAbortController = new AbortController()
  const signal = aiAbortController.signal

  try {
    const result = await runAgentLoop({
      apiKey,
      apiBase,
      model,
      messages: messages as any[],
      temperature,
      enableTools,
      permissionMode,
      maxSteps,
      signal,
      send: (payload) => {
        mainWindow?.webContents.send('ai-stream', payload)
      },
      onFileChanged: (path) => {
        mainWindow?.webContents.send('file-changed', { path })
      }
    })
    return result
  } finally {
    aiAbortController = null
  }
})
