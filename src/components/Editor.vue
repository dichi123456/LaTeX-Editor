<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLineGutter,
  dropCursor,
  rectangularSelection,
  ViewUpdate
} from '@codemirror/view'
import { EditorState, Compartment } from '@codemirror/state'
import { undo, redo } from '@codemirror/commands'
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab
} from '@codemirror/commands'
import {
  syntaxHighlighting,
  HighlightStyle,
  indentOnInput,
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentUnit
} from '@codemirror/language'
import {
  closeBrackets,
  closeBracketsKeymap,
  autocompletion,
  completionKeymap
} from '@codemirror/autocomplete'
import { searchKeymap, highlightSelectionMatches, search } from '@codemirror/search'
import { tags as t } from '@lezer/highlight'
import { useDocStore } from '../stores/docs'
import { useConfigStore } from '../stores/config'
import { latexCompletions } from '../utils/latex-completion'

const docStore = useDocStore()
const configStore = useConfigStore()

const props = defineProps<{
  showSearch?: boolean
}>()
const emit = defineEmits<{
  (e: 'close-search'): void
}>()

// 搜索/替换状态
const searchQuery = ref('')
const replaceQuery = ref('')
const matchCase = ref(false)
const useRegex = ref(false)
const searchRef = ref<HTMLInputElement | null>(null)
const matchCount = ref(0)
const currentMatch = ref(0)
let allMatches: Array<{ from: number; to: number }> = []

// 右键菜单
const ctxMenu = ref({ show: false, x: 0, y: 0 })

const editorRef = ref<HTMLElement | null>(null)
let view: EditorView | null = null
const lineNoCompartment = new Compartment()
const themeCompartment = new Compartment()
// 保存每个标签的光标位置
const cursorPositions = new Map<string, { anchor: number; head: number }>()
let currentTabId: string | null = null

const highlightStyle = HighlightStyle.define([
  { tag: t.comment, color: 'var(--text-tertiary)', fontStyle: 'italic' },
  { tag: t.keyword, color: '#c678dd' },
  { tag: t.operator, color: 'var(--text-primary)' },
  { tag: t.string, color: '#98c379' },
  { tag: t.number, color: '#d19a66' },
  { tag: t.definition(t.variableName), color: '#61afef' },
  { tag: t.function(t.variableName), color: '#61afef' },
  { tag: t.typeName, color: '#e5c07b' },
  { tag: t.propertyName, color: '#e06c75' },
  { tag: t.className, color: '#e5c07b' },
  { tag: t.invalid, color: '#f44747' },
  { tag: t.meta, color: '#c678dd' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.link, color: '#61afef', textDecoration: 'underline' },
  { tag: t.heading1, fontWeight: 'bold', fontSize: '1.3em' },
  { tag: t.heading2, fontWeight: 'bold', fontSize: '1.2em' },
  { tag: t.heading3, fontWeight: 'bold', fontSize: '1.1em' },
  { tag: t.processingInstruction, color: '#c678dd' },
  { tag: t.escape, color: '#56b6c2' }
])

// 自定义 LaTeX 流式语言（轻量高亮）
import { StreamLanguage, LanguageSupport } from '@codemirror/language'

const latexLanguage = StreamLanguage.define({
  name: 'latex',
  startState: () => ({ inMath: false, inComment: false }),
  token(stream: any, state: any) {
    if (stream.sol()) state.inComment = false
    if (state.inComment) {
      while (!stream.eol()) {
        if (stream.match(/^.*?%/)) {
          state.inComment = false
          return 'comment'
        }
        stream.next()
      }
      return 'comment'
    }
    if (stream.match(/^%/)) {
      state.inComment = true
      stream.skipToEnd()
      return 'comment'
    }
    if (state.inMath) {
      if (stream.match(/^\$\$/)) {
        state.inMath = false
        return 'keyword'
      }
      if (stream.match(/^\$/)) {
        state.inMath = false
        return 'keyword'
      }
      stream.next()
      return 'string'
    }
    if (stream.match(/^\$\$/)) {
      state.inMath = true
      return 'keyword'
    }
    if (stream.match(/^\$/)) {
      state.inMath = true
      return 'keyword'
    }
    if (stream.match(/^\\begin\{[^}]*\}/) || stream.match(/^\\end\{[^}]*\}/)) {
      return 'keyword'
    }
    if (stream.match(/^\\[a-zA-Z@]+\*?/)) {
      return 'keyword'
    }
    if (stream.match(/^\\./)) {
      return 'escape'
    }
    if (stream.match(/^[{}]/)) {
      return 'brace'
    }
    if (stream.match(/^\[[^\]]*\]/)) {
      return 'propertyName'
    }
    stream.next()
    return null
  },
  languageData: {
    commentTokens: { line: '%' },
    closeBrackets: { brackets: ['(', '[', '{', "'", '"'] }
  }
})

function getExtensions() {
  const cfg = configStore.config
  const showLN = cfg?.showLineNumbers !== false

  return [
    lineNoCompartment.of(showLN ? lineNumbers() : []),
    highlightActiveLineGutter(),
    history(),
    foldGutter(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    EditorView.editable.of(true),
    indentOnInput(),
    indentUnit.of('  '),
    bracketMatching(),
    closeBrackets(),
    autocompletion({
      override: [latexCompletions],
      activateOnTyping: true,
      maxRenderedOptions: 30
    }),
    rectangularSelection(),
    highlightSelectionMatches(),
    search({ top: true }),
    new LanguageSupport(latexLanguage),
    syntaxHighlighting(highlightStyle),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...completionKeymap,
      ...searchKeymap,
      indentWithTab,
      {
        key: 'F5',
        run: () => {
          window.dispatchEvent(new CustomEvent('request-compile'))
          return true
        }
      }
    ]),
    themeCompartment.of([]),
    // Ctrl+Click 正向 SyncTeX
    EditorView.domEventHandlers({
      mousedown(event: MouseEvent, view: EditorView) {
        if (!event.ctrlKey && !event.metaKey) return false
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
        if (pos == null) return false
        const line = view.state.doc.lineAt(pos).number
        window.dispatchEvent(new CustomEvent('synctex-forward', { detail: { line } }))
        return true
      }
    }),
    EditorView.updateListener.of((update: ViewUpdate) => {
      if (update.docChanged) {
        const tab = docStore.activeTab
        if (tab) {
          docStore.updateContent(tab.id, update.state.doc.toString())
        }
      }
      // 保存光标位置
      if (update.selectionSet || update.docChanged) {
        const tabId = currentTabId
        if (tabId) {
          const sel = update.state.selection.main
          cursorPositions.set(tabId, { anchor: sel.anchor, head: sel.head })
        }
      }
    }),
    EditorView.lineWrapping,
    EditorView.theme({
      '&': {
        height: '100%',
        backgroundColor: 'var(--bg-primary)',
        color: 'var(--text-primary)'
      },
      '.cm-content': {
        caretColor: 'var(--accent)',
        color: 'var(--text-primary)',
        userSelect: 'text',
        webkitUserSelect: 'text'
      },
      '.cm-cursor, .cm-dropCursor': {
        borderLeftColor: 'var(--accent)',
        borderLeftWidth: '2px'
      },
      '.cm-scroller': {
        fontFamily: cfg?.fontFamily || 'Consolas, "Courier New", monospace',
        fontSize: (cfg?.fontSize || 14) + 'px',
        lineHeight: '1.6',
        backgroundColor: 'var(--bg-primary)',
        color: 'var(--text-primary)'
      },
      '.cm-gutters': {
        backgroundColor: 'var(--bg-secondary)',
        color: 'var(--text-tertiary)',
        borderRight: '1px solid var(--border)'
      },
      '.cm-activeLineGutter': {
        backgroundColor: 'var(--bg-hover)',
        color: 'var(--text-secondary)'
      },
      '.cm-activeLine': {
        backgroundColor: 'var(--bg-hover)'
      },
      '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, .cm-content ::selection, .cm-selectionLayer .cm-selectionBackground': {
        backgroundColor: 'rgba(37, 99, 235, 0.28) !important'
      },
      '.cm-content ::selection': {
        backgroundColor: 'rgba(37, 99, 235, 0.28) !important'
      },
      '.cm-panels': {
        backgroundColor: 'var(--bg-secondary)',
        color: 'var(--text-primary)'
      },
      '.cm-panels.cm-panels-top': {
        borderBottom: '1px solid var(--border)'
      },
      '.cm-panels.cm-panels-bottom': {
        borderTop: '1px solid var(--border)'
      },
      '.cm-panel input, .cm-panel button, .cm-panel select': {
        fontFamily: 'inherit',
        fontSize: '12px',
        backgroundColor: 'var(--bg-primary)',
        color: 'var(--text-primary)',
        border: '1px solid var(--border)',
        borderRadius: '3px',
        padding: '2px 6px'
      },
      '.cm-searchMatch': {
        backgroundColor: 'rgba(245, 158, 11, 0.35)',
        outline: '1px solid rgba(245, 158, 11, 0.6)'
      },
      '.cm-searchMatch-selected': {
        backgroundColor: 'rgba(239, 68, 68, 0.35)'
      },
      '.cm-tooltip': {
        backgroundColor: 'var(--bg-primary)',
        border: '1px solid var(--border)',
        borderRadius: '4px',
        boxShadow: 'var(--shadow-lg)',
        color: 'var(--text-primary)'
      },
      '.cm-tooltip-autocomplete ul li[aria-selected]': {
        backgroundColor: 'var(--accent)',
        color: '#fff'
      }
    }),
  ]
}

function createEditor() {
  if (!editorRef.value) return
  const tab = docStore.activeTab
  const doc = tab?.content || ''

  // 恢复光标位置
  let selection: { anchor: number; head: number } | undefined
  if (tab && cursorPositions.has(tab.id)) {
    const pos = cursorPositions.get(tab.id)!
    // 确保位置在文档范围内
    const maxLen = doc.length
    selection = {
      anchor: Math.min(pos.anchor, maxLen),
      head: Math.min(pos.head, maxLen)
    }
  }

  view = new EditorView({
    state: EditorState.create({
      doc,
      selection,
      extensions: getExtensions()
    }),
    parent: editorRef.value
  })
  currentTabId = tab?.id || null
}

function destroyEditor() {
  // 销毁前保存光标
  if (view && currentTabId) {
    const sel = view.state.selection.main
    cursorPositions.set(currentTabId, { anchor: sel.anchor, head: sel.head })
  }
  view?.destroy()
  view = null
}

function setContent(content: string) {
  if (!view) return
  const current = view.state.doc.toString()
  if (current === content) return
  view.dispatch({
    changes: { from: 0, to: current.length, insert: content }
  })
}

function jumpToLine(line: number) {
  if (!view) return
  const doc = view.state.doc
  const lineInfo = doc.line(Math.min(Math.max(1, line), doc.lines))
  view.dispatch({
    selection: { anchor: lineInfo.from },
    scrollIntoView: true
  })
  view.focus()
}

watch(
  () => docStore.activeTabId,
  async () => {
    // 保存当前光标位置
    if (view && currentTabId) {
      const sel = view.state.selection.main
      cursorPositions.set(currentTabId, { anchor: sel.anchor, head: sel.head })
    }
    await nextTick()
    destroyEditor()
    createEditor()
  }
)

// 行号设置变化时动态切换
watch(
  () => configStore.config?.showLineNumbers,
  (val) => {
    if (!view) return
    const show = val !== false
    view.dispatch({
      effects: lineNoCompartment.reconfigure(show ? lineNumbers() : [])
    })
  }
)

// 字体/字号变化
watch(
  () => [configStore.config?.fontSize, configStore.config?.fontFamily],
  () => {
    if (!view) return
    view.dispatch({
      effects: themeCompartment.reconfigure(
        EditorView.theme({
          '.cm-scroller': {
            fontFamily: configStore.config?.fontFamily || 'Consolas, monospace',
            fontSize: (configStore.config?.fontSize || 14) + 'px',
            lineHeight: '1.6'
          }
        })
      )
    })
  }
)

// 主题变化时强制重建编辑器
watch(
  () => configStore.themeVersion,
  async () => {
    if (!view) return
    const sel = view.state.selection.main
    if (currentTabId) {
      cursorPositions.set(currentTabId, { anchor: sel.anchor, head: sel.head })
    }
    await nextTick()
    destroyEditor()
    createEditor()
  }
)

function onJump(e: Event) {
  const detail = (e as CustomEvent).detail
  if (detail?.line) jumpToLine(detail.line)
}

// ===== 搜索/替换 =====
function buildSearchRegex(): RegExp | null {
  if (!searchQuery.value) return null
  let pattern = searchQuery.value
  if (!useRegex.value) {
    pattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  const flags = matchCase.value ? 'g' : 'gi'
  try {
    return new RegExp(pattern, flags)
  } catch {
    return null
  }
}

function countMatches(): number {
  if (!view || !searchQuery.value) return 0
  const re = buildSearchRegex()
  if (!re) return 0
  const doc = view.state.doc.toString()
  let count = 0
  while (re.exec(doc) !== null) count++
  return count
}

function findMatches(): Array<{ from: number; to: number }> {
  if (!view || !searchQuery.value) return []
  const re = buildSearchRegex()
  if (!re) return []
  const doc = view.state.doc.toString()
  const results: Array<{ from: number; to: number }> = []
  let m: RegExpExecArray | null
  while ((m = re.exec(doc)) !== null) {
    results.push({ from: m.index, to: m.index + m[0].length })
    if (m[0].length === 0) re.lastIndex++ // 防止零宽匹配死循环
  }
  return results
}

function updateMatchInfo() {
  allMatches = findMatches()
  matchCount.value = allMatches.length
  // 找到当前光标所在的匹配
  if (view && allMatches.length > 0) {
    const pos = view.state.selection.main.head
    const idx = allMatches.findIndex((m) => pos >= m.from && pos <= m.to)
    currentMatch.value = idx >= 0 ? idx + 1 : 0
  } else {
    currentMatch.value = 0
  }
}

function doSearch(dir: 'next' | 'prev' = 'next') {
  if (!view || !searchQuery.value) return
  allMatches = findMatches()
  matchCount.value = allMatches.length
  if (allMatches.length === 0) return

  const pos = view.state.selection.main.head
  let target: { from: number; to: number } | null = null

  if (dir === 'next') {
    target = allMatches.find((m) => m.from > pos) || allMatches[0]
  } else {
    target = [...allMatches].reverse().find((m) => m.to < pos) || allMatches[allMatches.length - 1]
  }

  if (target) {
    view.dispatch({
      selection: { anchor: target.from, head: target.to },
      scrollIntoView: true
    })
    view.focus()
    currentMatch.value = allMatches.indexOf(target) + 1
  }
}

function doSearchNext() { doSearch('next') }
function doSearchPrev() { doSearch('prev') }

// 查询变化时自动更新匹配计数
watch(searchQuery, () => { updateMatchInfo() })
watch(matchCase, () => { updateMatchInfo() })
watch(useRegex, () => { updateMatchInfo() })

function doReplace() {
  if (!view || !searchQuery.value) return
  const sel = view.state.selection.main
  const selected = view.state.sliceDoc(sel.from, sel.to)
  const query = matchCase.value ? searchQuery.value : searchQuery.value.toLowerCase()
  const selLower = matchCase.value ? selected : selected.toLowerCase()
  if (selLower === query) {
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: replaceQuery.value },
      selection: { anchor: sel.from + replaceQuery.value.length }
    })
  }
  doSearchNext()
}

function doReplaceAll() {
  if (!view || !searchQuery.value) return
  const doc = view.state.doc.toString()
  const flags = matchCase.value ? 'g' : 'gi'
  const re = new RegExp(searchQuery.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)
  const newDoc = doc.replace(re, replaceQuery.value)
  if (newDoc !== doc) {
    view.dispatch({
      changes: { from: 0, to: doc.length, insert: newDoc }
    })
  }
}

function closeSearch() {
  emit('close-search')
}

function onEditorAction(e: Event) {
  const detail = (e as CustomEvent).detail
  if (!view) return
  if (detail.action === 'undo') undo(view)
  else if (detail.action === 'redo') redo(view)
}

watch(
  () => props.showSearch,
  (val) => {
    if (val) {
      nextTick(() => searchRef.value?.focus())
    }
  }
)

function onInsertText(e: Event) {
  const detail = (e as CustomEvent).detail
  if (!view || !detail?.text) return
  const sel = view.state.selection.main
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert: detail.text },
    selection: { anchor: sel.from + detail.text.length }
  })
  view.focus()
}

function onReloadTab(e: Event) {
  const detail = (e as CustomEvent).detail
  if (!view || !detail?.content) return
  // 仅当当前编辑的是该标签时才刷新
  if (detail.tabId !== docStore.activeTabId) return
  const currentContent = view.state.doc.toString()
  if (currentContent === detail.content) return
  // 保存光标位置
  const sel = view.state.selection.main
  const maxLen = detail.content.length
  view.dispatch({
    changes: { from: 0, to: currentContent.length, insert: detail.content },
    selection: { anchor: Math.min(sel.anchor, maxLen), head: Math.min(sel.head, maxLen) }
  })
}

function onApplyEdit(e: Event) {
  const detail = (e as CustomEvent).detail
  if (!view || !detail?.find) return
  const doc = view.state.doc.toString()
  const idx = doc.indexOf(detail.find)
  if (idx === -1) {
    alert('未找到要修改的文本，请确认编辑器中包含该内容。')
    return
  }
  view.dispatch({
    changes: { from: idx, to: idx + detail.find.length, insert: detail.replace || '' },
    selection: { anchor: idx + (detail.replace?.length || 0) },
    scrollIntoView: true
  })
  view.focus()
}

// ===== 右键菜单 =====
function onEditorContextMenu(e: MouseEvent) {
  e.preventDefault()
  ctxMenu.value = { show: true, x: e.clientX, y: e.clientY }
}

function closeCtxMenu() {
  ctxMenu.value.show = false
}

function getSelectedText(): string {
  if (!view) return ''
  const sel = view.state.selection.main
  return view.state.sliceDoc(sel.from, sel.to)
}

async function ctxCopy() {
  const text = getSelectedText()
  if (text) await navigator.clipboard.writeText(text)
  closeCtxMenu()
}

async function ctxCut() {
  const text = getSelectedText()
  if (text) {
    await navigator.clipboard.writeText(text)
    const sel = view!.state.selection.main
    view!.dispatch({ changes: { from: sel.from, to: sel.to, insert: '' } })
  }
  closeCtxMenu()
}

async function ctxPaste() {
  try {
    const text = await navigator.clipboard.readText()
    if (text && view) {
      const sel = view.state.selection.main
      view.dispatch({ changes: { from: sel.from, to: sel.to, insert: text } })
      view.focus()
    }
  } catch { /* clipboard permission denied */ }
  closeCtxMenu()
}

function ctxSelectAll() {
  if (view) {
    view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } })
    view.focus()
  }
  closeCtxMenu()
}

function ctxSendToMoling() {
  if (!view) return
  const sel = view.state.selection.main
  const text = view.state.sliceDoc(sel.from, sel.to)
  if (!text) return

  const tab = docStore.activeTab
  const startLine = view.state.doc.lineAt(sel.from).number
  const endLine = view.state.doc.lineAt(sel.to).number

  window.dispatchEvent(new CustomEvent('send-to-moling', {
    detail: {
      text,
      filePath: tab?.path || '',
      fileName: tab?.name || '选中文本',
      lineRange: startLine === endLine ? `${startLine}` : `${startLine}-${endLine}`
    }
  }))
  closeCtxMenu()
}

function ctxFormatLatex() {
  // 简单的 LaTeX 格式化：规范化空白
  if (!view) return
  const sel = view.state.selection.main
  const text = view.state.sliceDoc(sel.from, sel.to)
  if (!text) return
  const formatted = text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
  view.dispatch({ changes: { from: sel.from, to: sel.to, insert: formatted } })
  closeCtxMenu()
}

// 全局点击关闭菜单
function onGlobalClick(e: Event) {
  const target = e.target as HTMLElement
  if (!target.closest('.editor-ctx-menu')) {
    closeCtxMenu()
  }
}

onMounted(() => {
  createEditor()
  window.addEventListener('request-compile', () => {})
  window.addEventListener('jump-to-line', onJump)
  window.addEventListener('editor-action', onEditorAction)
  window.addEventListener('insert-text', onInsertText)
  window.addEventListener('apply-edit', onApplyEdit)
  window.addEventListener('reload-tab', onReloadTab)
  document.addEventListener('click', onGlobalClick)
})

onUnmounted(() => {
  destroyEditor()
  window.removeEventListener('jump-to-line', onJump)
  window.removeEventListener('editor-action', onEditorAction)
  window.removeEventListener('insert-text', onInsertText)
  window.removeEventListener('apply-edit', onApplyEdit)
  window.removeEventListener('reload-tab', onReloadTab)
  document.removeEventListener('click', onGlobalClick)
})
</script>

<template>
  <div class="editor-container">
    <!-- 搜索/替换面板（右上角弹出） -->
    <div v-if="showSearch" class="search-panel">
      <div class="search-row">
        <input
          ref="searchRef"
          v-model="searchQuery"
          class="search-input"
          placeholder="查找"
          @keyup.enter="doSearchNext"
          @keydown.esc="closeSearch"
        />
        <span class="match-count" v-if="searchQuery">
          {{ matchCount > 0 ? currentMatch + ' / ' + matchCount : '0 / 0' }}
        </span>
        <button class="search-icon-btn" title="区分大小写" :class="{ active: matchCase }" @click="matchCase = !matchCase">Aa</button>
        <button class="search-icon-btn" title="正则表达式" :class="{ active: useRegex }" @click="useRegex = !useRegex">.*</button>
        <button class="search-icon-btn" title="上一个 (Shift+Enter)" :disabled="matchCount === 0" @click="doSearchPrev">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><polyline points="3,8 6,5 9,8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button class="search-icon-btn" title="下一个 (Enter)" :disabled="matchCount === 0" @click="doSearchNext">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><polyline points="3,4 6,7 9,4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button class="search-close-btn" title="关闭 (Esc)" @click="closeSearch">✕</button>
      </div>
      <div class="search-row">
        <input
          v-model="replaceQuery"
          class="search-input"
          placeholder="替换为"
          @keydown.esc="closeSearch"
        />
        <button class="search-action-btn" title="替换当前" @click="doReplace">替换</button>
        <button class="search-action-btn" title="全部替换" @click="doReplaceAll">全部</button>
      </div>
    </div>

    <div ref="editorRef" class="editor-host" @contextmenu="onEditorContextMenu"></div>

    <!-- 右键菜单 -->
    <Teleport to="body">
      <div
        v-if="ctxMenu.show"
        class="editor-ctx-menu"
        :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }"
        @click.stop
      >
        <button class="ctx-item" @click="ctxCopy">
          <span class="ctx-icon">📋</span> 复制
          <span class="ctx-key">Ctrl+C</span>
        </button>
        <button class="ctx-item" @click="ctxCut">
          <span class="ctx-icon">✂️</span> 剪切
          <span class="ctx-key">Ctrl+X</span>
        </button>
        <button class="ctx-item" @click="ctxPaste">
          <span class="ctx-icon">📌</span> 粘贴
          <span class="ctx-key">Ctrl+V</span>
        </button>
        <div class="ctx-divider"></div>
        <button class="ctx-item" @click="ctxSelectAll">
          <span class="ctx-icon">⬚</span> 全选
          <span class="ctx-key">Ctrl+A</span>
        </button>
        <button class="ctx-item" @click="ctxFormatLatex">
          <span class="ctx-icon">✨</span> 格式化选区
        </button>
        <div class="ctx-divider"></div>
        <button class="ctx-item highlight" @click="ctxSendToMoling">
          <span class="ctx-icon">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <rect x="1" y="1" width="14" height="14" rx="3" fill="#2563EB"/>
              <path d="M5.5 4.5v7h1.8V8.8h1.4c1.5 0 2.5-.9 2.5-2.2S10.2 4.5 8.7 4.5H5.5zm1.8 1.5h1.3c.6 0 1 .3 1 .9s-.4.9-1 .9H7.3V6z" fill="#fff"/>
            </svg>
          </span>
          发送到墨灵
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.editor-container {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  overflow: hidden;
  position: relative;
}

/* 搜索面板 */
.search-panel {
  position: absolute;
  top: 4px;
  right: 12px;
  z-index: 50;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 280px;
}
.search-row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.search-input {
  flex: 1;
  min-width: 0;
  padding: 3px 8px;
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--bg-primary);
  color: var(--text-primary);
  outline: none;
}
.search-input:focus {
  border-color: var(--accent);
}
.match-count {
  font-size: 11px;
  color: var(--text-tertiary);
  white-space: nowrap;
  min-width: 48px;
  text-align: center;
  font-family: var(--font-mono);
}
.search-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 11px;
  font-weight: 600;
  border-radius: 3px;
  cursor: pointer;
}
.search-icon-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
.search-icon-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.search-icon-btn.active {
  background: var(--accent-light);
  color: var(--accent);
}
.search-close-btn {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 11px;
  border-radius: 3px;
  cursor: pointer;
}
.search-close-btn:hover {
  background: var(--bg-hover);
  color: var(--error);
}
.search-action-btn {
  padding: 3px 10px;
  font-size: 11px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  cursor: pointer;
  white-space: nowrap;
}
.search-action-btn:hover {
  background: var(--bg-hover);
  border-color: var(--border-strong);
}
.editor-host {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.editor-host :deep(.cm-editor) {
  height: 100%;
}

/* 右键菜单 */
.editor-ctx-menu {
  position: fixed;
  z-index: 10000;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  min-width: 200px;
  padding: 4px 0;
}
.ctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 14px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-primary);
  text-align: left;
}
.ctx-item:hover {
  background: var(--bg-hover);
}
.ctx-item.highlight {
  color: var(--accent);
  font-weight: 500;
}
.ctx-icon {
  font-size: 13px;
  width: 18px;
  text-align: center;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ctx-key {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-tertiary);
  font-family: var(--font-mono);
}
.ctx-divider {
  height: 1px;
  background: var(--border);
  margin: 4px 0;
}
</style>
