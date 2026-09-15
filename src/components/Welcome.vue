<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useDocStore } from '../stores/docs'

const docStore = useDocStore()
const emit = defineEmits<{
  (e: 'new-file'): void
  (e: 'open-file'): void
  (e: 'open-folder'): void
  (e: 'open-template-library'): void
}>()

const recentFiles = ref<string[]>([])
const recentWorkspaces = ref<string[]>([])

// 右键菜单
const ctxMenu = ref({ show: false, x: 0, y: 0 })
function onContextMenu(e: MouseEvent) {
  e.preventDefault()
  window.dispatchEvent(new CustomEvent('close-all-menus'))
  ctxMenu.value = { show: true, x: e.clientX, y: e.clientY }
}
function closeCtx() { ctxMenu.value.show = false }
function onGlobalClick(e: MouseEvent) {
  if (!(e.target as HTMLElement).closest('.welcome-ctx')) closeCtx()
}
function onCtxAction(action: string) {
  closeCtx()
  if (action === 'new-file') emit('new-file')
  else if (action === 'open-file') emit('open-file')
  else if (action === 'open-folder') emit('open-folder')
}

onMounted(async () => {
  await docStore.loadRecent()
  recentFiles.value = docStore.recentFiles
  recentWorkspaces.value = docStore.recentWorkspaces
  document.addEventListener('click', onGlobalClick)
})
onUnmounted(() => {
  document.removeEventListener('click', onGlobalClick)
})

async function openRecentFile(path: string) {
  await docStore.openFile(path)
}

async function openRecentWorkspace(path: string) {
  await docStore.openProjectFolder(path)
}

function shortName(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

function shortPath(path: string): string {
  const parts = path.split(/[\\/]/)
  if (parts.length <= 3) return path
  return '…\\' + parts.slice(-3).join('\\')
}
</script>

<template>
  <div class="welcome" @contextmenu="onContextMenu">
    <!-- 右键菜单 -->
    <Teleport to="body">
      <div
        v-if="ctxMenu.show"
        class="welcome-ctx"
        :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }"
        @click.stop
      >
        <button class="wctx-item" @click="onCtxAction('new-file')">
          <span class="wctx-icon">📄</span> 新建文件
          <span class="wctx-key">Ctrl+N</span>
        </button>
        <button class="wctx-item" @click="onCtxAction('open-file')">
          <span class="wctx-icon">📂</span> 打开文件…
          <span class="wctx-key">Ctrl+O</span>
        </button>
        <button class="wctx-item" @click="onCtxAction('open-folder')">
          <span class="wctx-icon">📁</span> 打开文件夹…
          <span class="wctx-key">Ctrl+K</span>
        </button>
      </div>
    </Teleport>

    <div class="welcome-container">
      <!-- 左侧：启动 + 最近 -->
      <div class="welcome-main">
        <div class="welcome-header">
          <h1 class="welcome-title">LaTeX 编辑器</h1>
          <p class="welcome-subtitle">编辑 · 编译 · 预览 — 本地一体化工作流</p>
        </div>

        <!-- 启动 -->
        <section class="welcome-section">
          <h2 class="section-title">启动</h2>
          <div class="action-list">
            <button class="action-link" @click="emit('new-file')">
              <span class="action-icon">📄</span>
              <span class="action-text">新建文档</span>
              <span class="action-key">Ctrl+N</span>
            </button>
            <button class="action-link" @click="emit('open-file')">
              <span class="action-icon">📂</span>
              <span class="action-text">打开文件…</span>
              <span class="action-key">Ctrl+O</span>
            </button>
            <button class="action-link" @click="emit('open-folder')">
              <span class="action-icon">📁</span>
              <span class="action-text">打开文件夹…</span>
              <span class="action-key">Ctrl+K</span>
            </button>
          </div>
        </section>

        <!-- 最近 -->
        <section class="welcome-section" v-if="recentWorkspaces.length > 0 || recentFiles.length > 0">
          <h2 class="section-title">最近</h2>

          <!-- 工作区 -->
          <div v-if="recentWorkspaces.length > 0" class="recent-group">
            <div
              v-for="path in recentWorkspaces.slice(0, 5)"
              :key="'ws-' + path"
              class="recent-row"
              @click="openRecentWorkspace(path)"
              :title="path"
            >
              <span class="recent-badge ws">工作区</span>
              <span class="recent-name">{{ shortName(path) }}</span>
              <span class="recent-path">{{ shortPath(path) }}</span>
            </div>
          </div>

          <!-- 文件 -->
          <div v-if="recentFiles.length > 0" class="recent-group">
            <div
              v-for="path in recentFiles.slice(0, 6)"
              :key="'file-' + path"
              class="recent-row"
              @click="openRecentFile(path)"
              :title="path"
            >
              <span class="recent-badge file">文件</span>
              <span class="recent-name">{{ shortName(path) }}</span>
              <span class="recent-path">{{ shortPath(path) }}</span>
            </div>
          </div>
        </section>

        <!-- 模板库入口 -->
        <section class="welcome-section">
          <h2 class="section-title">模板库</h2>
          <button class="tpl-entry" @click="emit('open-template-library')">
            <span class="tpl-entry-icon">📋</span>
            <div class="tpl-entry-body">
              <div class="tpl-entry-title">浏览模板库</div>
              <div class="tpl-entry-desc">中文论文 · 简历 · 幻灯片 · 实验报告等内置模板</div>
            </div>
            <span class="tpl-entry-arrow">→</span>
          </button>
        </section>
      </div>

      <!-- 右侧：演练 / 提示 -->
      <div class="welcome-side">
        <section class="welcome-section">
          <h2 class="section-title">演练</h2>
          <div class="tip-list">
            <div class="tip-item">
              <span class="tip-icon">⌨️</span>
              <div class="tip-body">
                <div class="tip-title">快捷键速查</div>
                <div class="tip-desc">
                  <kbd>F5</kbd> 编译 ·
                  <kbd>Ctrl+S</kbd> 保存 ·
                  <kbd>Ctrl+Shift+P</kbd> 命令面板
                </div>
              </div>
            </div>
            <div class="tip-item">
              <span class="tip-icon">🔄</span>
              <div class="tip-body">
                <div class="tip-title">SyncTeX 同步</div>
                <div class="tip-desc">
                  编辑器 <kbd>双击</kbd> 或 <kbd>Ctrl+Click</kbd> → 跳转 PDF<br />
                  PDF <kbd>双击</kbd> 或 <kbd>Ctrl+Click</kbd> → 跳转源码
                </div>
              </div>
            </div>
            <div class="tip-item">
              <span class="tip-icon">📚</span>
              <div class="tip-body">
                <div class="tip-title">BibTeX 引用</div>
                <div class="tip-desc">
                  打开工作区后自动扫描 .bib 文件，<br />
                  <kbd>\cite{}</kbd> 内自动补全引用键
                </div>
              </div>
            </div>
            <div class="tip-item">
              <span class="tip-icon">⚙️</span>
              <div class="tip-body">
                <div class="tip-title">TeX Live 配置</div>
                <div class="tip-desc">
                  需要本机安装 TeX Live 2024。<br />
                  未检测到时可在设置中手动指定路径。
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class="welcome-section">
          <h2 class="section-title">内置模板</h2>
          <div class="template-list">
            <span class="template-tag">中文论文</span>
            <span class="template-tag">实验报告</span>
            <span class="template-tag">中文简历</span>
            <span class="template-tag">Beamer 幻灯片</span>
            <span class="template-tag">英文论文</span>
          </div>
          <p class="template-hint">新建文档时可从模板开始</p>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.welcome {
  flex: 1;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  background: var(--bg-primary);
  overflow: auto;
  padding: 48px 32px 32px;
}

.welcome-container {
  display: flex;
  gap: 64px;
  max-width: 900px;
  width: 100%;
}

.welcome-main {
  flex: 1;
  min-width: 0;
}

.welcome-side {
  width: 300px;
  flex-shrink: 0;
}

.welcome-header {
  margin-bottom: 36px;
}

.welcome-title {
  font-size: 32px;
  font-weight: 300;
  color: var(--text-primary);
  margin-bottom: 8px;
  letter-spacing: -0.5px;
}

.welcome-subtitle {
  font-size: 14px;
  color: var(--text-tertiary);
}

.welcome-section {
  margin-bottom: 32px;
}

/* 模板库入口（毛玻璃） */
.tpl-entry {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px 14px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: var(--radius);
  background: rgba(30, 30, 46, 0.3);
  backdrop-filter: blur(20px) saturate(1.6);
  -webkit-backdrop-filter: blur(20px) saturate(1.6);
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
}
.tpl-entry:hover {
  border-color: var(--accent);
  background: rgba(30, 30, 46, 0.45);
  box-shadow: 0 2px 16px rgba(0, 0, 0, 0.08);
}
[data-theme="light"] .tpl-entry {
  background: rgba(255, 255, 255, 0.3);
  border-color: rgba(0, 0, 0, 0.06);
}
[data-theme="light"] .tpl-entry:hover {
  background: rgba(255, 255, 255, 0.45);
}
.tpl-entry-icon {
  font-size: 22px;
  flex-shrink: 0;
}
.tpl-entry-body {
  flex: 1;
  min-width: 0;
}
.tpl-entry-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 2px;
}
.tpl-entry-desc {
  font-size: 11px;
  color: var(--text-tertiary);
}
.tpl-entry-arrow {
  font-size: 16px;
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.tpl-entry:hover .tpl-entry-arrow {
  color: var(--accent);
}

.section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 12px;
  text-transform: none;
  letter-spacing: 0;
}

/* 启动动作列表 */
.action-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.action-link {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  text-align: left;
  width: 100%;
  border: none;
  background: transparent;
  cursor: pointer;
  transition: background 0.1s;
}
.action-link:hover {
  background: var(--bg-hover);
}

.action-icon {
  font-size: 16px;
  width: 20px;
  text-align: center;
  flex-shrink: 0;
}

.action-text {
  flex: 1;
  font-size: 13px;
  color: var(--accent);
  font-weight: 400;
}

.action-link:hover .action-text {
  text-decoration: underline;
}

.action-key {
  font-size: 11px;
  color: var(--text-tertiary);
  font-family: var(--font-mono);
  flex-shrink: 0;
}

/* 最近列表 */
.recent-group {
  margin-bottom: 8px;
}

.recent-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.1s;
  font-size: 13px;
}
.recent-row:hover {
  background: var(--bg-hover);
}

.recent-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 3px;
  font-weight: 600;
  flex-shrink: 0;
  letter-spacing: 0.3px;
}
.recent-badge.ws {
  background: var(--accent-light);
  color: var(--accent);
}
.recent-badge.file {
  background: var(--bg-active);
  color: var(--text-secondary);
}

.recent-name {
  color: var(--accent);
  font-weight: 400;
  flex-shrink: 0;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.recent-row:hover .recent-name {
  text-decoration: underline;
}

.recent-path {
  color: var(--text-tertiary);
  font-size: 12px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: right;
}

/* 右侧提示 */
.tip-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.tip-item {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.tip-icon {
  font-size: 18px;
  flex-shrink: 0;
  margin-top: 1px;
}

.tip-body {
  min-width: 0;
}

.tip-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: 3px;
}

.tip-desc {
  font-size: 12px;
  color: var(--text-tertiary);
  line-height: 1.6;
}

.tip-desc kbd {
  font-family: var(--font-mono);
  font-size: 11px;
  padding: 1px 5px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
}

/* 模板标签 */
.template-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

.template-tag {
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  color: var(--text-secondary);
}

.template-hint {
  font-size: 11px;
  color: var(--text-tertiary);
}

/* 右键菜单 */
.welcome-ctx {
  position: fixed;
  z-index: 10000;
  background: rgba(30, 30, 46, 0.3);
  backdrop-filter: blur(20px) saturate(1.6);
  -webkit-backdrop-filter: blur(20px) saturate(1.6);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  box-shadow: var(--shadow-lg);
  min-width: 200px;
  padding: 4px 0;
  animation: menuPop 0.14s ease;
}
[data-theme="light"] .welcome-ctx {
  background: rgba(255, 255, 255, 0.3);
  border-color: rgba(0, 0, 0, 0.06);
}
@keyframes menuPop {
  from { opacity: 0; transform: translateY(-4px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.wctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 14px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-primary);
  text-align: left;
}
.wctx-item:hover {
  background: var(--accent);
  color: #fff;
}
.wctx-item:hover .wctx-key { color: rgba(255,255,255,0.8); }
.wctx-icon { font-size: 13px; }
.wctx-key {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-tertiary);
}

/* 响应式 */
@media (max-width: 760px) {
  .welcome-container {
    flex-direction: column;
    gap: 24px;
  }
  .welcome-side {
    width: 100%;
  }
}
</style>
