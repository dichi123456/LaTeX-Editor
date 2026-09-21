<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useDocStore } from '../stores/docs'

const docStore = useDocStore()

interface OutlineItem {
  level: number // 1=chapter/section, 2=subsection, etc.
  title: string
  line: number
}

const items = ref<OutlineItem[]>([])
const activeName = ref('')
const isTex = ref(false)

const activeTab = computed(() => docStore.activeTab)
const activeId = computed(() => docStore.activeTabId)
const activePath = computed(() => docStore.activeTab?.path || '')

/** 解析章节大纲；兼容可选参数 [short] 与一层嵌套 {} */
function parseOutline(content: string): OutlineItem[] {
  const result: OutlineItem[] = []
  const lines = content.split('\n')
  // \section[opt]{title} / \section*{title}；title 允许一层嵌套
  const sectionRe =
    /\\(chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?(?:\[[^\]]*\])?\{((?:[^{}]|\\{|\\}|\{[^{}]*\})*)\}/g
  const levelMap: Record<string, number> = {
    chapter: 1,
    section: 2,
    subsection: 3,
    subsubsection: 4,
    paragraph: 5,
    subparagraph: 6
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    sectionRe.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = sectionRe.exec(line)) !== null) {
      const cmd = m[1]
      const title = m[2]
        .replace(/\\[a-zA-Z]+\*?/g, '')
        .replace(/[{}]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
      result.push({
        level: levelMap[cmd] || 2,
        title: title || '(无标题)',
        line: i + 1
      })
    }
  }
  return result
}

function jumpToLine(line: number) {
  window.dispatchEvent(new CustomEvent('jump-to-line', { detail: { line } }))
}

/** 跟随当前打开的 tex：切换标签/路径/内容时都重算 */
function refreshOutline() {
  const tab = activeTab.value
  activeName.value = tab?.name || ''
  const path = tab?.path || ''
  const name = tab?.name || ''
  isTex.value = /\.tex$/i.test(path) || /\.tex$/i.test(name)
  if (!tab || !isTex.value) {
    items.value = []
    return
  }
  items.value = parseOutline(tab.content || '')
}

watch(
  [activeId, activePath, () => activeTab.value?.content, () => activeTab.value?.name],
  () => refreshOutline(),
  { immediate: true }
)
</script>

<template>
  <div class="outline-panel">
    <div v-if="activeName" class="outline-file truncate" :title="activeName">
      {{ activeName }}
    </div>
    <div v-if="!isTex" class="outline-empty">
      在编辑区打开 .tex 后，此处显示该文件的大纲
    </div>
    <div v-else-if="items.length === 0" class="outline-empty">
      当前 .tex 暂无章节结构
    </div>
    <div v-else class="outline-list">
      <button
        v-for="(item, idx) in items"
        :key="`${activeId}-${idx}`"
        class="outline-item"
        :class="`level-${item.level}`"
        @click="jumpToLine(item.line)"
        :title="`第 ${item.line} 行 · ${item.title}`"
      >
        <span class="outline-title truncate">{{ item.title }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.outline-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.outline-file {
  padding: 4px 10px 2px;
  font-size: 10px;
  color: var(--text-tertiary);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.outline-empty {
  padding: 12px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 11px;
}
.outline-list {
  display: flex;
  flex-direction: column;
  padding: 2px 0;
  overflow-y: auto;
  min-height: 0;
  flex: 1;
}
.outline-item {
  display: flex;
  align-items: center;
  padding: 3px 8px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  font-size: 12px;
  color: var(--text-primary);
  border-radius: 3px;
  transition: background 0.1s;
}
.outline-item:hover {
  background: var(--bg-hover);
}
.outline-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 缩进级别 */
.level-1 { padding-left: 8px; font-weight: 600; }
.level-2 { padding-left: 16px; }
.level-3 { padding-left: 28px; color: var(--text-secondary); }
.level-4 { padding-left: 40px; color: var(--text-secondary); font-size: 11px; }
.level-5 { padding-left: 52px; color: var(--text-tertiary); font-size: 11px; }
.level-6 { padding-left: 64px; color: var(--text-tertiary); font-size: 11px; }
</style>
