<script setup lang="ts">
import type { PropType } from 'vue'
import type { DirEntry } from '../types'

defineProps({
  entry: { type: Object as PropType<DirEntry>, required: true },
  depth: { type: Number, default: 0 },
  expandedSet: { type: Object as PropType<Set<string>>, required: true },
  selectedPath: { type: String as PropType<string | null>, default: null },
  renaming: { type: String as PropType<string | null>, default: null },
  renameValue: { type: String, default: '' },
  isMain: { type: Function as PropType<(e: DirEntry) => boolean>, required: true },
  iconFor: { type: Function as PropType<(e: DirEntry) => string>, required: true }
})

const emit = defineEmits<{
  (e: 'toggle', path: string): void
  (e: 'open', entry: DirEntry): void
  (e: 'delete', entry: DirEntry): void
  (e: 'start-rename', entry: DirEntry): void
  (e: 'confirm-rename', entry: DirEntry): void
  (e: 'update-rename', value: string): void
}>()
</script>

<template>
  <div class="tree-node">
    <div
      class="tree-item"
      :class="{
        selected: selectedPath === entry.path,
        main: isMain(entry)
      }"
      :style="{ paddingLeft: depth * 14 + 8 + 'px' }"
      @click="emit('open', entry)"
    >
      <span
        class="tree-icon"
        @click.stop="entry.isDirectory && emit('toggle', entry.path)"
      >
        {{ entry.isDirectory ? (expandedSet.has(entry.path) ? '📂' : '📁') : iconFor(entry) }}
      </span>

      <template v-if="renaming === entry.path">
        <input
          class="rename-input"
          :value="renameValue"
          @input="emit('update-rename', ($event.target as HTMLInputElement).value)"
          @keyup.enter="emit('confirm-rename', entry)"
          @keyup.esc="emit('update-rename', entry.name)"
          @blur="emit('confirm-rename', entry)"
          @click.stop
          autofocus
        />
      </template>
      <span v-else class="tree-name truncate" :class="{ 'main-label': isMain(entry) }">
        {{ entry.name }}<template v-if="isMain(entry)"> ★</template>
      </span>

      <span class="tree-item-actions" @click.stop>
        <button class="icon-btn" title="设为主文档" @click.stop="isMain(entry) || $emit('open', entry)">★</button>
        <button class="icon-btn" title="重命名" @click.stop="emit('start-rename', entry)">✎</button>
        <button class="icon-btn danger" title="删除" @click.stop="emit('delete', entry)">✕</button>
      </span>
    </div>

    <template v-if="entry.isDirectory && expandedSet.has(entry.path) && entry.children">
      <TreeNode
        v-for="child in entry.children"
        :key="child.path"
        :entry="child"
        :depth="depth + 1"
        :expanded-set="expandedSet"
        :selected-path="selectedPath"
        :renaming="renaming"
        :rename-value="renameValue"
        :is-main="isMain"
        :icon-for="iconFor"
        @toggle="emit('toggle', $event)"
        @open="emit('open', $event)"
        @delete="emit('delete', $event)"
        @start-rename="emit('start-rename', $event)"
        @confirm-rename="emit('confirm-rename', $event)"
        @update-rename="emit('update-rename', $event)"
      />
    </template>
  </div>
</template>

<script lang="ts">
// 递归组件需要 name
export default {
  name: 'TreeNode'
}
</script>

<style scoped>
.tree-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  cursor: pointer;
  user-select: none;
  min-height: 26px;
}
.tree-item:hover {
  background: var(--bg-hover);
}
.tree-item.selected {
  background: var(--accent-light);
}
.tree-icon {
  font-size: 14px;
  flex-shrink: 0;
  width: 18px;
  text-align: center;
}
.tree-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
  font-size: 13px;
}
.tree-name.main-label {
  color: var(--accent);
  font-weight: 600;
}
.tree-item-actions {
  display: none;
  gap: 2px;
  flex-shrink: 0;
}
.tree-item:hover .tree-item-actions {
  display: flex;
}
.icon-btn {
  font-size: 11px;
  padding: 1px 3px;
  color: var(--text-tertiary);
  border-radius: 3px;
}
.icon-btn:hover {
  background: var(--bg-active);
  color: var(--text-primary);
}
.icon-btn.danger:hover {
  color: var(--error);
  background: var(--error-bg);
}
.rename-input {
  flex: 1;
  min-width: 0;
  padding: 1px 4px;
  font-size: 12px;
  border: 1px solid var(--accent);
  background: var(--bg-primary);
  color: var(--text-primary);
}
</style>
