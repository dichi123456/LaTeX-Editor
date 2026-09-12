<script setup lang="ts">
import { ref } from 'vue'
import { useDocStore } from '../stores/docs'

const docStore = useDocStore()
const dragId = ref<string | null>(null)
const dropTargetId = ref<string | null>(null)

function activate(id: string) {
  docStore.activeTabId = id
}

function close(e: MouseEvent, id: string) {
  e.stopPropagation()
  const tab = docStore.tabs.find((t) => t.id === id)
  if (tab?.isDirty) {
    if (!confirm(`「${tab.name}」有未保存的更改，确定关闭？`)) return
  }
  docStore.closeTab(id)
}

function onDragStart(e: DragEvent, id: string) {
  dragId.value = id
  e.dataTransfer?.setData('text/plain', id)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

function onDragOver(e: DragEvent, id: string) {
  e.preventDefault()
  if (dragId.value && dragId.value !== id) {
    dropTargetId.value = id
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  }
}

function onDrop(e: DragEvent, targetId: string) {
  e.preventDefault()
  if (dragId.value && dragId.value !== targetId) {
    docStore.moveTab(dragId.value, targetId)
  }
  dragId.value = null
  dropTargetId.value = null
}

function onDragEnd() {
  dragId.value = null
  dropTargetId.value = null
}
</script>

<template>
  <div class="tabs-bar">
    <div class="tabs-scroll">
      <div
        v-for="tab in docStore.tabs"
        :key="tab.id"
        class="tab-item"
        :class="{
          active: docStore.activeTabId === tab.id,
          dragging: dragId === tab.id,
          'drop-target': dropTargetId === tab.id
        }"
        draggable="true"
        @click="activate(tab.id)"
        @dragstart="onDragStart($event, tab.id)"
        @dragover="onDragOver($event, tab.id)"
        @drop="onDrop($event, tab.id)"
        @dragend="onDragEnd"
        :title="tab.path || tab.name"
      >
        <span class="tab-name">{{ tab.name }}</span>
        <span v-if="tab.isDirty" class="tab-dirty" title="未保存">●</span>
        <button class="tab-close" title="关闭" @click="close($event, tab.id)">✕</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tabs-bar {
  display: flex;
  height: var(--tab-height);
  background: transparent;
  flex-shrink: 0;
  overflow: hidden;
  position: relative;
}
.tabs-bar::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 10px;
  right: 10px;
  height: 1px;
  background: var(--border);
}
.tabs-scroll {
  display: flex;
  overflow-x: auto;
  overflow-y: hidden;
  flex: 1;
  scrollbar-width: thin;
}
.tabs-scroll::-webkit-scrollbar {
  height: 3px;
}
.tab-item {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 0 10px;
  height: 100%;
  border-right: 1px solid var(--border);
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  font-size: 12px;
  color: var(--text-secondary);
  max-width: 180px;
  min-width: 60px;
  flex-shrink: 0;
  transition: background 0.1s, color 0.1s, opacity 0.15s;
}
.tab-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.tab-item.active {
  background: var(--bg-primary);
  color: var(--text-primary);
  border-bottom: 2px solid var(--accent);
  font-weight: 500;
}
.tab-item.dragging {
  opacity: 0.4;
}
.tab-item.drop-target {
  border-left: 2px solid var(--accent);
}
.tab-name {
  max-width: 130px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tab-dirty {
  color: var(--warning);
  font-size: 9px;
  flex-shrink: 0;
}
.tab-close {
  font-size: 10px;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  color: var(--text-tertiary);
  border-radius: 3px;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.1s;
}
.tab-item:hover .tab-close {
  opacity: 1;
}
.tab-close:hover {
  background: var(--bg-active);
  color: var(--error);
}
</style>
