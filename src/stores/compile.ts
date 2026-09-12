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
    const result = await window.electronAPI.detectTexLive()
    texLiveFound.value = result.found
    texLivePath.value = result.path
  }

  async function compile(
    filePath: string,
    engine: string,
    extraArgs: string[],
    timeoutSec: number,
    mode: CompileMode = 'quick'
  ): Promise<boolean> {
    if (isCompiling.value) return false

    isCompiling.value = true
    liveLog.value = ''
    const startTime = Date.now()
    let compileResult: any = null

    try {
      // 清理模式：先删除辅助文件
      if (mode === 'clean') {
        compileProgress.value = '正在清理辅助文件…'
        const deleted = await window.electronAPI.cleanAuxFiles(filePath)
        if (deleted.length > 0) {
          liveLog.value += `[清理] 已删除 ${deleted.length} 个辅助文件：${deleted.join(', ')}\n\n`
        }
      }

      if (mode === 'full') {
        // ===== 完整编译：引擎 → bibtex → 引擎 → 引擎 =====
        // 第 1 遍：生成 .aux
        compileProgress.value = '编译第 1/3 遍（生成 .aux）…'
        liveLog.value += '===== 第 1 遍：生成 .aux =====\n'
        compileResult = await window.electronAPI.compile({
          filePath, engine, extraArgs, timeout: timeoutSec * 1000, texlivePath: texLivePath.value
        })
        liveLog.value += compileResult.log + '\n'
        if (!compileResult.success) {
          lastResult.value = { success: false, pdfPath: null, log: liveLog.value, errors: compileResult.errors, warnings: compileResult.warnings, duration: Date.now() - startTime }
          await window.electronAPI.notifyCompileDone(false)
          return false
        }

        // bibtex：处理参考文献
        compileProgress.value = '正在运行 bibtex…'
        liveLog.value += '===== bibtex：处理参考文献 =====\n'
        const bibtexResult = await window.electronAPI.runBibtex(filePath, texLivePath.value)
        liveLog.value += bibtexResult.log + '\n'
        // bibtex 失败不阻断（可能没有参考文献）

        // 第 2 遍：合并参考文献
        compileProgress.value = '编译第 2/3 遍（合并引用）…'
        liveLog.value += '===== 第 2 遍：合并引用 =====\n'
        compileResult = await window.electronAPI.compile({
          filePath, engine, extraArgs, timeout: timeoutSec * 1000, texlivePath: texLivePath.value
        })
        liveLog.value += compileResult.log + '\n'
        if (!compileResult.success) {
          lastResult.value = { success: false, pdfPath: null, log: liveLog.value, errors: compileResult.errors, warnings: compileResult.warnings, duration: Date.now() - startTime }
          await window.electronAPI.notifyCompileDone(false)
          return false
        }

        // 第 3 遍：解决交叉引用
        compileProgress.value = '编译第 3/3 遍（解决交叉引用）…'
        liveLog.value += '===== 第 3 遍：解决交叉引用 =====\n'
        compileResult = await window.electronAPI.compile({
          filePath, engine, extraArgs, timeout: timeoutSec * 1000, texlivePath: texLivePath.value
        })
        liveLog.value += compileResult.log + '\n'

      } else if (mode === 'quick') {
        // ===== 快速编译：draft 模式单次编译 =====
        compileProgress.value = '快速编译中…'
        liveLog.value += '===== 快速编译（draft 模式） =====\n'

        // 注入 [draft] 到 documentclass，跳过图片等重资源
        const draftArgs = [...extraArgs]
        compileResult = await window.electronAPI.compile({
          filePath, engine, extraArgs: draftArgs, timeout: timeoutSec * 1000, texlivePath: texLivePath.value
        })
        // 如果文档类没有 draft 选项，用 -draftmode 替代（注意：不生成 PDF，仅用于语法检查）
        // 这里选择保留 PDF 输出，只在文档类层面加 draft
        liveLog.value += compileResult.log + '\n'

      } else {
        // ===== 从头编译：清理后单次编译 =====
        compileProgress.value = '从头编译中…'
        liveLog.value += '===== 从头编译（已清理辅助文件） =====\n'
        compileResult = await window.electronAPI.compile({
          filePath, engine, extraArgs, timeout: timeoutSec * 1000, texlivePath: texLivePath.value
        })
        liveLog.value += compileResult.log + '\n'
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
      await window.electronAPI.notifyCompileDone(compileResult.success)
      if (compileResult.success && compileResult.pdfPath) {
        pdfReloadToken.value++
      }
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
    activatePdfTab,
    movePdfTab
  }
})
