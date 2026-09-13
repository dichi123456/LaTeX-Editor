<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'run', command: string): void
}>()

interface Command {
  id: string
  label: string
  category: string
  shortcut?: string
}

const commands: Command[] = [
  { id: 'new-file', label: '新建文件', category: '文件', shortcut: 'Ctrl+N' },
  { id: 'open-file', label: '打开文件…', category: '文件', shortcut: 'Ctrl+O' },
  { id: 'open-folder', label: '打开文件夹…', category: '文件', shortcut: 'Ctrl+K' },
  { id: 'save', label: '保存', category: '文件', shortcut: 'Ctrl+S' },
  { id: 'save-as', label: '另存为…', category: '文件', shortcut: 'Ctrl+Shift+S' },
  { id: 'compile', label: '编译文档', category: '编译', shortcut: 'F5' },
  { id: 'clean', label: '清理辅助文件', category: '编译', shortcut: 'Ctrl+Shift+D' },
  { id: 'open-pdf', label: '在外部打开 PDF', category: '编译', shortcut: 'F7' },
  { id: 'toggle-sidebar', label: '切换文件树', category: '视图', shortcut: 'Ctrl+B' },
  { id: 'toggle-preview', label: '切换 PDF 预览', category: '视图', shortcut: 'Ctrl+Alt+P' },
  { id: 'toggle-log', label: '切换底部面板', category: '视图', shortcut: 'Ctrl+J' },
  { id: 'distraction-free', label: '切换全屏编辑', category: '视图', shortcut: 'F11' },
  { id: 'settings', label: '打开设置', category: '首选项', shortcut: 'Ctrl+,' },
  { id: 'command-palette', label: '显示所有命令', category: '帮助', shortcut: 'Ctrl+Shift+P' }
]

const query = ref('')
const selectedIndex = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)

const filtered = computed(() => {
  const q = query.value.toLowerCase().trim()
  if (!q) return commands
  return commands.filter(
    (c) =>
      c.label.toLowerCase().includes(q) ||
      c.category.toLowerCase().includes(q) ||
      c.id.toLowerCase().includes(q)
  )
})

function select(idx: number) {
  const list = filtered.value
  if (list.length === 0) return
  selectedIndex.value = ((idx % list.length) + list.length) % list.length
}

function execute() {
  const list = filtered.value
  if (list.length === 0) return
  const cmd = list[selectedIndex.value]
  if (cmd) emit('run', cmd.id)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    select(selectedIndex.value + 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    select(selectedIndex.value - 1)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    execute()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
  }
}

function onClickOverlay(e: MouseEvent) {
  if ((e.target as HTMLElement).classList.contains('palette-overlay')) {
    emit('close')
  }
}

onMounted(() => {
  nextTick(() => inputRef.value?.focus())
})

onUnmounted(() => {})
</script>

<template>
  <div class="palette-overlay" @click="onClickOverlay">
    <div class="palette-box">
      <div class="palette-input-row">
        <span class="palette-icon">›</span>
        <input
          ref="inputRef"
          v-model="query"
          class="palette-input"
          placeholder="输入命令名称…"
          @keydown="onKeydown"
        />
      </div>
      <div class="palette-list">
        <div
          v-for="(cmd, idx) in filtered"
          :key="cmd.id"
          class="palette-item"
          :class="{ selected: idx === selectedIndex }"
          @click="emit('run', cmd.id)"
          @mouseenter="selectedIndex = idx"
        >
          <span class="item-category">{{ cmd.category }}</span>
          <span class="item-label">{{ cmd.label }}</span>
          <span v-if="cmd.shortcut" class="item-shortcut">{{ cmd.shortcut }}</span>
        </div>
        <div v-if="filtered.length === 0" class="palette-empty">无匹配命令</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.palette-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  justify-content: center;
  padding-top: 80px;
  background: rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  animation: fadeIn 0.15s ease;
}

.palette-box {
  width: min(560px, 90vw);
  max-height: 400px;
  background: rgba(30, 30, 46, 0.55);
  backdrop-filter: blur(24px) saturate(1.6);
  -webkit-backdrop-filter: blur(24px) saturate(1.6);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  align-self: flex-start;
  animation: modalPop 0.18s ease;
}
[data-theme="light"] .palette-box {
  background: rgba(255, 255, 255, 0.55);
  border-color: rgba(0, 0, 0, 0.06);
}
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes modalPop {
  from { opacity: 0; transform: translateY(-8px) scale(0.97); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.palette-input-row {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  gap: 8px;
}

.palette-icon {
  color: var(--text-tertiary);
  font-size: 16px;
  font-weight: 700;
}

.palette-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 14px;
  font-family: var(--font-ui);
  padding: 4px 0;
}
.palette-input::placeholder {
  color: var(--text-tertiary);
}

.palette-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.palette-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 14px;
  cursor: pointer;
  font-size: 13px;
}
.palette-item.selected {
  background: var(--accent);
  color: #fff;
}
.palette-item.selected .item-category,
.palette-item.selected .item-shortcut {
  color: rgba(255, 255, 255, 0.7);
}

.item-category {
  font-size: 11px;
  color: var(--text-tertiary);
  min-width: 48px;
  flex-shrink: 0;
}

.item-label {
  flex: 1;
  color: var(--text-primary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-shortcut {
  font-size: 11px;
  color: var(--text-tertiary);
  font-family: var(--font-mono);
  flex-shrink: 0;
}

.palette-empty {
  text-align: center;
  color: var(--text-tertiary);
  padding: 20px;
  font-size: 13px;
}
</style>
