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

const activeContent = computed(() => docStore.activeTab?.content || '')

function parseOutline(content: string): OutlineItem[] {
  const result: OutlineItem[] = []
  const lines = content.split('\n')
  const sectionRe = /\\(chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\{([^}]*)\}/g

  for (let i = 0; i < lines.length; i++) {
    let m: RegExpExecArray | null
    const line = lines[i]
    sectionRe.lastIndex = 0
    while ((m = sectionRe.exec(line)) !== null) {
      const cmd = m[1]
      const title = m[2].replace(/\\[a-zA-Z]+\{([^}]*)\}/g, '$1').trim() // 简单去除嵌套命令
      const levelMap: Record<string, number> = {
        chapter: 1, section: 2, subsection: 3,
        subsubsection: 4, paragraph: 5, subparagraph: 6
      }
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

watch(
  activeContent,
  (content) => {
    items.value = content ? parseOutline(content) : []
  },
  { immediate: true }
)
</script>

<template>
  <div class="outline-panel">
    <div v-if="items.length === 0" class="outline-empty">
      打开 .tex 文件后此处显示大纲
    </div>
    <div v-else class="outline-list">
      <button
        v-for="(item, idx) in items"
        :key="idx"
        class="outline-item"
        :class="`level-${item.level}`"
        @click="jumpToLine(item.line)"
        :title="`第 ${item.line} 行`"
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
