<script setup lang="ts">
import { computed } from 'vue'
import { useDocStore } from '../stores/docs'
import { useCompileStore } from '../stores/compile'
import { useConfigStore } from '../stores/config'

const docStore = useDocStore()
const compileStore = useCompileStore()
const configStore = useConfigStore()

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
</script>

<template>
  <div class="status-bar">
    <div class="status-left">
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
      <span class="status-item" :class="compileStatus.cls">{{ compileStatus.text }}</span>
    </div>
  </div>
</template>

<style scoped>
.status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: var(--statusbar-height);
  padding: 0 10px;
  background: var(--bg-secondary);
  border-top: 1px solid var(--border);
  font-size: 12px;
  color: var(--text-secondary);
  flex-shrink: 0;
  user-select: none;
}
.status-left, .status-right {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
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
.status-item.error {
  color: var(--error);
}
.status-item.compiling {
  color: var(--accent);
}
</style>
