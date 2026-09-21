import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Ref } from 'vue'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  reasoning?: string
  toolSteps?: ToolStep[]
  timestamp: number
  error?: boolean
  streaming?: boolean
  fileContext?: string
  durationMs?: number
}

export interface ToolStep {
  id: string
  toolName: string
  args: string
  result?: string
  success?: boolean
  status: 'running' | 'done'
  startedAt?: number
  durationMs?: number
}

export interface ChatSession {
  id: string
  title: string
  messages: ChatMessage[]
  updatedAt: number
}

/** 思考深度：一般 / 高 / 最大（映射 OpenAI reasoning_effort 与 temperature） */
export type ReasoningEffort = 'low' | 'medium' | 'high'

export interface AiConfig {
  apiBase: string
  apiKey: string
  model: string
  selectedModels: string[]
  systemPrompt: string
  temperature: number
  permissionMode: 'ask' | 'full'
  /** Agent 最大迭代步数（Kilo Code agent.steps），1–100 */
  maxSteps: number
  /** 思考深度 */
  reasoningEffort: ReasoningEffort
}

export interface EditProposal {
  find: string
  replace: string
  applied: boolean
}

const DEFAULT_AI_CONFIG: AiConfig = {
  apiBase: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  selectedModels: [],
  // Short base note; full Kilo-style prompt is assembled at send time in the renderer/agent loop
  systemPrompt: '你是「墨灵」，专业的 LaTeX 写作工程师。回答使用 Markdown，LaTeX 代码用 ```latex 块。',
  // Kilo coding agents: low temperature for deterministic tool use (faster, fewer hesitations)
  temperature: 0.2,
  permissionMode: 'ask',
  // Kilo agent.steps
  maxSteps: 15,
  reasoningEffort: 'low'
}

/** 思考深度 → 请求参数（OpenAI reasoning_effort + 对应 temperature） */
export function reasoningParams(effort: ReasoningEffort): { reasoningEffort: ReasoningEffort; temperature: number } {
  switch (effort) {
    case 'high':
      return { reasoningEffort: 'high', temperature: 0.4 }
    case 'medium':
      return { reasoningEffort: 'medium', temperature: 0.3 }
    default:
      return { reasoningEffort: 'low', temperature: 0.2 }
  }
}

let streamUnsubscribe: (() => void) | null = null

export const useAiStore = defineStore('ai', () => {
  const aiConfig: Ref<AiConfig> = ref({ ...DEFAULT_AI_CONFIG })
  const messages: Ref<ChatMessage[]> = ref([])
  const sessions: Ref<ChatSession[]> = ref([])
  const activeSessionId: Ref<string | null> = ref(null)
  const isThinking: Ref<boolean> = ref(false)
  const showPanel: Ref<boolean> = ref(false)
  const streamingContent: Ref<string> = ref('')
  const streamingReasoning: Ref<string> = ref('')
  const toolSteps: Ref<ToolStep[]> = ref([])
  const cancelled: Ref<boolean> = ref(false)
  // 当前 agent 步进（Kilo 风格：第 N / 共 M 步）
  const stepCurrent: Ref<number> = ref(0)
  const stepMax: Ref<number> = ref(0)
  const stepIsFinal: Ref<boolean> = ref(false)
  // 本轮处理耗时
  const turnStartedAt: Ref<number | null> = ref(null)
  const turnElapsedMs: Ref<number> = ref(0)
  // 待批准的写操作
  const pendingWrite: Ref<{ toolName: string; args: string; resolve: (approved: boolean) => void } | null> = ref(null)

  function resetStepProgress(): void {
    stepCurrent.value = 0
    stepMax.value = 0
    stepIsFinal.value = false
  }

  function cancelStream(): void {
    cancelled.value = true
    isThinking.value = false
    // 通知主进程中断请求
    window.electronAPI.aiCancel().catch(() => { /* ignore */ })
    // 将已有的流式内容保存为消息
    if (streamingContent.value || streamingReasoning.value) {
      messages.value.push({
        id: msgId(),
        role: 'assistant',
        content: streamingContent.value || '(已中断)',
        reasoning: streamingReasoning.value || undefined,
        timestamp: Date.now(),
        streaming: false,
        toolSteps: toolSteps.value.length > 0 ? [...toolSteps.value] : undefined
      })
    }
    streamingContent.value = ''
    streamingReasoning.value = ''
    toolSteps.value = []
    resetStepProgress()
  }

  function setupStream() {
    if (streamUnsubscribe) return
    streamUnsubscribe = window.electronAPI.onAiStream((data: any) => {
      if (data.type === 'reasoning') {
        streamingReasoning.value += data.text || ''
      } else if (data.type === 'content') {
        streamingContent.value += data.text || ''
      } else if (data.type === 'step') {
        stepCurrent.value = data.current || 0
        stepMax.value = data.max || 0
        stepIsFinal.value = !!data.final
      } else if (data.type === 'tool_call') {
        toolSteps.value.push({
          id: `tool-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          toolName: data.toolName || 'unknown',
          args: data.args || '',
          status: 'running',
          startedAt: Date.now()
        })
      } else if (data.type === 'tool_result') {
        const step = [...toolSteps.value].reverse().find((s) => s.toolName === data.toolName && s.status === 'running')
        if (step) {
          step.result = data.result
          step.success = data.success
          step.status = 'done'
          if (step.startedAt) step.durationMs = Date.now() - step.startedAt
        }
      } else if (data.type === 'done') {
        const durationMs = turnStartedAt.value ? Date.now() - turnStartedAt.value : 0
        const msg: ChatMessage = {
          id: msgId(),
          role: 'assistant',
          content: streamingContent.value,
          reasoning: streamingReasoning.value || undefined,
          timestamp: Date.now(),
          streaming: false,
          toolSteps: toolSteps.value.length > 0 ? [...toolSteps.value] : undefined,
          durationMs: durationMs > 0 ? durationMs : undefined
        }
        messages.value.push(msg)
        streamingContent.value = ''
        streamingReasoning.value = ''
        toolSteps.value = []
        resetStepProgress()
        turnStartedAt.value = null
        turnElapsedMs.value = 0
        isThinking.value = false
        persistHistory()
      } else if (data.type === 'cancelled') {
        // 中断：保存已有内容
        if (streamingContent.value || streamingReasoning.value || toolSteps.value.length > 0) {
          const durationMs = turnStartedAt.value ? Date.now() - turnStartedAt.value : 0
          messages.value.push({
            id: msgId(),
            role: 'assistant',
            content: streamingContent.value || '(已中断)',
            reasoning: streamingReasoning.value || undefined,
            timestamp: Date.now(),
            streaming: false,
            toolSteps: toolSteps.value.length > 0 ? [...toolSteps.value] : undefined,
            durationMs: durationMs > 0 ? durationMs : undefined
          })
          persistHistory()
        }
        streamingContent.value = ''
        streamingReasoning.value = ''
        toolSteps.value = []
        resetStepProgress()
        turnStartedAt.value = null
        turnElapsedMs.value = 0
        isThinking.value = false
      } else if (data.type === 'error') {
        messages.value.push({
          id: msgId(),
          role: 'assistant',
          content: `❌ ${data.text}`,
          timestamp: Date.now(),
          error: true
        })
        streamingContent.value = ''
        streamingReasoning.value = ''
        toolSteps.value = []
        resetStepProgress()
        turnStartedAt.value = null
        turnElapsedMs.value = 0
        isThinking.value = false
        persistHistory()
      }
    })
  }

  async function loadConfig(): Promise<void> {
    try {
      const saved = localStorage.getItem('ai-config')
      if (saved) {
        const parsed = JSON.parse(saved)
        aiConfig.value = { ...DEFAULT_AI_CONFIG, ...parsed }
        // 旧配置无 maxSteps 时兜底
        if (!Number.isFinite(aiConfig.value.maxSteps) || aiConfig.value.maxSteps < 1) {
          aiConfig.value.maxSteps = DEFAULT_AI_CONFIG.maxSteps
        }
        // Kilo coding-agent defaults: lower temperature, fewer steps (speed)
        if ((aiConfig.value.temperature ?? 0.7) >= 0.6) {
          aiConfig.value.temperature = DEFAULT_AI_CONFIG.temperature
        }
        if ((aiConfig.value.maxSteps ?? 30) > 20) {
          aiConfig.value.maxSteps = DEFAULT_AI_CONFIG.maxSteps
        }
        aiConfig.value.maxSteps = Math.min(100, Math.max(1, Math.floor(aiConfig.value.maxSteps)))
        if (!aiConfig.value.reasoningEffort) {
          aiConfig.value.reasoningEffort = DEFAULT_AI_CONFIG.reasoningEffort
        }
      }
    } catch { /* ignore */ }
    // 恢复对话历史
    try {
      const sessRaw = localStorage.getItem('ai-chat-sessions')
      if (sessRaw) {
        const parsed = JSON.parse(sessRaw)
        if (Array.isArray(parsed)) {
          sessions.value = parsed
          // 恢复最近一个会话为当前
          if (parsed.length > 0) {
            const last = parsed[parsed.length - 1]
            activeSessionId.value = last.id
            messages.value = last.messages || []
          }
        }
      }
    } catch { /* ignore */ }
    setupStream()
  }

  function saveConfig(): void {
    localStorage.setItem('ai-config', JSON.stringify(aiConfig.value))
  }

  function persistSessions(): void {
    try {
      // 只保留最近 20 个会话
      const recent = sessions.value.slice(-20)
      localStorage.setItem('ai-chat-sessions', JSON.stringify(recent))
    } catch { /* ignore */ }
  }

  // 持久化当前会话到 sessions 列表
  function persistHistory(): void {
    if (messages.value.length === 0) return
    const title = messages.value.find((m) => m.role === 'user')?.content.slice(0, 40) || '新对话'
    const existing = sessions.value.find((s) => s.id === activeSessionId.value)
    if (existing) {
      existing.messages = [...messages.value]
      existing.title = title
      existing.updatedAt = Date.now()
    } else {
      const id = activeSessionId.value || `sess-${Date.now()}`
      activeSessionId.value = id
      sessions.value.push({
        id,
        title,
        messages: [...messages.value],
        updatedAt: Date.now()
      })
    }
    // 按更新时间排序，最近的在最后
    sessions.value.sort((a, b) => a.updatedAt - b.updatedAt)
    persistSessions()
  }

  // 开新会话：保留当前到历史，清空开始新的
  function startNewSession(): void {
    if (isThinking.value) return
    persistHistory()
    messages.value = []
    streamingContent.value = ''
    streamingReasoning.value = ''
    toolSteps.value = []
    activeSessionId.value = null
  }

  // 切换到历史会话
  function switchSession(id: string): void {
    if (isThinking.value) return
    persistHistory()
    const sess = sessions.value.find((s) => s.id === id)
    if (!sess) return
    activeSessionId.value = id
    messages.value = [...sess.messages]
    streamingContent.value = ''
    streamingReasoning.value = ''
    toolSteps.value = []
  }

  // 删除历史会话
  function deleteSession(id: string): void {
    sessions.value = sessions.value.filter((s) => s.id !== id)
    if (activeSessionId.value === id) {
      activeSessionId.value = null
      messages.value = []
    }
    persistSessions()
  }

  // 构建工作区上下文描述
  async function buildWorkspaceContext(): Promise<string> {
    const docStore = (await import('./docs')).useDocStore()
    const compileStore = (await import('./compile')).useCompileStore()

    const lines: string[] = []

    // 工作区根目录
    if (docStore.projectRoot) {
      lines.push(`## 工作区信息`)
      lines.push(`工作区根目录: ${docStore.projectRoot}`)
      lines.push('')
    }

    // 打开的文件标签
    if (docStore.tabs.length > 0) {
      lines.push('## 当前打开的文件')
      for (const tab of docStore.tabs) {
        const marker = tab.path === docStore.activeTabId ? ' (当前编辑)' : ''
        lines.push(`- ${tab.name}${tab.path ? ` → ${tab.path}` : ' (未保存)'}${marker}`)
      }
      lines.push('')
    }

    // 当前编辑的文件
    const activeTab = docStore.activeTab
    if (activeTab?.path) {
      lines.push(`## 当前编辑文件`)
      lines.push(`路径: ${activeTab.path}`)
      lines.push(`共 ${activeTab.content.split('\n').length} 行`)
      lines.push('')
    }

    // 主文档
    if (docStore.mainTexPath) {
      lines.push(`主文档 (编译入口): ${docStore.mainTexPath}`)
      lines.push('')
    }

    // TeX Live
    lines.push(`TeX Live: ${compileStore.texLiveFound ? '已检测到' : '未检测到'}`)
    if (compileStore.texLivePath) {
      lines.push(`路径: ${compileStore.texLivePath}`)
    }

    return lines.join('\n')
  }

  async function send(userMessage: string, fileContext?: string): Promise<void> {
    if (!userMessage.trim() || isThinking.value) return
    if (!aiConfig.value.apiKey) {
      messages.value.push({
        id: msgId(),
        role: 'assistant',
        content: '⚠️ 请先在设置中配置墨灵的 API Key。\n\n点击右上角「设置」→「墨灵 AI 助手」填入 API 地址、Key 和模型名称。',
        timestamp: Date.now(),
        error: true
      })
      return
    }

    setupStream()

    const userMsg: ChatMessage = {
      id: msgId(),
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
      fileContext
    }
    messages.value.push(userMsg)
    persistHistory()

    isThinking.value = true
    streamingContent.value = ''
    streamingReasoning.value = ''
    toolSteps.value = []
    resetStepProgress()
    turnStartedAt.value = Date.now()
    turnElapsedMs.value = 0

    // 超时兜底：120 秒无任何流式/工具进展则复位。
    // 每次 step/tool/content/reasoning 事件都会 rearm，长任务不会被误杀。
    let safetyTimer: ReturnType<typeof setTimeout> | null = null
    let lastProgressAt = Date.now()
    const armSafetyTimer = () => {
      lastProgressAt = Date.now()
      if (safetyTimer) clearTimeout(safetyTimer)
      safetyTimer = setTimeout(() => {
        if (!isThinking.value) return
        // 120s 内无新事件 → 判定卡死
        if (Date.now() - lastProgressAt >= 119000) {
          messages.value.push({
            id: msgId(),
            role: 'assistant',
            content: '❌ 请求超时（120 秒无进展）。请检查 API 地址、Key、模型名，或稍后重试。',
            timestamp: Date.now(),
            error: true
          })
          isThinking.value = false
          persistHistory()
        }
      }, 120000)
    }
    armSafetyTimer()
    // 步进/工具有进展时续期，防止长任务被误杀
    const rearmUnsub = window.electronAPI.onAiStream((d: any) => {
      if (d.type === 'step' || d.type === 'tool_call' || d.type === 'tool_result' || d.type === 'content' || d.type === 'reasoning' || d.type === 'done' || d.type === 'error' || d.type === 'cancelled') {
        armSafetyTimer()
      }
    })

    try {
      // Kilo Code system assembly: soul + tone/tool policy + workspace (short, no essay)
      const wsContext = await buildWorkspaceContext()
      const systemPrompt = [
        'You are 墨灵 (MoLing), a highly skilled LaTeX writing engineer on the user\'s machine.',
        '',
        '# Personality',
        '- Accomplish the user\'s task; do NOT engage in back-and-forth conversation.',
        '- Work iteratively with tools. Do not ask for more information than necessary.',
        '- NEVER start replies with "Great/Certainly/Okay/Sure". Be direct.',
        '- NEVER end with a question. After a short edit, just stop.',
        '',
        '# Tone',
        '- Minimize output tokens. No preamble/postamble. 1–2 sentences after an edit is enough.',
        '- Reply in Chinese if the user writes Chinese; keep tool arguments exact.',
        '',
        '# Tool usage policy',
        '- Prefer `edit` (exact oldString→newString). Use `write` only for full-file rewrite.',
        '- User gave line numbers/selection → call `edit` immediately; do NOT read first unless oldString is uncertain.',
        '- Batch independent tool calls in one response (parallel).',
        '- After edit, stop. Call `compile_document` only if user asked to compile/verify.',
        '- edit: filePath, oldString, newString, replaceAll. oldString must match file exactly.',
        '- read: filePath, offset, limit — returns `<line>: <content>`.',
        '',
        wsContext ? `# Workspace\n\n${wsContext}` : '',
        aiConfig.value.systemPrompt ? `# App note\n\n${aiConfig.value.systemPrompt}` : ''
      ]
        .filter(Boolean)
        .join('\n')

      const apiMessages: any[] = [{ role: 'system', content: systemPrompt }]

      for (const m of messages.value.slice(-20).filter((m) => !m.error)) {
        let content = m.content
        if (m.fileContext) {
          content = `${m.fileContext}\n\n${content}`
        }
        if (m.role === 'user' && m.content.includes('选中文本')) {
          content = `【用户已选中文本，附带行号。请直接用 edit 工具修改，禁止 read / list_files / search_project / get_outline。】\n\n${content}`
        }
        apiMessages.push({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content
        })
      }

      const rp = reasoningParams(aiConfig.value.reasoningEffort || 'low')
      const result = await window.electronAPI.aiChat({
        apiKey: aiConfig.value.apiKey,
        apiBase: aiConfig.value.apiBase,
        model: aiConfig.value.model,
        messages: apiMessages,
        temperature: rp.temperature,
        reasoningEffort: rp.reasoningEffort,
        workspaceRoot: (await import('./docs')).useDocStore().projectRoot,
        texlivePath: (await import('./compile')).useCompileStore().texLivePath,
        enableTools: true,
        permissionMode: aiConfig.value.permissionMode,
        maxSteps: aiConfig.value.maxSteps
      })

      // IPC 返回失败且流式未推送错误时，兜底显示错误并复位
      if (result && result.success === false) {
        if (!streamingContent.value && !messages.value.some((m) => m.error && m.timestamp > userMsg.timestamp - 1000)) {
          messages.value.push({
            id: msgId(),
            role: 'assistant',
            content: `❌ ${result.error || '请求失败'}`,
            timestamp: Date.now(),
            error: true
          })
        }
        isThinking.value = false
        streamingContent.value = ''
        streamingReasoning.value = ''
        toolSteps.value = []
      }
    } catch (err: any) {
      messages.value.push({
        id: msgId(),
        role: 'assistant',
        content: `❌ 请求异常: ${err.message}`,
        timestamp: Date.now(),
        error: true
      })
      isThinking.value = false
    } finally {
      if (safetyTimer) clearTimeout(safetyTimer)
      rearmUnsub()
    }
  }

  async function analyzeCompileError(log: string): Promise<void> {
    const prompt = `以下是我的 LaTeX 编译日志，请分析错误原因并给出修复建议。如果需要修改文件，请先读取文件内容：\n\n\`\`\`\n${log.slice(0, 3000)}\n\`\`\``
    await send(prompt)
  }

  function clearChat(): void {
    persistHistory()
    messages.value = []
    streamingContent.value = ''
    streamingReasoning.value = ''
    toolSteps.value = []
    activeSessionId.value = null
  }

  function parseEditProposal(content: string): EditProposal[] {
    const proposals: EditProposal[] = []
    const re = /\[FIND\]([\s\S]*?)\[\/FIND\]\s*\[REPLACE\]([\s\S]*?)\[\/REPLACE\]/g
    let m: RegExpExecArray | null
    while ((m = re.exec(content))) {
      proposals.push({ find: m[1].trim(), replace: m[2].trim(), applied: false })
    }
    return proposals
  }

  function applyEdit(find: string, replace: string): void {
    window.dispatchEvent(new CustomEvent('apply-edit', { detail: { find, replace } }))
  }

  function msgId(): string {
    return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  }

  return {
    aiConfig,
    messages,
    sessions,
    activeSessionId,
    isThinking,
    showPanel,
    streamingContent,
    streamingReasoning,
    toolSteps,
    stepCurrent,
    stepMax,
    stepIsFinal,
    turnStartedAt,
    turnElapsedMs,
    pendingWrite,
    cancelled,
    cancelStream,
    loadConfig,
    saveConfig,
    persistHistory,
    startNewSession,
    switchSession,
    deleteSession,
    send,
    analyzeCompileError,
    clearChat,
    parseEditProposal,
    applyEdit,
    buildWorkspaceContext
  }
})
