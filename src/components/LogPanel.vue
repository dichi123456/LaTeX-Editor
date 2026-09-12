<script setup lang="ts">
import { computed } from 'vue'
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
</script>

<template>
  <div class="log-panel">
    <!-- 问题模式：无子标签，直接列问题 -->
    <template v-if="mode === 'problems'">
      <div class="log-body">
        <div v-if="filteredIssues.length > 0" class="issues-list">
          <div
            v-for="(issue, idx) in filteredIssues"
            :key="idx"
            class="issue-item"
            :class="issue.type"
            @click="jump(issue)"
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

    <!-- 输出模式：实时编译输出流 -->
    <template v-else-if="mode === 'output'">
      <div class="log-body">
        <pre v-if="compileStore.liveLog" class="output-pre">{{ compileStore.liveLog }}</pre>
        <div v-else-if="compileStore.isCompiling" class="log-compiling">正在编译，等待输出…</div>
        <div v-else class="log-empty">暂无输出。编译时此处显示实时日志。</div>
      </div>
    </template>

    <!-- 日志模式：带过滤标签的完整日志 -->
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
            @click="jump(issue)"
          >
            <span class="issue-badge">{{ issue.type === 'error' ? '错误' : '警告' }}</span>
            <span class="issue-line" v-if="issue.line">L{{ issue.line }}</span>
            <span class="issue-msg">{{ friendlyMessage(issue) }}</span>
          </div>
        </div>

        <details v-if="compileStore.lastResult?.log" class="raw-log" open>
          <summary>原始编译日志</summary>
          <pre>{{ compileStore.lastResult.log }}</pre>
        </details>

        <div v-if="!compileStore.lastResult && !compileStore.isCompiling" class="log-empty">
          暂无编译日志。按 F5 编译文档。
        </div>
        <div v-if="compileStore.isCompiling" class="log-compiling">正在编译…</div>
      </div>
    </template>
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
}
.issues-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 8px;
}
.issue-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  line-height: 1.5;
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
}
.log-empty, .log-compiling {
  text-align: center;
  color: var(--text-tertiary);
  padding: 20px;
  font-size: 12px;
}
.log-compiling { color: var(--accent); }
</style>
