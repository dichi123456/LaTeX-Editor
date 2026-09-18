<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useDocStore } from '../stores/docs'
import { useCompileStore } from '../stores/compile'
import { useConfigStore } from '../stores/config'

const docStore = useDocStore()
const compileStore = useCompileStore()
const configStore = useConfigStore()

const props = defineProps<{
  panelOpen?: boolean
  panelTab?: 'problems' | 'output' | 'log'
  errorCount?: number
  warningCount?: number
}>()

const emit = defineEmits<{
  (e: 'toggle-panel', tab: 'problems' | 'log' | 'output'): void
}>()

const tab = computed(() => docStore.activeTab)

const charCount = computed(() => {
  if (!tab.value) return 0
  return tab.value.content.length
})

const lineCount = computed(() => {
  if (!tab.value) return 0
  return tab.value.content.split('\n').length
})

const compileStatus = computed(() => {
  if (compileStore.isCompiling) return { text: '编译中…', cls: 'compiling' }
  const r = compileStore.lastResult
  if (!r) return { text: '未编译', cls: '' }
  if (r.success) return { text: '编译成功', cls: 'success' }
  return { text: `编译失败 (${r.errors.length} 错误)`, cls: 'error' }
})

// 编译成功时短暂闪烁
const flashSuccess = ref(false)
watch(
  () => compileStore.lastResult?.success,
  (ok) => {
    if (ok) {
      flashSuccess.value = true
      setTimeout(() => { flashSuccess.value = false }, 1200)
    }
  }
)
</script>

<template>
  <div class="status-bar">
    <div class="status-left">
      <!-- 面板切换图标（VS Code 风格） -->
      <button
        class="panel-icon-btn"
        :class="{ active: props.panelOpen && props.panelTab === 'problems' }"
        title="问题"
        @click="emit('toggle-panel', 'problems')"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.2"/>
          <line x1="7" y1="4" x2="7" y2="8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
          <circle cx="7" cy="10" r="0.8" fill="currentColor"/>
        </svg>
        <span v-if="props.errorCount" class="p-badge err">{{ props.errorCount }}</span>
        <span v-if="props.warningCount" class="p-badge warn">{{ props.warningCount }}</span>
      </button>
      <button
        class="panel-icon-btn"
        :class="{ active: props.panelOpen && props.panelTab === 'log' }"
        title="编译日志"
        @click="emit('toggle-panel', 'log')"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <rect x="2" y="2" width="10" height="10" rx="1.5" stroke="currentColor" stroke-width="1.2"/>
          <path d="M4.5 5.5L6.5 7L4.5 8.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>
          <line x1="7.5" y1="8.5" x2="10" y2="8.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
        </svg>
      </button>
      <button
        class="panel-icon-btn"
        :class="{ active: props.panelOpen && props.panelTab === 'output' }"
        title="输出"
        @click="emit('toggle-panel', 'output')"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M3 4l3 3-3 3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
          <line x1="7.5" y1="10" x2="11" y2="10" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
        </svg>
      </button>
      <span class="status-sep"></span>

      <span v-if="tab" class="status-item" :class="{ dirty: tab.isDirty }">
        {{ tab.isDirty ? '●' : '' }} {{ tab.name }}
      </span>
      <span v-if="tab?.path" class="status-item path truncate" :title="tab.path">
        {{ tab.path }}
      </span>
      <span v-if="!tab" class="status-item dim">无打开文件</span>
    </div>
    <div class="status-right">
      <span class="status-item dim">行 {{ docStore.cursorLine }}, 列 {{ docStore.cursorCol }}</span>
      <span class="status-item dim">{{ tab?.encoding || 'utf-8' }}</span>
      <span class="status-item dim">{{ configStore.config?.engine || 'xelatex' }}</span>
      <span class="status-item dim">{{ lineCount }} 行</span>
      <span class="status-item dim">{{ charCount }} 字符</span>
      <span
        class="status-item texlive-badge"
        :class="compileStore.texLiveFound ? 'ok' : 'missing'"
        :title="compileStore.texLiveFound ? `TeX Live: ${compileStore.texLivePath}` : '未检测到 TeX Live'"
      >
        TeX Live {{ compileStore.texLiveFound ? '✓' : '✗' }}
      </span>
      <span class="status-item" :class="[compileStatus.cls, { 'flash-ok': flashSuccess }]">{{ compileStatus.text }}</span>
    </div>
  </div>
</template>

<style scoped>
.status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: var(--statusbar-height);
  padding: 0 6px 0 4px;
  background: var(--bg-primary);
  border-top: none;
  font-size: 12px;
  color: var(--text-secondary);
  flex-shrink: 0;
  user-select: none;
}
.status-left, .status-right {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
}
.status-right {
  gap: 12px;
}

/* 面板图标按钮：VS Code 风格底部指示条 */
.panel-icon-btn {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 22px;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  border-radius: 0;
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
}
.panel-icon-btn::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 4px;
  right: 4px;
  height: 2px;
  background: transparent;
  border-radius: 1px;
  transition: background 0.12s;
}
.panel-icon-btn:hover {
  background: transparent;
  color: var(--text-primary);
}
.panel-icon-btn:hover::after {
  background: var(--text-tertiary);
}
.panel-icon-btn.active {
  color: var(--accent);
  background: transparent;
}
.panel-icon-btn.active::after {
  background: var(--accent);
}
.p-badge {
  position: absolute;
  top: 1px;
  right: 1px;
  min-width: 10px;
  height: 10px;
  padding: 0 2px;
  font-size: 8px;
  line-height: 10px;
  text-align: center;
  border-radius: 5px;
  font-weight: 600;
}
.p-badge.err {
  background: var(--error);
  color: #fff;
}
.p-badge.warn {
  background: var(--warning);
  color: #fff;
}
.status-sep {
  width: 1px;
  height: 14px;
  background: var(--border);
  margin: 0 6px;
  flex-shrink: 0;
}

.status-item {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.status-item.path {
  max-width: 300px;
  color: var(--text-tertiary);
  font-size: 11px;
}
.status-item.dim {
  color: var(--text-tertiary);
}
.status-item.dirty {
  color: var(--warning);
}
.status-item.success {
  color: var(--success);
}
.status-item.flash-ok {
  animation: okFlash 1.2s ease;
}
@keyframes okFlash {
  0% { color: var(--success); background: var(--success-bg); }
  40% { color: var(--success); background: var(--success-bg); }
  100% { color: var(--success); background: transparent; }
}
.status-item.error {
  color: var(--error);
}
.status-item.compiling {
  color: var(--accent);
}
.texlive-badge {
  padding: 1px 8px;
  border-radius: 8px;
  font-size: 11px;
  font-weight: 500;
}
.texlive-badge.ok {
  color: var(--success);
  background: var(--success-bg);
}
.texlive-badge.missing {
  color: var(--error);
  background: var(--error-bg);
}
</style>
