<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  TEMPLATE_NAV,
  filterTemplates,
  searchTemplates,
  type TemplateMeta
} from '../utils/templates'

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'use', payload: { template: TemplateMeta }): void
}>()

const activeNav = ref<string>('all')
const searchQuery = ref('')

const templates = computed(() => {
  if (searchQuery.value.trim()) {
    return searchTemplates(searchQuery.value)
  }
  const nav = TEMPLATE_NAV.find((n) => n.id === activeNav.value)
  return filterTemplates(nav?.category || '全部')
})

function selectNav(id: string) {
  activeNav.value = id
  searchQuery.value = ''
}

function useTemplate(t: TemplateMeta) {
  if (t.locked) {
    alert('该模板为精选付费模板，敬请期待 Pro 版本。')
    return
  }
  emit('use', { template: t })
}

function close() {
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div class="tpl-overlay" @click.self="close">
      <div class="tpl-modal">
        <div class="tpl-header">
          <h2>模板库</h2>
          <button class="tpl-close" @click="close">✕</button>
        </div>

        <div class="tpl-shell">
          <nav class="tpl-nav">
            <button
              v-for="item in TEMPLATE_NAV"
              :key="item.id"
              class="nav-item"
              :class="{ active: activeNav === item.id }"
              @click="selectNav(item.id)"
            >
              <span class="nav-icon">{{ item.icon }}</span>
              <span class="nav-label">{{ item.label }}</span>
            </button>
          </nav>

          <div class="tpl-main">
            <div class="tpl-toolbar">
              <input
                v-model="searchQuery"
                class="tpl-search"
                placeholder="搜索模板名称或描述…"
              />
            </div>

            <div class="tpl-body">
              <div v-if="templates.length === 0" class="tpl-empty">
                没有找到匹配的模板
              </div>
              <div v-else class="tpl-grid">
                <div
                  v-for="t in templates"
                  :key="t.id"
                  class="tpl-card"
                  :class="{ locked: t.locked }"
                  @click="useTemplate(t)"
                >
                  <div class="tpl-preview">
                    <img v-if="t.preview" :src="t.preview" :alt="t.name" />
                    <div v-else class="tpl-preview-placeholder">{{ t.name[0] }}</div>
                    <div v-if="t.locked" class="tpl-lock">🔒</div>
                  </div>
                  <div class="tpl-info">
                    <div class="tpl-name">{{ t.name }}</div>
                    <div class="tpl-desc">{{ t.description }}</div>
                    <div class="tpl-meta">
                      <span class="tpl-engine">{{ t.engine }}</span>
                      <span class="tpl-cat-badge">{{ t.category }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="tpl-footer">
          点击模板后，在系统对话框中选择或新建项目文件夹
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.tpl-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  animation: fadeIn 0.15s ease;
}
.tpl-modal {
  width: min(1040px, 78vw);
  height: min(720px, 82vh);
  min-height: min(520px, 82vh);
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: modalPop 0.2s ease;
}
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes modalPop {
  from { opacity: 0; transform: translateY(-10px) scale(0.97); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.tpl-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
}
.tpl-header h2 {
  font-size: 16px;
  font-weight: 600;
}
.tpl-close {
  font-size: 14px;
  color: var(--text-tertiary);
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
}
.tpl-close:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.tpl-shell {
  flex: 1;
  min-height: 0;
  display: flex;
}
.tpl-nav {
  width: 112px;
  flex-shrink: 0;
  padding: 12px 8px;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: var(--bg-secondary);
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
  transition: background 0.12s, color 0.12s;
  width: 100%;
}
.nav-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.nav-item.active {
  background: var(--accent-light);
  color: var(--accent);
  font-weight: 500;
}
.nav-icon {
  font-size: 13px;
  width: 16px;
  text-align: center;
  flex-shrink: 0;
}
.nav-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tpl-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.tpl-toolbar {
  padding: 12px 16px 0;
}
.tpl-search {
  width: 100%;
  padding: 7px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s;
  box-sizing: border-box;
}
.tpl-search:focus {
  border-color: var(--accent);
}

.tpl-body {
  flex: 1;
  overflow-y: auto;
  padding: 14px 16px 16px;
  min-height: 0;
}
.tpl-empty {
  text-align: center;
  color: var(--text-tertiary);
  padding: 40px 0;
  font-size: 13px;
}
.tpl-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 14px;
}
.tpl-card {
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s, transform 0.12s;
  background: var(--bg-primary);
}
.tpl-card:hover {
  border-color: var(--accent);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
  transform: translateY(-2px);
}
.tpl-card.locked {
  opacity: 0.7;
}
.tpl-card.locked:hover {
  opacity: 0.9;
}

.tpl-preview {
  position: relative;
  width: 100%;
  aspect-ratio: 200 / 260;
  background: var(--bg-tertiary);
  overflow: hidden;
}
.tpl-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.tpl-preview-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32px;
  font-weight: 700;
  color: var(--text-tertiary);
  background: var(--bg-tertiary);
}
.tpl-lock {
  position: absolute;
  top: 6px;
  right: 6px;
  font-size: 14px;
  background: rgba(0, 0, 0, 0.5);
  border-radius: 4px;
  padding: 2px 4px;
}

.tpl-info {
  padding: 10px 12px;
}
.tpl-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
}
.tpl-desc {
  font-size: 11px;
  color: var(--text-tertiary);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin-bottom: 6px;
  min-height: 30px;
}
.tpl-meta {
  display: flex;
  gap: 6px;
  align-items: center;
}
.tpl-engine {
  font-size: 10px;
  font-family: var(--font-mono);
  color: var(--accent);
  background: var(--accent-light);
  padding: 1px 6px;
  border-radius: 3px;
}
.tpl-cat-badge {
  font-size: 10px;
  color: var(--text-tertiary);
  background: var(--bg-tertiary);
  padding: 1px 6px;
  border-radius: 3px;
}

.tpl-footer {
  padding: 10px 18px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--text-tertiary);
  text-align: center;
}
</style>
