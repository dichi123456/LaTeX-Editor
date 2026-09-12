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
import { undo, redo, toggleComment } from '@codemirror/commands'
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
  indentUnit,
  foldService,
  foldable
} from '@codemirror/language'
import { EditorSelection } from '@codemirror/state'
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
// 中文输入法组合期间禁用补全
let imeComposing = false

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

// LaTeX 语义折叠：按 \begin{}/\end{} 环境与 \section 等命令折叠
const latexFoldService = foldService.of((state, lineStart, lineEnd) => {
  const line = state.doc.lineAt(lineStart)
  const text = line.text

  // \begin{env} → 折叠到匹配的 \end{env}
  const beginMatch = text.match(/\\begin\{([^}]+)\}/)
  if (beginMatch) {
    const env = beginMatch[1]
    let depth = 0
    for (let i = line.number; i <= state.doc.lines; i++) {
      const l = state.doc.line(i)
      if (l.text.includes(`\\begin{${env}}`)) depth++
      if (l.text.includes(`\\end{${env}}`)) {
        depth--
        if (depth === 0 && i > line.number) {
          return { from: line.to, to: l.from }
        }
      }
    }
    return null
  }

  // \section{...} 等标题 → 折叠到下一个同级或更高级标题
  const secMatch = text.match(/\\(chapter|section|subsection|subsubsection|paragraph)\*?\{/)
  if (secMatch) {
    const cmd = secMatch[1]
    const levels: Record<string, number> = {
      chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5
    }
    const myLevel = levels[cmd]
    for (let i = line.number + 1; i <= state.doc.lines; i++) {
      const l = state.doc.line(i)
      const m = l.text.match(/\\(chapter|section|subsection|subsubsection|paragraph)\*?\{/)
      if (m && levels[m[1]] <= myLevel) {
        return { from: line.to, to: l.from }
      }
    }
    // 折到文档末尾
    const last = state.doc.line(state.doc.lines)
    return { from: line.to, to: last.to }
  }

  return null
})

// 智能缩进：\begin{} 后自动缩进；\end{} 自动回退；普通换行保持缩进
function latexSmartIndent(view: EditorView): boolean {
  const state = view.state
  const sel = state.selection.main
  const line = state.doc.lineAt(sel.head)
  const indentUnit = '  '
  const curIndent = line.text.match(/^\s*/)?.[0] || ''

  // 光标不在行尾时不打断
  if (sel.head < line.to) return false

  // 行尾是 \begin{...}：换行后多缩进一级
  if (/\\begin\{[^}]+\}\s*$/.test(line.text)) {
    const newIndent = curIndent + indentUnit
    const insert = '\n' + newIndent
    view.dispatch({
      changes: { from: sel.head, to: sel.head, insert },
      selection: { anchor: sel.head + insert.length },
      scrollIntoView: true
    })
    return true
  }

  // 当前行是 \end{...} 且缩进多于上级：先自动回退一级
  if (/^\s*\\end\{/.test(line.text) && curIndent.length >= indentUnit.length) {
    const dedented = line.text.slice(indentUnit.length)
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: dedented },
      selection: { anchor: line.from + Math.max(0, sel.head - line.from - indentUnit.length) }
    })
    return true
  }

  // 普通换行：保持当前缩进
  if (curIndent && line.text.trim()) {
    const insert = '\n' + curIndent
    view.dispatch({
      changes: { from: sel.head, to: sel.head, insert },
      selection: { anchor: sel.head + insert.length },
      scrollIntoView: true
    })
    return true
  }

  return false
}

function getExtensions() {
  const cfg = configStore.config
  const showLN = cfg?.showLineNumbers !== false

  return [
    lineNoCompartment.of(showLN ? lineNumbers() : []),
    highlightActiveLineGutter(),
    history(),
    foldGutter({ openText: '▾', closedText: '▸' }),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    EditorView.editable.of(true),
    indentOnInput(),
    indentUnit.of('  '),
    bracketMatching(),
    closeBrackets(),
    autocompletion({
      override: [
        (context: import('@codemirror/autocomplete').CompletionContext) => {
          // 输入法组合期间不触发补全
          if (imeComposing) return null
          return latexCompletions(context)
        }
      ],
      activateOnTyping: true,
      maxRenderedOptions: 30
    }),
    rectangularSelection(),
    highlightSelectionMatches(),
    search({ top: true }),
    new LanguageSupport(latexLanguage),
    syntaxHighlighting(highlightStyle),
    latexFoldService,
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
      },
      {
        key: 'Mod-/',
        run: toggleComment,
        preventDefault: true
      },
      {
        key: 'Enter',
        run: (v) => latexSmartIndent(v)
      }
    ]),
    themeCompartment.of([]),
    // Ctrl+Click / 双击 正向 SyncTeX；Alt+Click 添加多光标
    EditorView.domEventHandlers({
      mousedown(event: MouseEvent, view: EditorView) {
        // Alt+Click：添加多光标（不拦截 Ctrl+Click 的 SyncTeX）
        if (event.altKey && !event.ctrlKey && !event.metaKey) {
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
          if (pos == null) return false
          event.preventDefault()
          view.dispatch({
            selection: EditorSelection.create(
              [...view.state.selection.ranges, EditorSelection.cursor(pos)],
              view.state.selection.ranges.length
            )
          })
          return true
        }
        // Ctrl+Click 正向 SyncTeX
        if (event.ctrlKey || event.metaKey) {
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
          if (pos == null) return false
          // 点在折叠栏上不触发同步
          const gutter = (event.target as HTMLElement).closest('.cm-foldGutter')
          if (gutter) return false
          const line = view.state.doc.lineAt(pos).number
          window.dispatchEvent(new CustomEvent('synctex-forward', { detail: { line } }))
          return true
        }
        return false
      },
      // 双击正向 SyncTeX（无需按 Ctrl）
      dblclick(event: MouseEvent, view: EditorView) {
        const gutter = (event.target as HTMLElement).closest('.cm-foldGutter')
        if (gutter) return false
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
        if (pos == null) return false
        const line = view.state.doc.lineAt(pos).number
        window.dispatchEvent(new CustomEvent('synctex-forward', { detail: { line } }))
        return true
      },
      // Ctrl+滚轮缩放字号
      wheel(event: WheelEvent, view: EditorView) {
        if (!event.ctrlKey && !event.metaKey) return false
        event.preventDefault()
        const delta = event.deltaY > 0 ? -1 : 1
        const cur = configStore.config?.fontSize || 14
        const next = Math.min(32, Math.max(10, cur + delta))
        if (next !== cur) configStore.save({ fontSize: next })
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
      // 保存光标位置 + 更新状态栏 Ln/Col
      if (update.selectionSet || update.docChanged) {
        const tabId = currentTabId
        const sel = update.state.selection.main
        if (tabId) {
          cursorPositions.set(tabId, { anchor: sel.anchor, head: sel.head })
        }
        const line = update.state.doc.lineAt(sel.head)
        docStore.cursorLine = line.number
        docStore.cursorCol = sel.head - line.from + 1
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
      '.cm-foldGutter': {
        width: '18px'
      },
      '.cm-foldGutter .cm-foldGutterElement': {
        padding: '0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        color: 'var(--text-tertiary)',
        fontSize: '11px',
        lineHeight: '1',
        width: '18px'
      },
      '.cm-foldGutter .cm-foldGutterElement:hover': {
        color: 'var(--accent)'
      },
      '.cm-foldGutter .cm-foldPlaceholder': {
        margin: '0 2px',
        padding: '0 4px',
        borderRadius: '3px',
        border: '1px solid var(--border)',
        background: 'var(--bg-hover)',
        color: 'var(--text-secondary)',
        fontSize: '11px',
        fontFamily: 'inherit'
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

  // IME 事件：组合开始/结束时切换标志
  const content = editorRef.value.querySelector('.cm-content')
  if (content) {
    content.addEventListener('compositionstart', () => { imeComposing = true })
    content.addEventListener('compositionend', () => { imeComposing = false })
  }

  // 初始化状态栏光标
  if (view) {
    const sel = view.state.selection.main
    const line = view.state.doc.lineAt(sel.head)
    docStore.cursorLine = line.number
    docStore.cursorCol = sel.head - line.from + 1
  }
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
  // 记录右键时的光标行，供「跳转到 PDF」使用
  if (view) {
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
    if (pos != null) {
      ctxMenuLine = view.state.doc.lineAt(pos).number
    }
  }
  ctxMenu.value = { show: true, x: e.clientX, y: e.clientY }
}

let ctxMenuLine: number | null = null

function closeCtxMenu() {
  ctxMenu.value.show = false
}

function ctxJumpToPdf() {
  const line = ctxMenuLine
  closeCtxMenu()
  if (line != null) {
    window.dispatchEvent(new CustomEvent('synctex-forward', { detail: { line } }))
  }
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
        <button class="ctx-item" @click="ctxJumpToPdf">
          <span class="ctx-icon">📄</span> 跳转到 PDF
          <span class="ctx-key">双击</span>
        </button>
        <button class="ctx-item" @click="ctxFormatLatex">
          <span class="ctx-icon">✨</span> 格式化选区
        </button>
        <div class="ctx-divider"></div>
        <button class="ctx-item highlight" @click="ctxSendToMoling">
          <span class="ctx-icon">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <path d="M2.5 3.5A1.5 1.5 0 0 1 4 2h8a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 12 11H6.5L3.5 13.5V11H4a1.5 1.5 0 0 1-1.5-1.5v-6z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
              <circle cx="5.5" cy="6.5" r="0.7" fill="currentColor"/>
              <circle cx="8" cy="6.5" r="0.7" fill="currentColor"/>
              <circle cx="10.5" cy="6.5" r="0.7" fill="currentColor"/>
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
