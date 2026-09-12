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
}

export interface ToolStep {
  id: string
  toolName: string
  args: string
  result?: string
  success?: boolean
  status: 'running' | 'done'
}

export interface AiConfig {
  apiBase: string
  apiKey: string
  model: string
  selectedModels: string[]
  systemPrompt: string
  temperature: number
  maxTokens: number
  permissionMode: 'ask' | 'full'
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
  systemPrompt: '你是「墨灵」，一个专业的 LaTeX 写作助手，集成在用户的 LaTeX 编辑器中。你可以读取、搜索、修改项目文件，并编译 LaTeX 文档。\n\n回答规范：使用 Markdown 格式，LaTeX 代码用 ```latex 代码块。数学公式用 $...$ 或 $$...$$。回答简洁专业，中文优先。',
  temperature: 0.7,
  maxTokens: 4096,
  permissionMode: 'ask'
}

let streamUnsubscribe: (() => void) | null = null

export const useAiStore = defineStore('ai', () => {
  const aiConfig: Ref<AiConfig> = ref({ ...DEFAULT_AI_CONFIG })
  const messages: Ref<ChatMessage[]> = ref([])
  const isThinking: Ref<boolean> = ref(false)
  const showPanel: Ref<boolean> = ref(false)
  const streamingContent: Ref<string> = ref('')
  const streamingReasoning: Ref<string> = ref('')
  const toolSteps: Ref<ToolStep[]> = ref([])
  const cancelled: Ref<boolean> = ref(false)
  // 待批准的写操作
  const pendingWrite: Ref<{ toolName: string; args: string; resolve: (approved: boolean) => void } | null> = ref(null)

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
  }

  function setupStream() {
    if (streamUnsubscribe) return
    streamUnsubscribe = window.electronAPI.onAiStream((data: any) => {
      if (data.type === 'reasoning') {
        streamingReasoning.value += data.text || ''
      } else if (data.type === 'content') {
        streamingContent.value += data.text || ''
      } else if (data.type === 'tool_call') {
        toolSteps.value.push({
          id: `tool-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          toolName: data.toolName || 'unknown',
          args: data.args || '',
          status: 'running'
        })
      } else if (data.type === 'tool_result') {
        const step = toolSteps.value.find((s) => s.toolName === data.toolName && s.status === 'running')
        if (step) {
          step.result = data.result
          step.success = data.success
          step.status = 'done'
        }
      } else if (data.type === 'done') {
        const msg: ChatMessage = {
          id: msgId(),
          role: 'assistant',
          content: streamingContent.value,
          reasoning: streamingReasoning.value || undefined,
          timestamp: Date.now(),
          streaming: false,
          toolSteps: toolSteps.value.length > 0 ? [...toolSteps.value] : undefined
        }
        messages.value.push(msg)
        streamingContent.value = ''
        streamingReasoning.value = ''
        toolSteps.value = []
        isThinking.value = false
      } else if (data.type === 'cancelled') {
        // 中断：保存已有内容
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
        isThinking.value = false
      }
    })
  }

  async function loadConfig(): Promise<void> {
    try {
      const saved = localStorage.getItem('ai-config')
      if (saved) {
        aiConfig.value = { ...DEFAULT_AI_CONFIG, ...JSON.parse(saved) }
      }
    } catch { /* ignore */ }
    setupStream()
  }

  function saveConfig(): void {
    localStorage.setItem('ai-config', JSON.stringify(aiConfig.value))
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

    isThinking.value = true
    streamingContent.value = ''
    streamingReasoning.value = ''
    toolSteps.value = []

    try {
      // 构建完整系统提示词（含工作区上下文）
      const wsContext = await buildWorkspaceContext()
      const systemPrompt = `${aiConfig.value.systemPrompt}

${wsContext}

## 可用工具

你可以使用以下工具操作项目：

### read_file
读取指定路径的文件内容。参数: path (完整文件路径)
当用户提到某个文件或你需要查看文件内容时使用。

### write_file
将完整内容写入指定文件（覆盖原文件）。参数: path, content
**仅在需要完全重写文件时使用。** 修改前必须先用 read_file 读取原文件。

### replace_text
在文件中查找并替换指定文本片段。参数: path, find, replace, replace_all (可选)
**这是修改文件的首选工具。** 只需提供要查找的原文和替换后的新文，无需重写整个文件。
- find 必须与文件内容完全匹配（包括空格和换行）
- 适合修改特定句子、段落、命令
- 修改前可用 get_outline 定位目标位置

### list_files
列出目录中的文件。参数: path (目录路径，可选，默认工作区根目录)

### search_project
在项目中搜索关键词。参数: query (搜索词), file_pattern (可选，如 *.tex)

### get_outline
获取 .tex 文件的章节大纲。参数: path

### compile_document
编译 LaTeX 文档。参数: path

## 工作规则

1. **行号定位（最重要）**：当用户选中文本发送给你时，消息中会标注 [选中文本，来自文件: 路径, 行范围: N-M]。你**不需要**重新读取整个文件。直接基于行号范围定位即可。

2. **修改文件（优先用 replace_text）**：
   - 修改特定文本/段落 → 用 **replace_text**（只需提供 find 和 replace，高效精准）
   - 需要大范围重写 → 用 write_file
   - 如果不确定要替换的准确文本，先用 read_file 查看目标行号附近的几行

3. **写入 .tex 文件时**保留原有格式和注释。

4. **如果不确定文件路径**，先用 search_project 或 list_files 查找。

5. **效率优先**：能用 replace_text 的不要 write_file；能通过行号定位的不要全文读取；能通过 search_project 定位的不要盲目浏览目录。`

      const apiMessages: any[] = [
        { role: 'system', content: systemPrompt }
      ]

      // 构建对话历史
      for (const m of messages.value.slice(-20).filter((m) => !m.error)) {
        let content = m.content
        if (m.fileContext) {
          content = `${m.fileContext}\n\n${content}`
        }
        apiMessages.push({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content
        })
      }

      await window.electronAPI.aiChat({
        apiKey: aiConfig.value.apiKey,
        apiBase: aiConfig.value.apiBase,
        model: aiConfig.value.model,
        messages: apiMessages,
        temperature: aiConfig.value.temperature,
        maxTokens: aiConfig.value.maxTokens,
        workspaceRoot: (await import('./docs')).useDocStore().projectRoot,
        texlivePath: (await import('./compile')).useCompileStore().texLivePath,
        enableTools: true,
        permissionMode: aiConfig.value.permissionMode
      })
    } catch (err: any) {
      messages.value.push({
        id: msgId(),
        role: 'assistant',
        content: `❌ 请求异常: ${err.message}`,
        timestamp: Date.now(),
        error: true
      })
      isThinking.value = false
    }
  }

  async function analyzeCompileError(log: string): Promise<void> {
    const prompt = `以下是我的 LaTeX 编译日志，请分析错误原因并给出修复建议。如果需要修改文件，请先读取文件内容：\n\n\`\`\`\n${log.slice(0, 3000)}\n\`\`\``
    await send(prompt)
  }

  function clearChat(): void {
    messages.value = []
    streamingContent.value = ''
    streamingReasoning.value = ''
    toolSteps.value = []
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
    isThinking,
    showPanel,
    streamingContent,
    streamingReasoning,
    toolSteps,
    pendingWrite,
    cancelled,
    cancelStream,
    loadConfig,
    saveConfig,
    send,
    analyzeCompileError,
    clearChat,
    parseEditProposal,
    applyEdit,
    buildWorkspaceContext
  }
})
