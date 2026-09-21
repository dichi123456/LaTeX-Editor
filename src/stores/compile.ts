import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Ref } from 'vue'

export interface CompileIssue {
  type: 'error' | 'warning'
  message: string
  line: number | null
  file: string | null
}

export type CompileMode = 'quick' | 'full' | 'clean'

export interface PdfTab {
  id: string
  path: string
  name: string
}

export const useCompileStore = defineStore('compile', () => {
  const isCompiling: Ref<boolean> = ref(false)
  const lastResult: Ref<{
    success: boolean
    pdfPath: string | null
    log: string
    errors: CompileIssue[]
    warnings: CompileIssue[]
    duration: number
  } | null> = ref(null)
  const liveLog: Ref<string> = ref('')
  const texLiveFound: Ref<boolean> = ref(false)
  const texLivePath: Ref<string | null> = ref(null)
  const logFilter: Ref<'all' | 'error' | 'warning'> = ref('all')
  const compileProgress: Ref<string> = ref('')

  async function detectTexLive(): Promise<void> {
    try {
      const result = await window.electronAPI.detectTexLive()
      if (result.found && result.path) {
        texLiveFound.value = true
        texLivePath.value = result.path
        return
      }
    } catch { /* fall through to config */ }

    // Detection can fail when TeX Live is only on a non-standard drive/path.
    // Prefer a previously saved config path over declaring "not found".
    try {
      const { useConfigStore } = await import('./config')
      const cfgPath = useConfigStore().config?.texlivePath
      if (cfgPath) {
        texLiveFound.value = true
        texLivePath.value = cfgPath
        return
      }
    } catch { /* ignore */ }

    texLiveFound.value = false
    texLivePath.value = null
  }

  async function compile(
    filePath: string,
    engine: string,
    extraArgs: string[],
    timeoutSec: number,
    mode: CompileMode = 'quick'
  ): Promise<boolean> {
    if (isCompiling.value) {
      liveLog.value += '[编译] 已有编译任务进行中，本次请求已忽略。可先取消再重试。\n'
      return false
    }

    isCompiling.value = true
    liveLog.value = ''
    const startTime = Date.now()
    let compileResult: any = null

    const enginePass = async (passLabel: string, draft = false) => {
      compileProgress.value = passLabel
      liveLog.value += `===== ${passLabel} =====\n`
      compileResult = await window.electronAPI.compile({
        filePath,
        engine,
        extraArgs,
        timeout: timeoutSec * 1000,
        texlivePath: texLivePath.value,
        draft
      })
      liveLog.value += compileResult.log + '\n'
      return compileResult.success as boolean
    }

    /** 完整流程：tex → bibtex → tex → tex（共 4 步） */
    const runFullPipeline = async (prefix: string) => {
      if (!(await enginePass(`${prefix} 1/4 · tex（生成 .aux）`))) return false

      compileProgress.value = `${prefix} 2/4 · bibtex…`
      liveLog.value += `===== ${prefix} 2/4 · bibtex（参考文献） =====\n`
      const bibtexResult = await window.electronAPI.runBibtex(filePath, texLivePath.value)
      liveLog.value += (bibtexResult.log || '') + '\n'
      // bibtex 失败不阻断（可能没有参考文献）

      if (!(await enginePass(`${prefix} 3/4 · tex（合并引用）`))) return false
      if (!(await enginePass(`${prefix} 4/4 · tex（交叉引用 / 目录）`))) return false
      return true
    }

    try {
      // 从头编译：先删辅助文件，再走与完整编译相同的 4 步流程
      if (mode === 'clean') {
        compileProgress.value = '正在清理辅助文件…'
        const deleted = await window.electronAPI.cleanAuxFiles(filePath)
        if (deleted.length > 0) {
          liveLog.value += `[清理] 已删除 ${deleted.length} 个辅助文件：${deleted.join(', ')}\n\n`
          window.dispatchEvent(new CustomEvent('refresh-file-tree'))
        } else {
          liveLog.value += '[清理] 无辅助文件需要删除\n\n'
        }
        await runFullPipeline('从头编译')
      } else if (mode === 'full') {
        // 完整编译：tex → bibtex → tex → tex
        await runFullPipeline('完整编译')
      } else {
        // 快速编译：draft 单次（图片占位，不跑 bibtex）
        liveLog.value += '===== 快速编译（draft · 单次 · 图片占位）=====\n'
        await enginePass('快速编译（draft）', true)
      }

      const duration = Date.now() - startTime
      lastResult.value = {
        success: compileResult.success,
        pdfPath: compileResult.pdfPath,
        log: liveLog.value,
        errors: compileResult.errors,
        warnings: compileResult.warnings,
        duration
      }
      if (!compileResult.success && compileResult.errors?.length) {
        const top = compileResult.errors.slice(0, 5).map((e: CompileIssue) => {
          const loc = e.line != null ? `${e.file || filePath}:${e.line}` : (e.file || filePath)
          return `  · ${loc}: ${e.message}`
        }).join('\n')
        liveLog.value += `[错误摘要]\n${top}\n`
      }
      await window.electronAPI.notifyCompileDone(compileResult.success)
      if (compileResult.success && compileResult.pdfPath) {
        pdfReloadToken.value++
      }
      // 编译会生成/更新 PDF 与辅助文件：始终刷新文件树
      window.dispatchEvent(new CustomEvent('refresh-file-tree'))
      return compileResult.success
    } catch (err: any) {
      lastResult.value = {
        success: false,
        pdfPath: null,
        log: String(err?.message || err),
        errors: [{ type: 'error', message: String(err?.message || err), line: null, file: null }],
        warnings: [],
        duration: Date.now() - startTime
      }
      window.dispatchEvent(new CustomEvent('refresh-file-tree'))
      return false
    } finally {
      isCompiling.value = false
      compileProgress.value = ''
    }
  }

  function appendLiveLog(text: string): void {
    liveLog.value += text
  }

  async function cleanAux(mainPath: string): Promise<string[]> {
    return window.electronAPI.cleanAuxFiles(mainPath)
  }

  // ===== PDF 标签页管理 =====
  const pdfTabs: Ref<PdfTab[]> = ref([])
  const activePdfTabId: Ref<string | null> = ref(null)
  // 每次编译成功后自增，用于触发 PDF 预览强制刷新
  const pdfReloadToken: Ref<number> = ref(0)

  const activePdfTab = computed(() =>
    pdfTabs.value.find((t) => t.id === activePdfTabId.value) || null
  )

  function openPdfTab(path: string): void {
    // 已打开则激活
    const existing = pdfTabs.value.find((t) => t.path === path)
    if (existing) {
      activePdfTabId.value = existing.id
      return
    }
    const name = path.split(/[\\/]/).pop() || path
    const tab: PdfTab = {
      id: `pdf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      path,
      name
    }
    pdfTabs.value.push(tab)
    activePdfTabId.value = tab.id
  }

  function closePdfTab(id: string): void {
    const idx = pdfTabs.value.findIndex((t) => t.id === id)
    if (idx === -1) return
    pdfTabs.value.splice(idx, 1)
    if (activePdfTabId.value === id) {
      if (pdfTabs.value.length > 0) {
        activePdfTabId.value = pdfTabs.value[Math.min(idx, pdfTabs.value.length - 1)].id
      } else {
        activePdfTabId.value = null
      }
    }
  }

  function closePdfTabByPath(path: string): void {
    const tab = pdfTabs.value.find((t) => t.path === path)
    if (tab) closePdfTab(tab.id)
  }

  function activatePdfTab(id: string): void {
    activePdfTabId.value = id
  }

  function movePdfTab(fromId: string, toId: string): void {
    const fromIdx = pdfTabs.value.findIndex((t) => t.id === fromId)
    const toIdx = pdfTabs.value.findIndex((t) => t.id === toId)
    if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return
    const [item] = pdfTabs.value.splice(fromIdx, 1)
    pdfTabs.value.splice(toIdx, 0, item)
  }

  return {
    isCompiling,
    lastResult,
    liveLog,
    texLiveFound,
    texLivePath,
    logFilter,
    compileProgress,
    pdfTabs,
    activePdfTabId,
    activePdfTab,
    pdfReloadToken,
    detectTexLive,
    compile,
    appendLiveLog,
    cleanAux,
    openPdfTab,
    closePdfTab,
    closePdfTabByPath,
    activatePdfTab,
    movePdfTab
  }
})
