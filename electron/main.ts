import { app, BrowserWindow, ipcMain, dialog, shell, Notification, Menu, nativeImage } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import * as path from 'path'

import { detectTexLive, getEnginePath } from './texlive'
import { compileDocument, cancelCompile, isCompiling, cleanAuxFiles, runBibtex } from './compiler'
import { loadConfig, saveConfig } from './config'
import { TOOLS, executeTool, setWorkspace, setTexlivePath, getToolPermission, type ToolCall, type ToolResult } from './tools'
import {
  readTextFile,
  writeTextFile,
  listDirectory,
  createFile,
  createDir,
  deletePath,
  renamePath,
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
    title: 'LaTeX编辑器',
    backgroundColor: '#FAFAFA',
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

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
  electronApp.setAppUserModelId('com.latex.editor')

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
              title: '关于 LaTeX编辑器',
              message: 'LaTeX编辑器 v1.0.0',
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
ipcMain.handle('choose-directory', async () => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择目录',
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

ipcMain.handle('show-notification', async (_event, title: string, body: string) => {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show()
  }
})

ipcMain.handle('set-title', async (_event, title: string) => {
  mainWindow?.setTitle(title)
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

// AI 助手：支持工具调用的流式响应
ipcMain.handle('ai-chat', async (_event, options: {
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
}) => {
  const {
    apiKey, apiBase, model, messages,
    temperature = 0.7, maxTokens = 4096,
    workspaceRoot, texlivePath: tlPath,
    enableTools = true, permissionMode = 'full'
  } = options
  const url = apiBase.replace(/\/+$/, '') + '/chat/completions'

  if (workspaceRoot) setWorkspace(workspaceRoot)
  if (tlPath) setTexlivePath(tlPath)

  const maxIterations = 5 // 防止无限循环
  let allMessages = [...messages]
  let fullReasoning = ''
  aiAbortController = new AbortController()

  for (let iter = 0; iter < maxIterations; iter++) {
    // 检查是否被中断
    if (aiAbortController.signal.aborted) {
      mainWindow?.webContents.send('ai-stream', { type: 'cancelled' })
      return { success: false, error: '已取消' }
    }

    const useTools = enableTools && iter < maxIterations - 1

    const body: any = {
      model,
      messages: allMessages,
      temperature,
      max_tokens: maxTokens,
      stream: true
    }
    if (useTools) {
      body.tools = TOOLS
      body.tool_choice = 'auto'
    }

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(body),
        signal: aiAbortController.signal
      })

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '')
        return { success: false, error: `API 错误 ${resp.status}: ${errText.slice(0, 500)}` }
      }

      // 流式读取 SSE
      const reader = resp.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let fullContent = ''
      const toolCallsMap: Map<number, any> = new Map()

      while (true) {
        // 检查中断
        if (aiAbortController.signal.aborted) {
          try { reader.cancel() } catch { /* */ }
          mainWindow?.webContents.send('ai-stream', { type: 'cancelled' })
          return { success: false, error: '已取消' }
        }

        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data:')) continue
          const data = trimmed.slice(5).trim()
          if (data === '[DONE]') continue

          try {
            const json = JSON.parse(data)
            const delta = json.choices?.[0]?.delta
            const finishReason = json.choices?.[0]?.finish_reason

            if (delta?.content) {
              fullContent += delta.content
              mainWindow?.webContents.send('ai-stream', { type: 'content', text: delta.content })
            }
            if (delta?.reasoning_content) {
              fullReasoning += delta.reasoning_content
              mainWindow?.webContents.send('ai-stream', { type: 'reasoning', text: delta.reasoning_content })
            }
            // 工具调用（流式增量）
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index || 0
                if (!toolCallsMap.has(idx)) {
                  toolCallsMap.set(idx, { id: tc.id || '', type: 'function', function: { name: '', arguments: '' } })
                }
                const existing = toolCallsMap.get(idx)
                if (tc.id) existing.id = tc.id
                if (tc.function?.name) existing.function.name += tc.function.name
                if (tc.function?.arguments) existing.function.arguments += tc.function.arguments
              }
            }
          } catch { /* skip */ }
        }
      }

      // 检查是否有工具调用
      if (toolCallsMap.size > 0) {
        const toolCalls: ToolCall[] = Array.from(toolCallsMap.values())

        // 将 assistant 消息（含 tool_calls）加入历史
        allMessages.push({
          role: 'assistant',
          content: fullContent || '',
          // @ts-ignore - tool_calls 字段
          tool_calls: toolCalls
        } as any)

        // 执行每个工具
        for (const tc of toolCalls) {
          mainWindow?.webContents.send('ai-stream', {
            type: 'tool_call',
            toolName: tc.function.name,
            args: tc.function.arguments
          })

          const result = await executeTool(tc)

          mainWindow?.webContents.send('ai-stream', {
            type: 'tool_result',
            toolName: tc.function.name,
            result: result.result.slice(0, 500),
            success: result.success
          })

          // 写操作成功后，通知前端刷新对应文件
          if (result.success && (tc.function.name === 'write_file' || tc.function.name === 'replace_text')) {
            try {
              const args = JSON.parse(tc.function.arguments)
              if (args.path) {
                mainWindow?.webContents.send('file-changed', { path: args.path })
              }
            } catch { /* ignore */ }
          }

          // 将工具结果加入消息历史
          allMessages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: result.result
          } as any)
        }

        // 继续下一轮迭代，获取 AI 的最终回复
        continue
      }

      // 无工具调用，完成
      mainWindow?.webContents.send('ai-stream', { type: 'done' })
      return { success: true, content: fullContent, reasoning: fullReasoning }

    } catch (err: any) {
      mainWindow?.webContents.send('ai-stream', { type: 'error', text: err.message })
      return { success: false, error: `请求失败: ${err.message}` }
    }
  }

  // 超过最大迭代次数
  mainWindow?.webContents.send('ai-stream', { type: 'done' })
  return { success: true, content: '（已达到最大工具调用轮次）', reasoning: fullReasoning }
})
