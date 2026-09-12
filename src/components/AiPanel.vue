<script setup lang="ts">
import { ref, watch, nextTick, computed, onMounted, onUnmounted } from 'vue'
import { useAiStore } from '../stores/ai'
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
    // 收集文件路径作为上下文
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

const hasStreaming = computed(() => aiStore.isThinking && (aiStore.streamingContent || aiStore.streamingReasoning))

function renderMd(text: string): string {
  return renderMarkdown(text)
}

watch(
  () => [aiStore.messages.length, aiStore.streamingContent, aiStore.streamingReasoning],
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
    list_files: '列出文件',
    search_project: '搜索项目',
    get_outline: '获取大纲',
    compile_document: '编译文档'
  }
  return map[name] || name
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
        <select
          class="perm-select"
          :value="aiStore.aiConfig.permissionMode"
          @change="aiStore.aiConfig.permissionMode = ($event.target as HTMLSelectElement).value as 'ask' | 'full'; aiStore.saveConfig()"
          title="文档编辑权限"
        >
          <option value="ask">请求批准</option>
          <option value="full">完全访问</option>
        </select>
        <button class="ai-h-btn" title="分析编译错误" @click="analyzeErrors">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.2"/>
            <line x1="7" y1="4" x2="7" y2="8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
            <circle cx="7" cy="10" r="0.8" fill="currentColor"/>
          </svg>
        </button>
        <button class="ai-h-btn" title="清空对话" @click="aiStore.clearChat">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M4 4l6 6M10 4l-6 6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
          </svg>
        </button>
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
              <span class="user-ref-text">{{ msg.fileContext }}</span>
            </div>
            <div class="msg-bubble" :class="{ error: msg.error }">
              <span class="msg-text">{{ cleanUserContent(msg.content) }}</span>
            </div>
          </div>
        </template>

        <!-- AI 消息 -->
        <template v-else>
        <div class="msg-bubble" :class="{ error: msg.error }">
          <!-- 思考过程（默认折叠） -->
          <div v-if="msg.reasoning" class="reasoning-block" @click="reasoningExpanded = !reasoningExpanded">
            <div class="reasoning-toggle" :class="{ open: reasoningExpanded }">
              <span class="reasoning-arrow">{{ reasoningExpanded ? '▼' : '▶' }}</span>
              <span class="reasoning-icon">🧠</span>
              <span>思考过程（{{ msg.reasoning.length }} 字）</span>
            </div>
            <div v-if="reasoningExpanded" class="reasoning-content">{{ msg.reasoning }}</div>
          </div>
          <!-- 工具执行步骤 -->
          <div v-if="msg.toolSteps && msg.toolSteps.length > 0" class="tool-steps">
            <div v-for="step in msg.toolSteps" :key="step.id" class="tool-step" :class="step.status">
              <span class="tool-icon">
                <span v-if="step.status === 'running'" class="tool-spinner"></span>
                <span v-else-if="step.success" class="tool-check">✓</span>
                <span v-else class="tool-fail">✗</span>
              </span>
              <span class="tool-name">{{ toolLabel(step.toolName) }}</span>
              <span v-if="step.result" class="tool-result-preview" :title="step.result">{{ step.result.slice(0, 60) }}</span>
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

      <!-- 流式响应中 -->
      <div v-if="hasStreaming || aiStore.toolSteps.length > 0" class="ai-msg assistant">
        <div class="msg-bubble streaming">
          <!-- 工具执行步骤 -->
          <div v-if="aiStore.toolSteps.length > 0" class="tool-steps">
            <div v-for="step in aiStore.toolSteps" :key="step.id" class="tool-step" :class="step.status">
              <span class="tool-icon">
                <span v-if="step.status === 'running'" class="tool-spinner"></span>
                <span v-else-if="step.success" class="tool-check">✓</span>
                <span v-else class="tool-fail">✗</span>
              </span>
              <span class="tool-name">{{ toolLabel(step.toolName) }}</span>
              <span v-if="step.result" class="tool-result-preview">{{ step.result.slice(0, 60) }}</span>
            </div>
          </div>
          <!-- 思考过程：默认折叠，点击展开 -->
          <div v-if="aiStore.streamingReasoning" class="reasoning-block" @click="toggleReasoning">
            <div class="reasoning-toggle" :class="{ open: reasoningExpanded }">
              <span class="reasoning-arrow">{{ reasoningExpanded ? '▼' : '▶' }}</span>
              <span class="reasoning-icon">🧠</span>
              <span>思考中</span>
              <span class="streaming-dot"></span>
            </div>
            <div v-if="reasoningExpanded" class="reasoning-content streaming-text">{{ aiStore.streamingReasoning }}</div>
          </div>
          <div v-if="aiStore.streamingContent" class="msg-md" v-html="renderMarkdown(aiStore.streamingContent)"></div>
          <div v-if="!aiStore.streamingContent && !aiStore.streamingReasoning && aiStore.toolSteps.length === 0" class="thinking-line">
            <span class="streaming-dot"></span> 墨灵思考中…
          </div>
        </div>
      </div>
    </div>

    <!-- Codex 风格悬浮输入框 -->
    <div class="input-float-area">
      <div class="input-float-box" :class="{ focused: inputText.length > 0 || attachedFiles.length > 0 }">
        <!-- 附件芯片（框内顶部） -->
        <div v-if="attachedFiles.length > 0" class="chips-inside">
          <div v-for="(f, idx) in attachedFiles" :key="idx" class="chip-row" :class="{ selection: f.isSelection }">
            <svg v-if="f.isSelection" width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect x="1.5" y="2.5" width="11" height="9" rx="1.5" stroke="currentColor" stroke-width="1.1"/>
              <line x1="4" y1="5.5" x2="10" y2="5.5" stroke="currentColor" stroke-width="1"/>
              <line x1="4" y1="8" x2="8" y2="8" stroke="currentColor" stroke-width="1"/>
            </svg>
            <img v-else-if="f.isImage" :src="f.content" class="chip-thumb-sm" :alt="f.name" />
            <svg v-else width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M8 1.5H4a1.5 1.5 0 0 0-1.5 1.5v8A1.5 1.5 0 0 0 4 12.5h6a1.5 1.5 0 0 0 1.5-1.5V5L8 1.5z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>
              <path d="M8 1.5V5h3.5" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>
            </svg>
            <span class="chip-row-name">{{ f.isSelection ? '选中文本' : f.name }}</span>
            <span class="chip-row-meta">{{ f.isSelection ? `${f.content.length} 字` : f.isImage ? '图片' : '' }}</span>
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
        ></textarea>
        <div class="float-footer">
          <div class="float-left">
            <button class="attach-btn" title="上传文件 / 图片" @click="triggerFileUpload">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <line x1="7" y1="3" x2="7" y2="11" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
                <line x1="3" y1="7" x2="11" y2="7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
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
          </div>
          <div class="float-right">
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
  text-align: center;
  color: var(--text-tertiary);
  padding: 40px 16px;
  font-size: 12px;
  line-height: 1.8;
}
.ai-hint {
  margin-top: 8px;
  font-size: 11px;
  color: var(--text-tertiary);
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

/* 引用标签 */
.user-ref {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 11px;
  color: var(--text-tertiary);
  max-width: 100%;
}
.user-ref-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
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

ai-msg.assistant .msg-bubble {
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-bottom-left-radius: 4px;
}
.msg-bubble.error {
  background: var(--error-bg) !important;
  border-color: transparent !important;
}
.msg-bubble.streaming {
  border-color: var(--accent);
  border-style: dashed;
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
.reasoning-icon { font-size: 12px; }
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
.input-float-box {
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 8px 12px 6px;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.input-float-box:focus-within,
.input-float-box.focused {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-light);
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
  padding: 2px 8px;
  border-radius: 10px;
  border: 1px solid var(--border);
}
.model-badge.clickable {
  cursor: pointer;
  display: flex;
  align-items: center;
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
  left: 0;
  z-index: 100;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: var(--shadow-lg);
  min-width: 160px;
  padding: 3px 0;
  overflow: hidden;
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

/* 附件芯片（Codex 风格） */
/* 框内芯片 */
.chips-inside {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 10px 0;
}
.chip-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 11px;
  color: var(--text-secondary);
}
.chip-row.selection {
  border-color: var(--accent);
  background: var(--accent-light);
  color: var(--accent);
}
.chip-thumb-sm {
  width: 16px;
  height: 16px;
  object-fit: cover;
  border-radius: 2px;
  flex-shrink: 0;
}
.chip-row-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
  font-weight: 500;
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
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 9px;
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

/* Markdown 渲染 */
.msg-md {
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-primary);
  word-break: break-word;
}
.msg-md :deep(.md-para) {
  margin: 0 0 6px;
}
.msg-md :deep(.md-code) {
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 6px 8px;
  margin: 6px 0;
  overflow-x: auto;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.5;
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

/* 权限选择器 */
.perm-select {
  font-size: 10px;
  padding: 2px 4px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--bg-primary);
  color: var(--text-secondary);
  cursor: pointer;
  outline: none;
  margin-right: 4px;
}
.perm-select:hover {
  border-color: var(--accent);
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

/* 工具执行步骤 */
.tool-steps {
  margin-bottom: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.tool-step {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  border-radius: 6px;
  font-size: 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
}
.tool-step.running {
  border-color: var(--accent);
  background: var(--accent-light);
}
.tool-step.done {
  border-color: var(--success);
}
.tool-step.done:not(:has(.tool-fail)) {
  background: var(--success-bg);
}
.tool-icon {
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 12px;
}
.tool-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
.tool-check {
  color: var(--success);
  font-weight: 700;
}
.tool-fail {
  color: var(--error);
  font-weight: 700;
}
.tool-name {
  font-weight: 500;
  color: var(--text-primary);
  flex-shrink: 0;
}
.tool-result-preview {
  font-size: 11px;
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 1;
}
</style>
