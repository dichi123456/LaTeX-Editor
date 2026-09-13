<script setup lang="ts">
import { ref, watch, nextTick, computed, onMounted, onUnmounted } from 'vue'
import { useAiStore } from '../stores/ai'
import type { ToolStep } from '../stores/ai'
import { useCompileStore } from '../stores/compile'
import { renderMarkdown } from '../utils/markdown'

const aiStore = useAiStore()
const compileStore = useCompileStore()

const inputText = ref('')
const chatBodyRef = ref<HTMLElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const attachedFiles = ref<Array<{ name: string; type: string; content: string; isImage: boolean; isSelection?: boolean; filePath?: string; lineRange?: string }>>([])

// 模型切换
const showModelMenu = ref(false)
const availableModels = computed(() => {
  const sel = aiStore.aiConfig.selectedModels
  return sel.length > 0 ? sel : [aiStore.aiConfig.model]
})

function switchModel(model: string) {
  aiStore.aiConfig.model = model
  aiStore.saveConfig()
  showModelMenu.value = false
}

function closeModelMenu(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (!target.closest('.model-switcher')) {
    showModelMenu.value = false
  }
}

function togglePermission() {
  aiStore.aiConfig.permissionMode = aiStore.aiConfig.permissionMode === 'ask' ? 'full' : 'ask'
  aiStore.saveConfig()
}

function startNewChat() {
  if (aiStore.isThinking) aiStore.cancelStream()
  aiStore.startNewSession()
  showHistory.value = false
}

// 会话历史
const showHistory = ref(false)

// 上下文余量估算：按字符数粗略折算 token（中文 ~0.6 token/字，英文 ~0.25）
const CONTEXT_LIMIT = 64000
const ctxUsage = computed(() => {
  let chars = 0
  for (const m of aiStore.messages) {
    chars += (m.content || '').length
    if (m.fileContext) chars += m.fileContext.length
    if (m.reasoning) chars += m.reasoning.length
  }
  // 粗略 token 估算
  const tokens = Math.round(chars * 0.5)
  const usedPct = Math.min(100, Math.round((tokens / CONTEXT_LIMIT) * 100))
  return { tokens, usedPct, remain: Math.max(0, CONTEXT_LIMIT - tokens) }
})

const ctxLabel = computed(() => {
  if (ctxUsage.value.usedPct < 1) return '上下文充足'
  if (ctxUsage.value.usedPct < 50) return `上下文 ${ctxUsage.value.usedPct}%`
  if (ctxUsage.value.usedPct < 80) return `上下文偏多 ${ctxUsage.value.usedPct}%`
  return `上下文将满 ${ctxUsage.value.usedPct}%`
})

const ctxDash = computed(() => {
  const c = 2 * Math.PI * 7
  return `${(ctxUsage.value.usedPct / 100) * c} ${c}`
})

const streamHtml = computed(() => {
  if (!aiStore.streamingContent) return ''
  return renderMarkdown(aiStore.streamingContent) + '<span class="type-cursor"></span>'
})

const ctxColor = computed(() => {
  if (ctxUsage.value.usedPct >= 80) return 'var(--error)'
  if (ctxUsage.value.usedPct >= 50) return 'var(--warning)'
  return 'var(--accent)'
})

function toolFileLabel(step: ToolStep): string {
  try {
    const args = JSON.parse(step.args)
    if (args.path) {
      const parts = String(args.path).split(/[\\/]/)
      return parts.slice(-2).join('/')
    }
  } catch { /* ignore */ }
  return ''
}

function toolChangeBadge(step: ToolStep): string {
  if (step.toolName !== 'replace_text' && step.toolName !== 'write_file') return ''
  try {
    const args = JSON.parse(step.args)
    if (step.toolName === 'replace_text' && args.find && args.replace) {
      const a = String(args.find).split('\n').length
      const b = String(args.replace).split('\n').length
      const d = b - a
      if (d > 0) return `+${d}`
      if (d < 0) return `${d}`
      return ''
    }
    if (step.toolName === 'write_file' && args.content) {
      return `+${String(args.content).split('\n').length}`
    }
  } catch { /* ignore */ }
  return ''
}

// 滚动控制：用户手动上滑时不强制滚动
const userScrolledUp = ref(false)
let scrollRaf: number | null = null

function checkScroll() {
  const el = chatBodyRef.value
  if (!el) return
  const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
  userScrolledUp.value = distFromBottom > 80
}

function scrollToBottom(force = false) {
  if (userScrolledUp.value && !force) return
  if (scrollRaf) cancelAnimationFrame(scrollRaf)
  scrollRaf = requestAnimationFrame(() => {
    const el = chatBodyRef.value
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  })
}

// 思考过程折叠状态
const reasoningExpanded = ref(false)

// 接收编辑器发送的文本 → 作为附件 chip
function onMolingPrefill(e: Event) {
  const detail = (e as CustomEvent).detail
  if (detail?.text) {
    attachedFiles.value.push({
      name: detail.fileName || '选中文本',
      type: 'text/selection',
      content: detail.text,
      isImage: false,
      isSelection: true,
      filePath: detail.filePath,
      lineRange: detail.lineRange
    })
  }
}

// 芯片显示标签：文件名 · 类型 · 行号（Codex 风格）
function chipLabel(f: typeof attachedFiles.value[0]): string {
  if (f.isSelection) {
    const base = f.name || '选中文本'
    const ext = f.filePath ? (f.filePath.split('.').pop() || '').toUpperCase() : 'TEX'
    const line = f.lineRange ? ` · ${String(f.lineRange).split('-')[0]}` : ''
    return `${base} · ${ext}${line}`
  }
  if (f.isImage) {
    return '剪贴板图片'
  }
  return f.name
}

// 用户消息上方引用标签：精简为 文件名 · 类型 · 行号
function formatUserRef(ctx: string): string {
  // 格式如：用户操作的文件: E:\path\file.tex
  const m = ctx.match(/用户操作的文件:\s*(.+)/)
  if (m) {
    const p = m[1].trim()
    const name = p.split(/[\\/]/).pop() || p
    const ext = (p.split('.').pop() || '').toUpperCase()
    return `${name} · ${ext}`
  }
  return ctx
}

// 粘贴剪贴板图片
function onPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of Array.from(items)) {
    if (item.type.startsWith('image/')) {
      e.preventDefault()
      const file = item.getAsFile()
      if (!file) continue
      const reader = new FileReader()
      reader.onload = () => {
        attachedFiles.value.push({
          name: `剪贴板图片-${Date.now()}.png`,
          type: file.type,
          content: reader.result as string,
          isImage: true
        })
      }
      reader.readAsDataURL(file)
    }
  }
}

async function send() {
  let text = inputText.value.trim()
  if ((!text && attachedFiles.value.length === 0) || aiStore.isThinking) return

  // 构建文件上下文（告诉 AI 选中文本来自哪个文件）
  let fileContext = ''
  if (attachedFiles.value.length > 0) {
    const fileParts = attachedFiles.value.map((f) => {
      if (f.isSelection) {
        const lineInfo = (f as any).lineRange ? `, 行范围: ${(f as any).lineRange}` : ''
        const ctx = (f as any).filePath ? `[选中文本，来自文件: ${(f as any).filePath}${lineInfo}]` : '[选中文本]'
        return `${ctx}：\n\`\`\`\n${f.content}\n\`\`\``
      }
      if (f.isImage) {
        return `[图片: ${f.name}]\n![](${f.content})`
      }
      return `[文件: ${f.name}]\n\`\`\`\n${f.content.slice(0, 3000)}\n\`\`\``
    })
    const paths = attachedFiles.value
      .filter((f: any) => f.filePath)
      .map((f: any) => f.filePath)
    if (paths.length > 0) {
      fileContext = `用户操作的文件: ${paths.join(', ')}`
    }
    text = text ? `${text}\n\n${fileParts.join('\n\n')}` : fileParts.join('\n\n')
    attachedFiles.value = []
  }

  inputText.value = ''
  await aiStore.send(text, fileContext || undefined)
  scrollToBottom()
}

// 文件上传
function triggerFileUpload() {
  fileInputRef.value?.click()
}

async function onFileSelected(e: Event) {
  const input = e.target as HTMLInputElement
  const files = input.files
  if (!files) return

  for (const file of Array.from(files)) {
    if (file.size > 10 * 1024 * 1024) {
      attachedFiles.value.push({
        name: file.name,
        type: file.type,
        content: `[文件过大，无法读取: ${file.name}]`,
        isImage: false
      })
      continue
    }

    if (file.type.startsWith('image/')) {
      // 图片 → base64
      const reader = new FileReader()
      reader.onload = () => {
        attachedFiles.value.push({
          name: file.name,
          type: file.type,
          content: reader.result as string,
          isImage: true
        })
      }
      reader.readAsDataURL(file)
    } else {
      // 文本文件 → 读取内容
      const reader = new FileReader()
      reader.onload = () => {
        attachedFiles.value.push({
          name: file.name,
          type: file.type,
          content: String(reader.result || ''),
          isImage: false
        })
      }
      reader.readAsText(file)
    }
  }
  input.value = ''
}

function removeFile(idx: number) {
  attachedFiles.value.splice(idx, 1)
}

async function analyzeErrors() {
  const log = compileStore.lastResult?.log || ''
  if (!log) {
    aiStore.messages.push({
      id: `tip-${Date.now()}`,
      role: 'assistant',
      content: '暂无编译日志。请先编译文档，然后点击「分析错误」。',
      timestamp: Date.now(),
      error: true
    })
    scrollToBottom()
    return
  }
  await aiStore.analyzeCompileError(log)
  scrollToBottom()
}

function insertToEditor(text: string) {
  const codeMatch = text.match(/```(?:latex)?\n([\s\S]*?)```/g)
  const code = codeMatch
    ? codeMatch.map((m) => m.replace(/```(?:latex)?\n?/g, '').replace(/```$/, '').trim()).join('\n\n')
    : text
  window.dispatchEvent(new CustomEvent('insert-text', { detail: { text: code } }))
}

// 编辑用户消息：气泡内原地编辑
const editingMsgId = ref<string | null>(null)
const editingText = ref('')

function editUserMsg(msg: { id: string; content: string }) {
  if (aiStore.isThinking) return
  editingMsgId.value = msg.id
  editingText.value = cleanUserContent(msg.content)
  nextTick(() => {
    const ta = document.getElementById(`edit-${msg.id}`) as HTMLTextAreaElement | null
    ta?.focus()
  })
}

function cancelEditUserMsg() {
  editingMsgId.value = null
  editingText.value = ''
}

async function saveEditUserMsg(msg: { id: string }) {
  if (!editingText.value.trim()) return
  const newContent = editingText.value
  // 找到该消息在数组中的索引，删除该条及之后所有消息（重新开始对话）
  const idx = aiStore.messages.findIndex((m) => m.id === msg.id)
  if (idx === -1) return
  // 更新该条消息内容
  aiStore.messages[idx].content = newContent
  // 删除该消息之后的所有消息（AI 回复等）
  aiStore.messages.splice(idx + 1)
  aiStore.persistHistory()
  editingMsgId.value = null
  editingText.value = ''
  // 重新发送
  await aiStore.send(newContent, aiStore.messages[idx].fileContext)
  scrollToBottom()
}

// 复制用户消息
async function copyUserMsg(msg: { content: string }) {
  try {
    await navigator.clipboard.writeText(cleanUserContent(msg.content))
  } catch { /* ignore */ }
}

function extractCode(content: string): string | null {
  const m = content.match(/```(?:latex)?\n([\s\S]*?)```/)
  return m ? m[1].trim() : null
}

function getEditProposals(content: string) {
  return aiStore.parseEditProposal(content)
}

function applyProposal(find: string, replace: string) {
  aiStore.applyEdit(find, replace)
}

// 清理用户消息内容：去掉代码块标记和文件路径前缀
function cleanUserContent(content: string): string {
  let text = content
  // 去掉 [选中文本，来自文件: xxx, 行范围: xxx]：\n```...\n``` 格式
  text = text.replace(/\[选中文本[^\]]*\]：\s*\n?```[\s\S]*?```/g, '').trim()
  // 去掉 [文件: xxx]\n```...\n``` 格式
  text = text.replace(/\[文件:[^\]]*\]\s*\n?```[\s\S]*?```/g, '').trim()
  // 去掉 [图片: xxx] 格式
  text = text.replace(/\[图片:[^\]]*\]/g, '').trim()
  // 去掉残留的代码块标记
  text = text.replace(/```(?:latex|tex)?\n?/g, '').replace(/```/g, '').trim()
  return text || content
}

const hasStreaming = computed(() => aiStore.isThinking || aiStore.toolSteps.length > 0 || !!aiStore.streamingContent || !!aiStore.streamingReasoning)

function renderMd(text: string): string {
  return renderMarkdown(text)
}

watch(
  () => [aiStore.messages.length, aiStore.streamingContent, aiStore.streamingReasoning, aiStore.toolSteps.length, aiStore.isThinking],
  () => scrollToBottom()
)

function onScroll() {
  checkScroll()
}

function toggleReasoning() {
  reasoningExpanded.value = !reasoningExpanded.value
}

function toolLabel(name: string): string {
  const map: Record<string, string> = {
    read_file: '读取文件',
    write_file: '写入文件',
    replace_text: '替换文本',
    list_files: '列出文件',
    search_project: '搜索项目',
    get_outline: '获取大纲',
    compile_document: '编译文档'
  }
  return map[name] || name
}

// ===== Agent 风格执行流 =====
interface ToolGroup {
  key: string
  toolName: string
  label: string
  count: number
  running: boolean
  failed: boolean
  steps: ToolStep[]
}

function groupTools(steps: ToolStep[] | undefined): ToolGroup[] {
  if (!steps || steps.length === 0) return []
  const groups: ToolGroup[] = []
  for (const s of steps) {
    const last = groups[groups.length - 1]
    if (last && last.toolName === s.toolName) {
      last.count++
      last.steps.push(s)
      if (s.status === 'running') last.running = true
      if (s.success === false) last.failed = true
    } else {
      groups.push({
        key: `${s.toolName}-${s.id}`,
        toolName: s.toolName,
        label: toolLabel(s.toolName),
        count: 1,
        running: s.status === 'running',
        failed: s.success === false,
        steps: [s]
      })
    }
  }
  return groups
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rs = s % 60
  return rs > 0 ? `${m}m ${rs}s` : `${m}m`
}

const streamElapsed = ref(0)
let elapsedTimer: ReturnType<typeof setInterval> | null = null
watch(
  () => aiStore.isThinking,
  (on) => {
    if (on && aiStore.turnStartedAt) {
      streamElapsed.value = 0
      elapsedTimer = setInterval(() => {
        streamElapsed.value = Date.now() - (aiStore.turnStartedAt || Date.now())
      }, 500)
    } else {
      if (elapsedTimer) clearInterval(elapsedTimer)
      elapsedTimer = null
      streamElapsed.value = 0
    }
  }
)
onUnmounted(() => {
  if (elapsedTimer) clearInterval(elapsedTimer)
})

const expandedTools = ref<Set<string>>(new Set())
function toggleToolExpand(key: string) {
  if (expandedTools.value.has(key)) expandedTools.value.delete(key)
  else expandedTools.value.add(key)
}

function toolIconSvg(name: string): string {
  const icons: Record<string, string> = {
    read_file: '<rect x="2" y="2" width="10" height="12" rx="1.5" stroke="currentColor" stroke-width="1.2" fill="none"/><path d="M5 5h4M5 7.5h4M5 10h3" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>',
    write_file: '<path d="M3 11.5V13h1.5L11.5 6 10 4.5 3 11.5z" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linejoin="round"/>',
    replace_text: '<path d="M3 5h6M3 8h4M3 11h5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M10 4l2 2-2 2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>',
    list_files: '<path d="M2 4h4l1 1.5h5V12H2V4z" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linejoin="round"/>',
    search_project: '<circle cx="6.5" cy="6.5" r="3.5" stroke="currentColor" stroke-width="1.2" fill="none"/><path d="M9.5 9.5L12.5 12.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>',
    get_outline: '<path d="M3 4h10M3 7h8M3 10h6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>',
    compile_document: '<path d="M4 3l8 5-8 5V3z" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linejoin="round"/>'
  }
  return icons[name] || icons.read_file
}

onMounted(() => {
  window.addEventListener('moling-prefill', onMolingPrefill)
  document.addEventListener('click', closeModelMenu)
  nextTick(() => {
    chatBodyRef.value?.addEventListener('scroll', onScroll, { passive: true })
  })
})

onUnmounted(() => {
  window.removeEventListener('moling-prefill', onMolingPrefill)
  document.removeEventListener('click', closeModelMenu)
  chatBodyRef.value?.removeEventListener('scroll', onScroll)
  if (scrollRaf) cancelAnimationFrame(scrollRaf)
})
</script>

<template>
  <div class="ai-panel">
    <div class="ai-header">
      <span class="ai-title">墨灵</span>
      <div class="ai-header-actions">
        <button class="ai-h-btn" title="分析编译错误" @click="analyzeErrors">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.2"/>
            <line x1="7" y1="4" x2="7" y2="8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
            <circle cx="7" cy="10" r="0.8" fill="currentColor"/>
          </svg>
        </button>
        <!-- 历史会话：时钟图标 → 二级页 -->
        <button class="ai-h-btn" :class="{ active: showHistory }" title="历史会话" @click="showHistory = true">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.2"/>
            <polyline points="7,4 7,7 9.5,8.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
          </svg>
        </button>
        <button class="ai-h-btn" title="清空对话" @click="aiStore.clearChat">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M4 4l6 6M10 4l-6 6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- 历史会话：二级页 -->
    <div v-if="showHistory" class="session-page">
      <div class="session-page-header">
        <button class="back-btn" title="返回对话" @click="showHistory = false">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M9 3L5 7l4 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          返回
        </button>
        <span class="session-page-title">历史会话</span>
        <span class="session-page-count">{{ aiStore.sessions.length }}</span>
      </div>
      <div class="session-page-body">
        <div
          v-for="s in [...aiStore.sessions].reverse()"
          :key="s.id"
          class="session-item"
          :class="{ active: s.id === aiStore.activeSessionId }"
        >
          <button class="session-switch" @click="aiStore.switchSession(s.id); showHistory = false">
            <span class="session-title truncate">{{ s.title }}</span>
            <span class="session-time">{{ new Date(s.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }}</span>
          </button>
          <button class="session-del" title="删除" @click.stop="aiStore.deleteSession(s.id)">✕</button>
        </div>
        <div v-if="aiStore.sessions.length === 0" class="session-empty">暂无历史会话</div>
      </div>
    </div>

    <div ref="chatBodyRef" class="ai-body">
      <div v-if="aiStore.messages.length === 0 && !hasStreaming" class="ai-empty">
        <p>与墨灵对话，辅助 LaTeX 写作</p>
        <p class="ai-hint">
          点击顶部 ⓘ 分析编译错误<br />
          AI 返回的代码可一键插入编辑器
        </p>
      </div>

      <div
        v-for="msg in aiStore.messages"
        :key="msg.id"
        class="ai-msg"
        :class="msg.role"
      >
        <!-- 用户消息：引用文本在气泡上方 -->
        <template v-if="msg.role === 'user'">
          <div class="user-stack">
            <div class="user-ref" v-if="msg.fileContext">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <rect x="1" y="2" width="10" height="8" rx="1.5" stroke="currentColor" stroke-width="1"/>
                <line x1="3" y1="4.5" x2="9" y2="4.5" stroke="currentColor" stroke-width="0.8"/>
                <line x1="3" y1="6.5" x2="7" y2="6.5" stroke="currentColor" stroke-width="0.8"/>
              </svg>
              <span class="user-ref-text">{{ formatUserRef(msg.fileContext) }}</span>
            </div>
            <!-- 编辑态：气泡内原地编辑 -->
            <div v-if="editingMsgId === msg.id" class="msg-bubble editing">
              <textarea
                :id="`edit-${msg.id}`"
                v-model="editingText"
                class="inline-edit-input"
                rows="3"
                @keydown.escape="cancelEditUserMsg"
                @keydown.ctrl.enter.prevent="saveEditUserMsg(msg)"
              ></textarea>
              <div class="inline-edit-actions">
                <button class="ie-btn cancel" @click="cancelEditUserMsg">取消</button>
                <button class="ie-btn save" @click="saveEditUserMsg(msg)">发送</button>
              </div>
            </div>
            <!-- 展示态 -->
            <div v-else class="msg-bubble" :class="{ error: msg.error }">
              <span class="msg-text">{{ cleanUserContent(msg.content) }}</span>
            </div>
            <!-- 编辑 / 复制 按钮（编辑态隐藏） -->
            <div v-if="editingMsgId !== msg.id" class="user-actions">
              <button class="user-act-btn" title="编辑此消息" @click="editUserMsg(msg)">
                <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                  <path d="M10.5 1.5l2 2L5 11H3V9l7.5-7.5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
                </svg>
              </button>
              <button class="user-act-btn" title="复制" @click="copyUserMsg(msg)">
                <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                  <rect x="4.5" y="4.5" width="8" height="8" rx="1.2" stroke="currentColor" stroke-width="1.1"/>
                  <path d="M9.5 4.5V3.2A1.2 1.2 0 0 0 8.3 2H3.2A1.2 1.2 0 0 0 2 3.2v5.1A1.2 1.2 0 0 0 3.2 9.5H4.5" stroke="currentColor" stroke-width="1.1"/>
                </svg>
              </button>
            </div>
          </div>
        </template>

        <!-- AI 消息：无气泡，直接铺开 -->
        <template v-else>
        <div class="msg-plain" :class="{ error: msg.error }">
          <!-- 思考过程（默认折叠） -->
          <div v-if="msg.reasoning" class="reasoning-block" @click="reasoningExpanded = !reasoningExpanded">
            <div class="reasoning-toggle" :class="{ open: reasoningExpanded }">
              <span class="reasoning-arrow">{{ reasoningExpanded ? '▼' : '▶' }}</span>
              <span>思考过程（{{ msg.reasoning.length }} 字）</span>
            </div>
            <div v-if="reasoningExpanded" class="reasoning-content">{{ msg.reasoning }}</div>
          </div>

          <!-- Agent 执行流：图标列表 -->
          <div v-if="msg.toolSteps && msg.toolSteps.length > 0" class="agent-trace">
            <div class="agent-trace-header" @click="toggleToolExpand('msg-' + msg.id)">
              <span class="trace-chevron">{{ expandedTools.has('msg-' + msg.id) ? '▾' : '▸' }}</span>
              <span class="trace-label">已处理</span>
              <span class="trace-duration" v-if="msg.durationMs">{{ formatDuration(msg.durationMs) }}</span>
              <span class="trace-count">{{ msg.toolSteps.length }} 次工具调用</span>
            </div>
            <div v-if="expandedTools.has('msg-' + msg.id)" class="agent-trace-body">
              <div
                v-for="s in msg.toolSteps"
                :key="s.id"
                class="trace-row"
                :class="{ running: s.status === 'running', failed: s.success === false }"
              >
                <span class="trace-row-icon">
                  <span v-if="s.status === 'running'" class="chip-spinner"></span>
                  <svg v-else width="12" height="12" viewBox="0 0 16 16" fill="none" v-html="toolIconSvg(s.toolName)"></svg>
                </span>
                <span class="trace-row-text">
                  <span class="trace-action">已{{ toolLabel(s.toolName) }}</span>
                  <code v-if="toolFileLabel(s)" class="trace-file">{{ toolFileLabel(s) }}</code>
                  <span v-if="toolChangeBadge(s)" class="trace-badge" :class="toolChangeBadge(s).startsWith('+') ? 'add' : 'del'">{{ toolChangeBadge(s) }}</span>
                </span>
                <button
                  class="chip-expand"
                  @click.stop="toggleToolExpand(s.id)"
                  title="查看详情"
                >{{ expandedTools.has(s.id) ? '▾' : '▸' }}</button>
                <div v-if="expandedTools.has(s.id)" class="tool-chip-detail">
                  <code class="tool-args">{{ s.args.slice(0, 200) }}</code>
                  <div v-if="s.result" class="tool-result-box">{{ s.result.slice(0, 400) }}</div>
                </div>
              </div>
            </div>
          </div>

          <!-- 编辑提议 -->
          <div v-if="msg.role === 'assistant' && !msg.error && getEditProposals(msg.content).length > 0" class="edit-proposals">
            <div v-for="(p, i) in getEditProposals(msg.content)" :key="i" class="proposal-card">
              <div class="proposal-label">📝 文档修改提议</div>
              <div class="proposal-diff">
                <div class="diff-del">- {{ p.find.slice(0, 120) }}{{ p.find.length > 120 ? '…' : '' }}</div>
                <div class="diff-add">+ {{ p.replace.slice(0, 120) }}{{ p.replace.length > 120 ? '…' : '' }}</div>
              </div>
              <button class="apply-btn" @click="applyProposal(p.find, p.replace)">
                应用修改
              </button>
            </div>
          </div>
          <div v-if="msg.role === 'assistant' && !msg.error" class="msg-md" v-html="renderMarkdown(msg.content.replace(/\[FIND\][\s\S]*?\[\/FIND\]\s*\[REPLACE\][\s\S]*?\[\/REPLACE\]/g, '').trim())"></div>
          <pre v-else class="msg-text">{{ msg.content }}</pre>
          <button
            v-if="msg.role === 'assistant' && !msg.error && extractCode(msg.content)"
            class="insert-btn"
            @click="insertToEditor(msg.content)"
          >
            插入到编辑器
          </button>
        </div>
        </template>
      </div>

      <!-- 流式响应中：无气泡 -->
      <div v-if="aiStore.isThinking || hasStreaming || aiStore.toolSteps.length > 0" class="ai-msg assistant">
        <div class="msg-plain streaming">
          <!-- 处理中头部：耗时 -->
          <div class="agent-live-header">
            <span class="chip-spinner"></span>
            <span class="trace-label">已处理</span>
            <span class="trace-duration">{{ formatDuration(streamElapsed) }}</span>
          </div>

          <!-- 工具执行列表 -->
          <div v-if="aiStore.toolSteps.length > 0" class="agent-trace live">
            <div
              v-for="s in aiStore.toolSteps"
              :key="s.id"
              class="trace-row"
              :class="{ running: s.status === 'running', failed: s.success === false }"
            >
              <span class="trace-row-icon">
                <span v-if="s.status === 'running'" class="chip-spinner"></span>
                <svg v-else width="12" height="12" viewBox="0 0 16 16" fill="none" v-html="toolIconSvg(s.toolName)"></svg>
              </span>
              <span class="trace-row-text">
                <span class="trace-action">{{ s.status === 'running' ? toolLabel(s.toolName) + '…' : '已' + toolLabel(s.toolName) }}</span>
                <code v-if="toolFileLabel(s)" class="trace-file">{{ toolFileLabel(s) }}</code>
                <span v-if="toolChangeBadge(s)" class="trace-badge" :class="toolChangeBadge(s).startsWith('+') ? 'add' : 'del'">{{ toolChangeBadge(s) }}</span>
              </span>
            </div>
          </div>

          <!-- 思考过程：默认折叠 -->
          <div v-if="aiStore.streamingReasoning" class="reasoning-block" @click="toggleReasoning">
            <div class="reasoning-toggle" :class="{ open: reasoningExpanded }">
              <span class="reasoning-arrow">{{ reasoningExpanded ? '▼' : '▶' }}</span>
              <span>思考中</span>
              <span class="streaming-dot"></span>
            </div>
            <div v-if="reasoningExpanded" class="reasoning-content streaming-text">{{ aiStore.streamingReasoning }}</div>
          </div>
          <div v-if="aiStore.streamingContent" class="msg-md streaming-md" v-html="streamHtml"></div>
          <div v-if="!aiStore.streamingContent && !aiStore.streamingReasoning && aiStore.toolSteps.length === 0" class="thinking-line">
            <span class="streaming-dot"></span> 墨灵思考中…
          </div>
        </div>
      </div>
    </div>

    <!-- Codex 风格悬浮输入框 -->
    <div class="input-float-area">
      <!-- 新会话 -->
      <div class="new-chat-row">
        <button class="new-chat-btn" title="开启新对话（保留当前到历史）" @click="startNewChat">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <line x1="6" y1="2" x2="6" y2="10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
            <line x1="2" y1="6" x2="10" y2="6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
          </svg>
          新会话
        </button>
      </div>
      <div class="input-float-box" :class="{ focused: inputText.length > 0 || attachedFiles.length > 0 }">
        <!-- 附件芯片（框内顶部） -->
        <div v-if="attachedFiles.length > 0" class="chips-inside">
          <div v-for="(f, idx) in attachedFiles" :key="idx" class="chip-row" :class="{ selection: f.isSelection }">
            <svg v-if="f.isSelection" width="12" height="12" viewBox="0 0 14 14" fill="none">
              <rect x="1.5" y="2.5" width="11" height="9" rx="1.5" stroke="currentColor" stroke-width="1.1"/>
              <line x1="4" y1="5.5" x2="10" y2="5.5" stroke="currentColor" stroke-width="1"/>
              <line x1="4" y1="8" x2="8" y2="8" stroke="currentColor" stroke-width="1"/>
            </svg>
            <img v-else-if="f.isImage" :src="f.content" class="chip-thumb-sm" :alt="f.name" />
            <svg v-else width="12" height="12" viewBox="0 0 14 14" fill="none">
              <path d="M8 1.5H4a1.5 1.5 0 0 0-1.5 1.5v8A1.5 1.5 0 0 0 4 12.5h6a1.5 1.5 0 0 0 1.5-1.5V5L8 1.5z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>
              <path d="M8 1.5V5h3.5" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>
            </svg>
            <span class="chip-row-name">{{ chipLabel(f) }}</span>
            <button class="chip-row-remove" @click="removeFile(idx)">✕</button>
          </div>
        </div>

        <textarea
          v-model="inputText"
          class="float-input"
          placeholder="向墨灵提问…"
          rows="1"
          @keydown.enter.exact.prevent="send"
          @input="autoResize"
          @paste="onPaste"
        ></textarea>
        <div class="float-footer">
          <div class="float-left">
            <button class="attach-btn" title="上传文件 / 图片" @click="triggerFileUpload">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <line x1="7" y1="3" x2="7" y2="11" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
                <line x1="3" y1="7" x2="11" y2="7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
              </svg>
            </button>
            <!-- 权限切换：请求批准（手掌）/ 完全访问（盾牌） -->
            <button
              class="attach-btn perm-btn"
              :class="{ full: aiStore.aiConfig.permissionMode === 'full' }"
              :title="aiStore.aiConfig.permissionMode === 'ask' ? '请求批准：写操作前确认（点击切换为完全访问）' : '完全访问：自动执行写操作（点击切换为请求批准）'"
              @click="togglePermission"
            >
              <!-- 请求批准：手掌 -->
              <svg v-if="aiStore.aiConfig.permissionMode === 'ask'" width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M5 7.5V3.5a1 1 0 0 1 2 0V7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
                <path d="M7 7V2.5a1 1 0 0 1 2 0V7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
                <path d="M9 7.5V4a1 1 0 0 1 2 0v5.5a3.5 3.5 0 0 1-3.5 3.5H7a3.5 3.5 0 0 1-3.5-3.5V6.5a1 1 0 0 1 2 0V7.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <!-- 完全访问：盾牌 -->
              <svg v-else width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 1.5L11.5 3.5v3.2c0 2.8-1.9 5.2-4.5 5.8-2.6-.6-4.5-3-4.5-5.8V3.5L7 1.5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
                <path d="M5 7l1.5 1.5L9.5 5.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>
          <div class="float-right">
            <!-- 上下文余量：小圆环 -->
            <button
              class="ctx-ring-btn"
              :title="`当前会话约 ${ctxUsage.tokens} tokens，上限约 ${CONTEXT_LIMIT}，剩余约 ${ctxUsage.remain}`"
            >
              <svg width="18" height="18" viewBox="0 0 18 18">
                <circle cx="9" cy="9" r="7" fill="none" stroke="var(--border)" stroke-width="2"/>
                <circle
                  cx="9" cy="9" r="7"
                  fill="none"
                  :stroke="ctxColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  :stroke-dasharray="ctxDash"
                  transform="rotate(-90 9 9)"
                />
              </svg>
            </button>
            <!-- 模型切换 -->
            <div class="model-switcher" v-if="availableModels.length > 1">
              <button class="model-badge clickable" @click.stop="showModelMenu = !showModelMenu">
                {{ aiStore.aiConfig.model || '未配置' }}
                <span class="model-arrow">▾</span>
              </button>
              <div v-if="showModelMenu" class="model-menu">
                <button
                  v-for="m in availableModels"
                  :key="m"
                  class="model-menu-item"
                  :class="{ active: aiStore.aiConfig.model === m }"
                  @click="switchModel(m)"
                >
                  <span class="model-check" v-if="aiStore.aiConfig.model === m">✓</span>
                  <span class="model-check" v-else></span>
                  {{ m }}
                </button>
              </div>
            </div>
            <span v-else class="model-badge">
              {{ aiStore.aiConfig.model || '未配置' }}
            </span>
            <!-- 思考中：发送键变停止键 -->
            <button
              v-if="aiStore.isThinking"
              class="send-circle stop"
              title="停止生成"
              @click="aiStore.cancelStream()"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <rect x="2.5" y="2.5" width="7" height="7" rx="1" fill="currentColor"/>
              </svg>
            </button>
            <!-- 空闲：正常发送键 -->
            <button
              v-else
              class="send-circle"
              :disabled="!inputText.trim() && attachedFiles.length === 0"
              title="发送 (Enter)"
              @click="send"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <line x1="7" y1="11" x2="7" y2="3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                <polyline points="3.5,6.5 7,3 10.5,6.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
      <input ref="fileInputRef" type="file" multiple accept="image/*,.tex,.bib,.txt,.md,.sty,.cls,.log,.aux" style="display:none" @change="onFileSelected" />
    </div>
  </div>
</template>

<script lang="ts">
export default {
  methods: {
    autoResize(e: Event) {
      const el = e.target as HTMLTextAreaElement
      el.style.height = 'auto'
      el.style.height = Math.min(el.scrollHeight, 100) + 'px'
    }
  }
}
</script>

<style scoped>
.ai-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-secondary);
  font-size: 13px;
}

.ai-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 28px;
  padding: 0 12px;
  flex-shrink: 0;
  position: relative;
}
.ai-header::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 10px;
  right: 10px;
  height: 1px;
  background: var(--border);
}
.ai-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
}
.ai-header-actions {
  display: flex;
  gap: 2px;
}
.ai-h-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  border-radius: 3px;
  cursor: pointer;
  position: relative;
}
.ai-h-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.ai-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 10px;
  min-height: 0;
}

.ai-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  color: var(--text-tertiary);
  height: 100%;
  min-height: 120px;
  padding: 24px 16px;
  font-size: 12px;
  line-height: 1.8;
}
.ai-hint {
  margin-top: 8px;
  font-size: 11px;
  color: var(--text-tertiary);
}

/* 上下文圆环 */
.ctx-ring-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  background: transparent;
  cursor: default;
  flex-shrink: 0;
  border-radius: 8px;
}
.ctx-ring-btn:hover {
  background: var(--bg-hover);
}

/* 历史会话二级页 */
.session-page {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--bg-secondary);
}
.session-page-header {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 10px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.back-btn {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px 8px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  border-radius: 4px;
  cursor: pointer;
}
.back-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.session-page-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}
.session-page-count {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-tertiary);
}
.session-page-body {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}
.session-empty {
  padding: 24px 12px;
  text-align: center;
  font-size: 12px;
  color: var(--text-tertiary);
}
.ai-h-btn.active {
  background: var(--accent-light);
  color: var(--accent);
}
.hist-badge {
  position: absolute;
  top: 2px;
  right: 2px;
  min-width: 12px;
  height: 12px;
  padding: 0 3px;
  font-size: 9px;
  line-height: 12px;
  text-align: center;
  background: var(--accent);
  color: #fff;
  border-radius: 6px;
}

.ai-msg {
  margin-bottom: 10px;
  display: flex;
}
.ai-msg.user { justify-content: flex-end; }

/* 用户消息：引用标签 + 气泡垂直堆叠，右对齐 */
.user-stack {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  max-width: 90%;
  gap: 4px;
}

/* 引用标签：短小圆角 */
.user-ref {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 11px;
  color: var(--text-tertiary);
  max-width: fit-content;
}
.user-ref-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
/* 用户消息操作按钮 */
.user-actions {
  display: flex;
  gap: 2px;
  margin-top: 2px;
  opacity: 0;
  transition: opacity 0.12s;
}
.user-stack:hover .user-actions {
  opacity: 1;
}
.user-act-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  border-radius: 4px;
  cursor: pointer;
  padding: 0;
}
.user-act-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
/* 气泡内原地编辑 */
.msg-bubble.editing {
  background: var(--bg-primary);
  border: 1px solid var(--accent);
  border-radius: 14px;
  padding: 6px;
  min-width: 200px;
}
.inline-edit-input {
  width: 100%;
  min-width: 200px;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 12px;
  font-family: var(--font-ui);
  line-height: 1.5;
  resize: vertical;
  min-height: 48px;
}
.inline-edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 6px;
}
.ie-btn {
  padding: 3px 12px;
  font-size: 11px;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  transition: background 0.12s;
}
.ie-btn.cancel {
  background: var(--bg-secondary);
  color: var(--text-secondary);
  border: 1px solid var(--border);
}
.ie-btn.cancel:hover {
  background: var(--bg-hover);
}
.ie-btn.save {
  background: var(--accent);
  color: #fff;
}
.ie-btn.save:hover {
  background: var(--accent-hover);
}
.ai-msg.assistant { justify-content: flex-start; }

.msg-bubble {
  max-width: 90%;
  padding: 8px 12px;
  border-radius: 14px;
  font-size: 12px;
}
.ai-msg.user .msg-bubble {
  background: #10b981;
  color: #fff;
  border-bottom-right-radius: 4px;
  width: fit-content;
  max-width: 100%;
  min-width: 40px;
}
.ai-msg.user .msg-text {
  color: #fff;
  white-space: pre-wrap;
  word-break: break-word;
  display: inline;
}

/* AI 消息：无气泡，直接铺开 */
.msg-plain {
  width: 100%;
  font-size: 12px;
  color: var(--text-primary);
  line-height: 1.35;
}
.msg-plain.error {
  color: var(--error);
}
.msg-plain.streaming {
  /* 与普通一致，无气泡无边框 */
}
.msg-bubble.error {
  background: var(--error-bg) !important;
  border-color: transparent !important;
}
.msg-bubble.streaming {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-bottom-left-radius: 4px;
}
.msg-text {
  margin: 0;
  font-family: var(--font-ui);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-primary);
}
.insert-btn {
  margin-top: 6px;
  padding: 3px 10px;
  font-size: 11px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 3px;
  cursor: pointer;
}
.insert-btn:hover { background: var(--accent-hover); }

/* 思考过程 */
.reasoning-block {
  margin-bottom: 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
  cursor: pointer;
}
.reasoning-block:hover {
  border-color: var(--border-strong);
}
.reasoning-toggle {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 8px;
  font-size: 11px;
  color: var(--text-tertiary);
  user-select: none;
  background: var(--bg-secondary);
}
.reasoning-toggle.open {
  color: var(--accent);
  border-bottom: 1px solid var(--border);
}
.reasoning-arrow {
  font-size: 8px;
  width: 12px;
  flex-shrink: 0;
}
.reasoning-content {
  padding: 8px;
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 300px;
  overflow-y: auto;
  background: var(--bg-tertiary);
}
.reasoning-content.streaming-text {
  max-height: 150px;
}

.thinking-line {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-tertiary);
  font-size: 12px;
}

/* AI 流式打字光标 */
.type-cursor {
  display: inline-block;
  width: 2px;
  height: 0.95em;
  background: var(--accent);
  margin-left: 1px;
  vertical-align: text-bottom;
  animation: caretBlink 0.9s steps(1) infinite;
}
@keyframes caretBlink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}

.streaming-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  background: var(--accent);
  border-radius: 50%;
  animation: blink 1s ease-in-out infinite;
}
@keyframes blink {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 1; }
}

/* Codex 风格悬浮输入框 */
.input-float-area {
  padding: 8px 10px 12px;
  flex-shrink: 0;
}
.new-chat-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  width: 100%;
  margin-bottom: 8px;
  padding: 6px 12px;
  font-size: 12px;
  color: var(--text-secondary);
  background: transparent;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
}
.new-chat-btn:hover {
  color: var(--accent);
  background: var(--accent-light);
}
.input-float-box {
  position: relative;
  background: rgba(255, 255, 255, 0.3);
  backdrop-filter: blur(20px) saturate(1.6);
  -webkit-backdrop-filter: blur(20px) saturate(1.6);
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 16px;
  padding: 8px 12px 6px;
  box-shadow:
    0 4px 24px rgba(0, 0, 0, 0.06),
    0 1px 3px rgba(0, 0, 0, 0.04),
    inset 0 1px 0 rgba(255, 255, 255, 0.35);
  transition: border-color 0.2s, box-shadow 0.2s, background 0.2s;
}
[data-theme="dark"] .input-float-box,
.theme-dark .input-float-box {
  background: rgba(30, 30, 46, 0.3);
  border-color: rgba(255, 255, 255, 0.06);
  box-shadow:
    0 4px 24px rgba(0, 0, 0, 0.25),
    0 1px 3px rgba(0, 0, 0, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.04);
}
.input-float-box:focus-within,
.input-float-box.focused {
  border-color: var(--accent);
  box-shadow:
    0 0 0 2px var(--accent-light),
    0 4px 24px rgba(0, 0, 0, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.5);
}
.float-input {
  width: 100%;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 13px;
  font-family: var(--font-ui);
  line-height: 1.5;
  resize: none;
  min-height: 22px;
  max-height: 100px;
}
.float-input::placeholder {
  color: var(--text-tertiary);
}
.float-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 4px;
}
.float-left {
  display: flex;
  align-items: center;
  gap: 6px;
}
.model-badge {
  font-size: 10px;
  color: var(--text-tertiary);
  background: var(--bg-secondary);
  padding: 0 8px;
  height: 28px;
  display: flex;
  align-items: center;
  border-radius: 8px;
  border: 1px solid var(--border);
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.model-badge.clickable {
  cursor: pointer;
  gap: 3px;
  transition: border-color 0.15s;
}
.model-badge.clickable:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.model-arrow {
  font-size: 8px;
}
.model-switcher {
  position: relative;
}
.model-menu {
  position: absolute;
  bottom: calc(100% + 4px);
  right: 0;
  left: auto;
  z-index: 100;
  background: rgba(30, 30, 46, 0.88);
  backdrop-filter: blur(24px) saturate(1.8);
  -webkit-backdrop-filter: blur(24px) saturate(1.8);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  box-shadow: var(--shadow-lg);
  min-width: 160px;
  max-width: 200px;
  padding: 3px 0;
  overflow: hidden;
  animation: menuPop 0.14s ease;
}
[data-theme="light"] .model-menu {
  background: rgba(255, 255, 255, 0.88);
  border-color: rgba(0, 0, 0, 0.08);
}
@keyframes menuPop {
  from { opacity: 0; transform: translateY(-4px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.model-menu-item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 5px 12px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  color: var(--text-primary);
  text-align: left;
}
.model-menu-item:hover {
  background: var(--bg-hover);
}
.model-menu-item.active {
  color: var(--accent);
  font-weight: 500;
}
.model-check {
  width: 14px;
  text-align: center;
  flex-shrink: 0;
  font-size: 11px;
}
.float-right {
  display: flex;
  align-items: center;
  gap: 6px;
}
.send-circle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: none;
  background: var(--text-tertiary);
  color: var(--bg-primary);
  cursor: pointer;
  transition: background 0.15s;
}
.send-circle:hover:not(:disabled) {
  background: var(--accent);
}
.send-circle:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.send-circle.stop {
  background: var(--error);
  color: #fff;
  animation: pulse-stop 1.5s ease-in-out infinite;
}
.send-circle.stop:hover {
  background: #dc2626;
}
@keyframes pulse-stop {
  0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); }
  50% { box-shadow: 0 0 0 6px rgba(239, 68, 68, 0); }
}
.loading-ring {
  width: 14px;
  height: 14px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}

/* 附件芯片：短小圆角矩形 */
.chips-inside {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 6px 10px 0;
}
.chip-row {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 11px;
  color: var(--text-secondary);
  max-width: 160px;
  flex-shrink: 0;
}
.chip-row.selection {
  border-color: var(--accent);
  background: var(--accent-light);
  color: var(--accent);
}
.chip-thumb-sm {
  width: 14px;
  height: 14px;
  object-fit: cover;
  border-radius: 2px;
  flex-shrink: 0;
}
.chip-row-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
  font-weight: 500;
  font-size: 11px;
}
.chip-row.selection .chip-row-name {
  color: var(--accent);
}
.chip-row-meta {
  color: var(--text-tertiary);
  flex-shrink: 0;
  font-size: 10px;
}
.chip-row-remove {
  width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 8px;
  border-radius: 50%;
  cursor: pointer;
  flex-shrink: 0;
  padding: 0;
}
.chip-row-remove:hover {
  background: var(--bg-hover);
  color: var(--error);
}

/* 上传按钮 */
.attach-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  border-radius: 50%;
  cursor: pointer;
  padding: 0;
}
.attach-btn:hover {
  background: var(--bg-hover);
  color: var(--accent);
}
/* 权限按钮：请求批准=默认，完全访问=绿色盾牌 */
.perm-btn.full {
  color: var(--success);
}
.perm-btn.full:hover {
  background: var(--success-bg);
  color: var(--success);
}

/* Markdown 渲染：极紧行距 */
.msg-md {
  font-size: 12px;
  line-height: 1.35;
  color: var(--text-primary);
  word-break: break-word;
}
.msg-md :deep(.md-para) {
  margin: 0 0 2px;
  line-height: 1.35;
}
.msg-md :deep(.md-ul),
.msg-md :deep(.md-ol) {
  margin: 2px 0;
  padding-left: 1.3em;
  line-height: 1.35;
}
.msg-md :deep(.md-li),
.msg-md :deep(.md-li-ol) {
  margin: 0;
  line-height: 1.35;
}
.msg-md :deep(.md-code) {
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 4px 6px;
  margin: 2px 0;
  overflow-x: auto;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.35;
  white-space: pre-wrap;
}
.msg-md :deep(.md-inline-code) {
  background: var(--bg-tertiary);
  padding: 1px 4px;
  border-radius: 3px;
  font-family: var(--font-mono);
  font-size: 11px;
}
.msg-md :deep(.md-h) {
  font-weight: 600;
  margin: 8px 0 4px;
  color: var(--text-primary);
}
.msg-md :deep(h2.md-h) { font-size: 14px; }
.msg-md :deep(h3.md-h) { font-size: 13px; }
.msg-md :deep(h4.md-h) { font-size: 12px; }
.msg-md :deep(.md-ul) {
  margin: 4px 0 4px 16px;
  padding: 0;
}
.msg-md :deep(.md-li), .msg-md :deep(.md-li-ol) {
  margin: 2px 0;
}
.msg-md :deep(.md-quote) {
  border-left: 3px solid var(--accent);
  padding-left: 8px;
  margin: 6px 0;
  color: var(--text-secondary);
}
.msg-md :deep(.md-hr) {
  border: none;
  border-top: 1px solid var(--border);
  margin: 8px 0;
}
.msg-md :deep(.md-latex) {
  font-family: "Cambria Math", "STIX Two Math", "Times New Roman", serif;
  font-style: italic;
  color: var(--accent);
  padding: 0 2px;
}
.msg-md :deep(.md-latex-block) {
  text-align: center;
  margin: 8px 0;
  font-family: "Cambria Math", "STIX Two Math", "Times New Roman", serif;
  font-size: 13px;
  color: var(--accent);
  padding: 6px;
  background: var(--bg-tertiary);
  border-radius: 4px;
}
.msg-md :deep(.md-latex-lines) {
  text-align: center;
  line-height: 2;
}
.msg-md :deep(sup) {
  font-size: 0.75em;
  vertical-align: super;
}
.msg-md :deep(sub) {
  font-size: 0.75em;
  vertical-align: sub;
}
.msg-md :deep(a) {
  color: var(--accent);
  text-decoration: none;
}
.msg-md :deep(a:hover) {
  text-decoration: underline;
}

/* 编辑提议 */
.edit-proposals {
  margin-bottom: 8px;
}
.proposal-card {
  border: 1px solid var(--warning);
  border-radius: 6px;
  padding: 8px;
  margin-bottom: 6px;
  background: var(--warning-bg);
}
.proposal-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--warning);
  margin-bottom: 6px;
}
.proposal-diff {
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.5;
  margin-bottom: 6px;
}
.diff-del {
  color: var(--error);
  background: var(--error-bg);
  padding: 2px 6px;
  border-radius: 3px;
  margin-bottom: 2px;
  word-break: break-all;
}
.diff-add {
  color: var(--success);
  background: var(--success-bg);
  padding: 2px 6px;
  border-radius: 3px;
  word-break: break-all;
}
.apply-btn {
  padding: 4px 12px;
  font-size: 11px;
  background: var(--warning);
  color: #fff;
  border: none;
  border-radius: 3px;
  cursor: pointer;
}
.apply-btn:hover {
  opacity: 0.9;
}

/* ===== Agent 执行流 ===== */
.agent-trace {
  margin: 0 0 8px;
}
.agent-trace-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  user-select: none;
}
.agent-trace-header:hover { color: var(--text-primary); }
.trace-chevron {
  font-size: 9px;
  width: 12px;
  color: var(--text-tertiary);
}
.trace-label {
  font-weight: 500;
}
.trace-duration {
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}
.trace-count {
  color: var(--text-tertiary);
  font-size: 11px;
}
.agent-trace-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-left: 4px;
  margin-top: 2px;
}
.agent-trace.live {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 6px;
}

/* 扁平执行列表行 */
.trace-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 6px;
  border-radius: 4px;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
}
.trace-row:hover {
  background: var(--bg-hover);
}
.trace-row.running {
  color: var(--accent);
}
.trace-row.failed {
  color: var(--error);
}
.trace-row-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  color: var(--text-tertiary);
}
.trace-row.running .trace-row-icon { color: var(--accent); }
.trace-row.failed .trace-row-icon { color: var(--error); }
.trace-row-text {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  min-width: 0;
}
.trace-action {
  flex-shrink: 0;
}
.trace-file {
  font-family: var(--font-mono);
  font-size: 11px;
  padding: 1px 5px;
  background: var(--bg-tertiary);
  border-radius: 3px;
  color: var(--text-primary);
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.trace-badge {
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  padding: 0 4px;
  border-radius: 3px;
}
.trace-badge.add {
  color: var(--success);
  background: var(--success-bg);
}
.trace-badge.del {
  color: var(--error);
  background: var(--error-bg);
}

/* 会话列表 */
.new-chat-row {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}
.new-chat-row .new-chat-btn {
  margin-bottom: 0;
  flex: 1;
}
.hist-btn {
  flex: 0 0 auto !important;
  width: auto !important;
  padding: 6px 10px !important;
}
.session-list {
  margin-bottom: 8px;
  max-height: 140px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-primary);
}
.session-item {
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--border);
}
.session-item:last-child { border-bottom: none; }
.session-item.active { background: var(--accent-light); }
.session-switch {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  min-width: 0;
}
.session-switch:hover { background: var(--bg-hover); }
.session-title {
  font-size: 12px;
  color: var(--text-primary);
  min-width: 0;
}
.session-time {
  font-size: 10px;
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.session-del {
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  padding: 4px 8px;
  font-size: 11px;
}
.session-del:hover { color: var(--error); }
.agent-live-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 12px;
  color: var(--text-secondary);
}

.tool-chip {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--bg-tertiary);
  border: 1px solid transparent;
  width: fit-content;
  max-width: 100%;
}
.tool-chip.running {
  border-color: var(--accent);
  color: var(--accent);
}
.tool-chip.failed {
  border-color: var(--error);
  color: var(--error);
}
.chip-icon {
  display: flex;
  align-items: center;
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.tool-chip.running .chip-icon { color: var(--accent); }
.tool-chip.failed .chip-icon { color: var(--error); }
.chip-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.chip-spinner {
  width: 10px;
  height: 10px;
  border: 1.5px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  flex-shrink: 0;
}
.chip-status.fail {
  color: var(--error);
  font-weight: 700;
  font-size: 11px;
}
.chip-expand {
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 9px;
  padding: 0 2px;
  line-height: 1;
  flex-shrink: 0;
}
.chip-expand:hover { color: var(--text-primary); }
.tool-chip-detail {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 20;
  min-width: 240px;
  max-width: 360px;
  max-height: 180px;
  overflow-y: auto;
  padding: 8px 10px;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: var(--shadow-lg);
  font-size: 11px;
}
.tool-step-detail + .tool-step-detail {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--border);
}
.tool-args {
  display: block;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-secondary);
  word-break: break-all;
  white-space: pre-wrap;
}
.tool-result-box {
  margin-top: 4px;
  padding: 6px 8px;
  background: var(--bg-tertiary);
  border-radius: 4px;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 100px;
  overflow-y: auto;
}
</style>
