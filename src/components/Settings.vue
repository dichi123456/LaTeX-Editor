<script setup lang="ts">
import { ref, watch } from 'vue'
import { useConfigStore } from '../stores/config'
import { useCompileStore } from '../stores/compile'
import { useAiStore } from '../stores/ai'

const configStore = useConfigStore()
const compileStore = useCompileStore()
const aiStore = useAiStore()

const local = ref<AppConfig | null>(null)
const aiLocal = ref({ ...aiStore.aiConfig })
const models = ref<Array<{ id: string; name: string; owned_by: string }>>([])
const fetchingModels = ref(false)

async function fetchModels() {
  if (!aiLocal.value.apiBase || !aiLocal.value.apiKey) return
  fetchingModels.value = true
  try {
    const result = await window.electronAPI.aiFetchModels({
      apiBase: aiLocal.value.apiBase,
      apiKey: aiLocal.value.apiKey
    })
    if (result.success && result.models.length > 0) {
      models.value = result.models
      // 如果没有选过模型，默认选前3个
      if (aiLocal.value.selectedModels.length === 0) {
        aiLocal.value.selectedModels = result.models.slice(0, 3).map((m) => m.id)
      }
      // 确保当前模型在选中列表中
      if (!aiLocal.value.selectedModels.includes(aiLocal.value.model)) {
        if (aiLocal.value.selectedModels.length > 0) {
          aiLocal.value.model = aiLocal.value.selectedModels[0]
        }
      }
    } else {
      alert(`获取模型列表失败: ${result.error || '无可用模型'}\n\n请检查 API 地址和 Key 是否正确。`)
    }
  } catch (err: any) {
    alert(`请求失败: ${err.message}`)
  } finally {
    fetchingModels.value = false
  }
}

function toggleModel(id: string) {
  const idx = aiLocal.value.selectedModels.indexOf(id)
  if (idx >= 0) {
    aiLocal.value.selectedModels.splice(idx, 1)
    // 如果取消的是当前模型，切换到第一个选中的
    if (aiLocal.value.model === id && aiLocal.value.selectedModels.length > 0) {
      aiLocal.value.model = aiLocal.value.selectedModels[0]
    }
  } else {
    aiLocal.value.selectedModels.push(id)
    // 如果还没有当前模型，设为新选的
    if (!aiLocal.value.model || !aiLocal.value.selectedModels.includes(aiLocal.value.model)) {
      aiLocal.value.model = id
    }
  }
}

watch(
  () => configStore.config,
  (c) => {
    if (c) local.value = { ...c }
  },
  { immediate: true, deep: true }
)

watch(
  () => aiStore.aiConfig,
  (c) => { aiLocal.value = { ...c } },
  { deep: true }
)

async function save() {
  if (local.value) {
    await configStore.save(local.value)
    if (local.value.texlivePath) {
      compileStore.texLivePath = local.value.texlivePath
      compileStore.texLiveFound = true
    }
  }
  // 保存 AI 配置
  aiStore.aiConfig = { ...aiLocal.value }
  aiStore.saveConfig()
  configStore.showSettings = false
}

function cancel() {
  configStore.showSettings = false
}

async function browseTexlive() {
  const dir = await window.electronAPI.chooseDirectory()
  if (dir && local.value) {
    local.value.texlivePath = dir
  }
}

async function detect() {
  await compileStore.detectTexLive()
  if (compileStore.texLiveFound && local.value) {
    local.value.texlivePath = compileStore.texLivePath || ''
  }
}

// 左侧导航
const activeSection = ref('compile')
const sections = [
  { id: 'compile', label: '编译', icon: '⚙' },
  { id: 'editor', label: '编辑器', icon: '✎' },
  { id: 'appearance', label: '外观', icon: '◐' },
  { id: 'ai', label: '墨灵 AI', icon: '💬' }
]
function scrollToSection(id: string) {
  activeSection.value = id
  const el = document.getElementById(`sec-${id}`)
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
</script>

<template>
  <div class="settings-overlay" @click.self="cancel">
    <div class="settings-modal">
      <div class="settings-header">
        <h2>设置</h2>
        <button class="close-btn" @click="cancel">✕</button>
      </div>

      <div v-if="local" class="settings-body">
        <!-- 左侧导航 -->
        <nav class="settings-nav">
          <button
            v-for="s in sections"
            :key="s.id"
            class="nav-item"
            :class="{ active: activeSection === s.id }"
            @click="scrollToSection(s.id)"
          >
            <span class="nav-icon">{{ s.icon }}</span>
            {{ s.label }}
          </button>
        </nav>

        <!-- 右侧内容 -->
        <div class="settings-content">
        <!-- 编译 -->
        <section id="sec-compile" class="settings-section">
          <h3>编译</h3>
          <div class="setting-row">
            <label>编译引擎</label>
            <select v-model="local.engine">
              <option value="xelatex">XeLaTeX（推荐，中文）</option>
              <option value="lualatex">LuaLaTeX</option>
              <option value="pdflatex">pdfLaTeX</option>
              <option value="latexmk">latexmk</option>
            </select>
          </div>
          <div class="setting-row">
            <label>TeX Live 路径</label>
            <div class="path-row">
              <input type="text" v-model="local.texlivePath" placeholder="如 C:\texlive\2024\bin\windows" />
              <button @click="browseTexlive" class="btn-secondary">浏览…</button>
              <button @click="detect" class="btn-secondary">自动检测</button>
            </div>
            <small class="setting-hint">
              留空则使用 PATH 中的编译器。
              <span v-if="compileStore.texLiveFound" class="text-success">已检测到 ✓</span>
              <span v-else class="text-error">未检测到</span>
            </small>
          </div>
          <div class="setting-row">
            <label>额外编译参数</label>
            <input type="text" v-model="local.extraArgs" placeholder="如 -shell-escape -synctex=1" />
          </div>
          <div class="setting-row">
            <label>编译超时（秒）</label>
            <input type="number" v-model.number="local.timeout" min="10" max="600" />
          </div>
          <div class="setting-row checkbox-row">
            <label>
              <input type="checkbox" v-model="local.autoCompile" />
              保存后自动编译
            </label>
          </div>
          <div class="setting-row checkbox-row">
            <label>
              <input type="checkbox" v-model="local.notifications" />
              编译完成时系统通知
            </label>
          </div>
        </section>

        <!-- 编辑器 -->
        <section id="sec-editor" class="settings-section">
          <h3>编辑器</h3>
          <div class="setting-row">
            <label>字体大小</label>
            <input type="number" v-model.number="local.fontSize" min="10" max="24" />
          </div>
          <div class="setting-row">
            <label>等宽字体</label>
            <input type="text" v-model="local.fontFamily" />
          </div>
          <div class="setting-row checkbox-row">
            <label>
              <input type="checkbox" v-model="local.showLineNumbers" />
              显示行号
            </label>
          </div>
          <div class="setting-row checkbox-row">
            <label>
              <input type="checkbox" v-model="local.autoSave" />
              自动保存
            </label>
          </div>
          <div class="setting-row">
            <label>自动保存间隔（秒）</label>
            <input type="number" v-model.number="local.autoSaveInterval" min="5" max="300" />
          </div>
        </section>

        <!-- 外观 -->
        <section id="sec-appearance" class="settings-section">
          <h3>外观</h3>
          <div class="setting-row">
            <label>主题</label>
            <select v-model="local.theme">
              <option value="light">浅色</option>
              <option value="dark">深色</option>
              <option value="system">跟随系统</option>
            </select>
            <small class="setting-hint">选择「跟随系统」将根据 Windows 深色/浅色模式自动切换</small>
          </div>
        </section>

        <!-- AI 助手 -->
        <section id="sec-ai" class="settings-section">
          <h3>墨灵 AI 助手</h3>
          <div class="setting-row">
            <label>API 地址（OpenAI 兼容）</label>
            <input type="text" v-model="aiLocal.apiBase" placeholder="https://api.deepseek.com/v1" />
            <small class="setting-hint">
              支持 DeepSeek、Moonshot、智谱、OpenAI 等兼容 /chat/completions 接口
            </small>
          </div>
          <div class="setting-row">
            <label>API Key</label>
            <div class="path-row">
              <input type="password" v-model="aiLocal.apiKey" placeholder="sk-..." />
              <button @click="fetchModels" class="btn-secondary" :disabled="fetchingModels || !aiLocal.apiBase || !aiLocal.apiKey">
                {{ fetchingModels ? '获取中…' : '获取模型' }}
              </button>
            </div>
          </div>
          <div class="setting-row">
            <label>启用的模型（可多选，发送框中可切换）</label>
            <div v-if="models.length > 0" class="model-check-list">
              <label v-for="m in models" :key="m.id" class="model-check-item">
                <input
                  type="checkbox"
                  :checked="aiLocal.selectedModels.includes(m.id)"
                  @change="toggleModel(m.id)"
                />
                <span class="model-check-name">{{ m.name }}</span>
                <span v-if="m.owned_by" class="model-check-owner">{{ m.owned_by }}</span>
              </label>
            </div>
            <div v-else class="path-row">
              <input type="text" v-model="aiLocal.model" placeholder="deepseek-chat" />
            </div>
            <small class="setting-hint">
              <template v-if="models.length > 0">
                已选 {{ aiLocal.selectedModels.length }} 个模型。发送框中可随时切换。
              </template>
              <template v-else>
                输入 API Key 后点击「获取模型」加载列表，然后勾选要启用的模型。
              </template>
            </small>
          </div>
          <div class="setting-row">
            <label>系统提示词</label>
            <textarea v-model="aiLocal.systemPrompt" rows="3" style="width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:4px;background:var(--bg-primary);color:var(--text-primary);resize:vertical;"></textarea>
          </div>
          <div class="setting-row">
            <label>温度 ({{ aiLocal.temperature }})</label>
            <input type="range" v-model.number="aiLocal.temperature" min="0" max="2" step="0.1" style="width:100%;" />
            <small style="display:block;margin-top:4px;color:var(--text-tertiary);font-size:11px;">输出长度由所选模型的上下文能力自动决定，无需手动限制</small>
          </div>
          <div class="setting-row">
            <label>最大迭代步数 ({{ aiLocal.maxSteps }})</label>
            <input
              type="range"
              v-model.number="aiLocal.maxSteps"
              min="1"
              max="100"
              step="1"
              style="width:100%;"
            />
            <small class="setting-hint">
              Agent 单轮最多执行多少步工具调用（Kilo Code 风格）。步数用尽时会自动关闭工具并让模型总结进展，而不是中途硬断。
              复杂改稿建议 30–50；太小容易「没做完就停」。
            </small>
          </div>
        </section>
        </div><!-- /settings-content -->
      </div>

      <div class="settings-footer">
        <button @click="cancel" class="btn-secondary">取消</button>
        <button @click="save" class="btn-primary">保存设置</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: fadeIn 0.15s ease;
}
.settings-modal {
  background: rgba(30, 30, 46, 0.8);
  backdrop-filter: blur(24px) saturate(1.6);
  -webkit-backdrop-filter: blur(24px) saturate(1.6);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  box-shadow: var(--shadow-lg);
  width: min(560px, 92vw);
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: modalPop 0.18s ease;
}
[data-theme="light"] .settings-modal {
  background: rgba(255, 255, 255, 0.8);
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
.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
}
.settings-header h2 {
  font-size: 16px;
  font-weight: 600;
}
.close-btn {
  font-size: 14px;
  color: var(--text-tertiary);
}
.close-btn:hover {
  color: var(--text-primary);
}
.settings-body {
  flex: 1;
  overflow: auto;
  display: flex;
  min-height: 0;
}
.settings-nav {
  width: 100px;
  flex-shrink: 0;
  padding: 12px 8px;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 2px;
  position: sticky;
  top: 0;
  align-self: flex-start;
  max-height: 100%;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
  transition: background 0.12s, color 0.12s;
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
.settings-content {
  flex: 1;
  overflow: auto;
  padding: 16px 18px;
  min-width: 0;
}
.settings-section {
  margin-bottom: 24px;
}
.settings-section h3 {
  font-size: 13px;
  font-weight: 600;
  color: var(--accent);
  margin-bottom: 12px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border);
}
.setting-row {
  margin-bottom: 12px;
}
.setting-row > label {
  display: block;
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 4px;
}
.setting-row input[type="text"],
.setting-row input[type="number"],
.setting-row select {
  width: 100%;
  max-width: 100%;
}
.checkbox-row label {
  display: flex !important;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 13px !important;
  color: var(--text-primary) !important;
}
.path-row {
  display: flex;
  gap: 6px;
}
.path-row input {
  flex: 1;
  min-width: 0;
}
.model-select {
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-primary);
  color: var(--text-primary);
}
.model-check-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 160px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 4px;
}
.model-check-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 12px;
}
.model-check-item:hover {
  background: var(--bg-hover);
}
.model-check-name {
  color: var(--text-primary);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.model-check-owner {
  font-size: 11px;
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.setting-hint {
  display: block;
  margin-top: 4px;
  font-size: 11px;
  color: var(--text-tertiary);
}
.settings-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid var(--border);
}
</style>
