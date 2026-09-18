<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useCompileStore } from '../stores/compile'
import type { CompileIssue } from '../stores/compile'

const props = defineProps<{
  mode?: 'problems' | 'output' | 'log'
}>()

const compileStore = useCompileStore()

const emit = defineEmits<{
  (e: 'jump', line: number | null, file?: string | null): void
}>()

const mode = computed(() => props.mode || 'log')

// 右键菜单
const ctxMenu = ref({ show: false, x: 0, y: 0, text: '', issue: null as CompileIssue | null })
const selectedIssue = ref<CompileIssue | null>(null)

const filteredIssues = computed<CompileIssue[]>(() => {
  const result = compileStore.lastResult
  if (!result) return []
  if (mode.value === 'problems') {
    return [...result.errors, ...result.warnings]
  }
  const filter = compileStore.logFilter
  if (filter === 'error') return result.errors
  if (filter === 'warning') return result.warnings
  return [...result.errors, ...result.warnings]
})

const errorCount = computed(() => compileStore.lastResult?.errors.length || 0)
const warningCount = computed(() => compileStore.lastResult?.warnings.length || 0)

function friendlyMessage(issue: CompileIssue): string {
  const msg = issue.message
  if (/File `(.+?)' not found/i.test(msg)) {
    const m = msg.match(/File `(.+?)' not found/)
    if (m) return `未找到文件：${m[1]}。请检查路径或宏包是否安装。`
  }
  if (/Undefined control sequence/i.test(msg)) {
    return `未定义的命令：${msg.replace(/Undefined control sequence/, '').trim() || '（见上下文）'}。可能是宏包未加载或命令拼写错误。`
  }
  if (/Missing \$ inserted/i.test(msg)) return '缺少 $ 符号：数学模式可能未正确开启/关闭。'
  if (/Too many }'s/i.test(msg)) return '右花括号 } 过多：请检查括号匹配。'
  if (/Runaway argument/i.test(msg)) return '参数未闭合：可能缺少右花括号 }。'
  if (/Emergency stop/i.test(msg)) return '紧急停止：编译遇到致命错误，请查看上方日志定位问题。'
  if (/Package .* Warning/i.test(msg)) return `宏包警告：${msg}`
  if (/Overfull \\hbox/i.test(msg)) return `水平溢出盒子（Overfull）：${msg}`
  if (/Underfull \\hbox/i.test(msg)) return `水平不足盒子（Underfull）：${msg}`
  return msg
}

function jump(issue: CompileIssue) {
  emit('jump', issue.line, issue.file)
}

function clearLog() {
  compileStore.lastResult = null
  compileStore.liveLog = ''
}

function issueSummary(issue: CompileIssue): string {
  const loc = issue.line ? `第 ${issue.line} 行` : ''
  const file = issue.file ? `（${issue.file}）` : ''
  return `编译${issue.type === 'error' ? '错误' : '警告'}${loc}${file}：\n${issue.message}`
}

function onIssueContext(e: MouseEvent, issue: CompileIssue) {
  e.preventDefault()
  window.dispatchEvent(new CustomEvent('close-all-menus'))
  selectedIssue.value = issue
  const x = Math.max(8, Math.min(e.clientX, window.innerWidth - 180))
  const y = Math.max(8, Math.min(e.clientY, window.innerHeight - 80))
  ctxMenu.value = {
    show: true,
    x,
    y,
    text: issueSummary(issue),
    issue
  }
}

function onLogContext(e: MouseEvent) {
  const sel = window.getSelection()?.toString().trim()
  if (!sel || sel.length < 8) return
  e.preventDefault()
  window.dispatchEvent(new CustomEvent('close-all-menus'))
  selectedIssue.value = null
  ctxMenu.value = { show: true, x: e.clientX, y: e.clientY, text: sel, issue: null }
}

function closeCtx() {
  ctxMenu.value.show = false
  selectedIssue.value = null
}

function onGlobalClick(e: MouseEvent) {
  if (!(e.target as HTMLElement).closest('.log-ctx-menu')) closeCtx()
}

function onCloseAllMenus() {
  closeCtx()
}

function sendToMoling() {
  const text = ctxMenu.value.text
  if (!text) return
  const result = compileStore.lastResult
  window.dispatchEvent(new CustomEvent('send-to-moling', {
    detail: {
      text,
      filePath: ctxMenu.value.issue?.file || docMainPath(),
      fileName: '编译日志',
      lineRange: ctxMenu.value.issue?.line ? String(ctxMenu.value.issue.line) : undefined,
      source: 'compile-error'
    }
  }))
  closeCtx()
}

function docMainPath(): string {
  // 交给 App 侧处理；此处仅占位
  return ''
}

function onIssueDblClick(issue: CompileIssue) {
  // 双击快速发送
  selectedIssue.value = issue
  ctxMenu.value = {
    show: false,
    x: 0,
    y: 0,
    text: issueSummary(issue),
    issue
  }
  sendToMoling()
}

onMounted(() => {
  document.addEventListener('click', onGlobalClick)
  window.addEventListener('close-all-menus', onCloseAllMenus)
})
onUnmounted(() => {
  document.removeEventListener('click', onGlobalClick)
  window.removeEventListener('close-all-menus', onCloseAllMenus)
})
</script>

<template>
  <div class="log-panel">
    <!-- 问题模式 -->
    <template v-if="mode === 'problems'">
      <div class="log-body">
        <div v-if="filteredIssues.length > 0" class="issues-list">
          <div
            v-for="(issue, idx) in filteredIssues"
            :key="idx"
            class="issue-item"
            :class="issue.type"
            title="单击跳转 · 右键发送至墨灵 · 双击直接发送"
            @click="jump(issue)"
            @contextmenu="onIssueContext($event, issue)"
            @dblclick="onIssueDblClick(issue)"
          >
            <span class="issue-badge">{{ issue.type === 'error' ? '错误' : '警告' }}</span>
            <span class="issue-line" v-if="issue.line">L{{ issue.line }}</span>
            <span class="issue-msg">{{ friendlyMessage(issue) }}</span>
          </div>
        </div>
        <div v-else class="log-empty">
          <template v-if="compileStore.lastResult?.success">没有检测到问题。</template>
          <template v-else-if="compileStore.lastResult">编译失败，但未解析出具体问题行。</template>
          <template v-else>尚未编译。按 F5 编译文档后此处显示错误与警告。</template>
        </div>
      </div>
    </template>

    <!-- 输出模式 -->
    <template v-else-if="mode === 'output'">
      <div class="log-body">
        <pre
          v-if="compileStore.liveLog"
          class="output-pre"
          @contextmenu="onLogContext"
        >{{ compileStore.liveLog }}</pre>
        <div v-else-if="compileStore.isCompiling" class="log-compiling">正在编译，等待输出…</div>
        <div v-else class="log-empty">暂无输出。编译时此处显示实时日志。</div>
      </div>
    </template>

    <!-- 日志模式 -->
    <template v-else>
      <div class="log-header">
        <div class="log-tabs">
          <button :class="{ active: compileStore.logFilter === 'all' }" @click="compileStore.logFilter = 'all'">全部</button>
          <button class="tab-error" :class="{ active: compileStore.logFilter === 'error' }" @click="compileStore.logFilter = 'error'">
            错误 ({{ errorCount }})
          </button>
          <button class="tab-warning" :class="{ active: compileStore.logFilter === 'warning' }" @click="compileStore.logFilter = 'warning'">
            警告 ({{ warningCount }})
          </button>
        </div>
        <div class="log-meta">
          <span v-if="compileStore.lastResult" class="duration">
            {{ compileStore.lastResult.success ? '✓ 成功' : '✗ 失败' }}
            · {{ (compileStore.lastResult.duration / 1000).toFixed(1) }}s
          </span>
          <button @click="clearLog" title="清空日志">清空</button>
        </div>
      </div>

      <div class="log-body">
        <div v-if="filteredIssues.length > 0" class="issues-list">
          <div
            v-for="(issue, idx) in filteredIssues"
            :key="idx"
            class="issue-item"
            :class="issue.type"
            title="单击跳转 · 右键发送至墨灵 · 双击直接发送"
            @click="jump(issue)"
            @contextmenu="onIssueContext($event, issue)"
            @dblclick="onIssueDblClick(issue)"
          >
            <span class="issue-badge">{{ issue.type === 'error' ? '错误' : '警告' }}</span>
            <span class="issue-line" v-if="issue.line">L{{ issue.line }}</span>
            <span class="issue-msg">{{ friendlyMessage(issue) }}</span>
          </div>
        </div>

        <details v-if="compileStore.lastResult?.log" class="raw-log" open>
          <summary>原始编译日志（可选中后右键发送至墨灵）</summary>
          <pre @contextmenu="onLogContext">{{ compileStore.lastResult.log }}</pre>
        </details>

        <div v-if="!compileStore.lastResult && !compileStore.isCompiling" class="log-empty">
          暂无编译日志。按 F5 编译文档。
        </div>
        <div v-if="compileStore.isCompiling" class="log-compiling">正在编译…</div>
      </div>
    </template>

    <!-- 右键菜单 -->
    <Teleport to="body">
      <div
        v-if="ctxMenu.show"
        class="log-ctx-menu"
        :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }"
        @click.stop
      >
        <button class="ctx-item highlight" @click="sendToMoling">
          <span class="ctx-icon">💬</span> 发送至墨灵
        </button>
        <button v-if="ctxMenu.issue" class="ctx-item" @click="jump(ctxMenu.issue!); closeCtx()">
          <span class="ctx-icon">📍</span> 跳转到源码
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.log-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-secondary);
  font-size: 13px;
}
.log-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.log-tabs {
  display: flex;
  gap: 2px;
}
.log-tabs button {
  font-size: 12px;
  padding: 3px 10px;
  border-radius: var(--radius-sm);
}
.log-tabs button.active {
  background: var(--bg-active);
  font-weight: 600;
}
.log-tabs .tab-error.active { color: var(--error); }
.log-tabs .tab-warning.active { color: var(--warning); }
.log-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}
.duration {
  font-size: 12px;
  color: var(--text-secondary);
}
.log-body {
  flex: 1;
  overflow: auto;
  padding: 6px 8px;
  user-select: text;
}
.issues-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 8px;
  user-select: none;
}
.issue-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  line-height: 1.5;
  user-select: none;
}
.issue-item:hover { background: var(--bg-hover); }
.issue-item.error { background: var(--error-bg); }
.issue-item.error:hover { background: var(--error); color: #fff; }
.issue-item.error:hover .issue-badge { background: rgba(255,255,255,0.2); color: #fff; }
.issue-item.warning { background: var(--warning-bg); }
.issue-badge {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--bg-active);
  color: var(--text-secondary);
}
.issue-item.error .issue-badge { color: var(--error); }
.issue-item.warning .issue-badge { color: var(--warning); }
.issue-line {
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-tertiary);
  min-width: 32px;
}
.issue-msg {
  flex: 1;
  min-width: 0;
  word-break: break-all;
}
.output-pre {
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--text-secondary);
  margin: 0;
  user-select: text;
}
.raw-log {
  margin-top: 4px;
  border-top: 1px solid var(--border);
  padding-top: 6px;
}
.raw-log summary {
  cursor: pointer;
  font-size: 12px;
  color: var(--text-secondary);
  user-select: none;
}
.raw-log pre {
  margin-top: 6px;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--text-secondary);
  max-height: 300px;
  overflow: auto;
  background: var(--bg-primary);
  padding: 8px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  user-select: text;
}
.log-empty, .log-compiling {
  text-align: center;
  color: var(--text-tertiary);
  padding: 20px;
  font-size: 12px;
}
.log-compiling { color: var(--accent); }
</style>

<style>
/* teleport 到 body，不能 scoped */
.log-ctx-menu {
  position: fixed;
  z-index: 10000;
  background: rgba(30, 30, 46, 0.8);
  backdrop-filter: blur(16px) saturate(1.4);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
  min-width: 160px;
  padding: 4px 0;
}
[data-theme="light"] .log-ctx-menu {
  background: rgba(255, 255, 255, 0.8);
  border-color: rgba(0, 0, 0, 0.08);
}
.log-ctx-menu .ctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 14px;
  border: none;
  background: transparent;
  color: inherit;
  font-size: 13px;
  cursor: pointer;
  text-align: left;
}
.log-ctx-menu .ctx-item:hover {
  background: rgba(255, 255, 255, 0.08);
}
[data-theme="light"] .log-ctx-menu .ctx-item:hover {
  background: rgba(0, 0, 0, 0.06);
}
.log-ctx-menu .ctx-item.highlight {
  color: #82aaff;
  font-weight: 500;
}
.log-ctx-menu .ctx-icon {
  font-size: 13px;
  width: 16px;
  text-align: center;
}
</style>
