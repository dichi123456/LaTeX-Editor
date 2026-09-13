// 轻量 Markdown + LaTeX 渲染器（无外部依赖）
// 支持流式：未闭合代码块/公式也能安全渲染

export function renderMarkdown(text: string): string {
  if (!text) return ''

  try {
    let html = escapeHtml(text)

    // 未闭合代码块：流式中临时补全
    const fenceCount = (html.match(/```/g) || []).length
    if (fenceCount % 2 === 1) {
      html += '\n```'
    }

    // 代码块 ```lang\n...\n```
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
      return `<pre class="md-code"><code>${code.trim()}</code></pre>`
    })

    // 行内代码
    html = html.replace(/`([^`\n]+)`/g, '<code class="md-inline-code">$1</code>')

    // 标题
    html = html.replace(/^### (.+)$/gm, '<h4 class="md-h">$1</h4>')
    html = html.replace(/^## (.+)$/gm, '<h3 class="md-h">$1</h3>')
    html = html.replace(/^# (.+)$/gm, '<h2 class="md-h">$1</h2>')

    // 粗体
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // 斜体
    html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>')

    // 无序列表
    html = html.replace(/^[-*] (.+)$/gm, '<li class="md-li">$1</li>')
    html = html.replace(/(<li class="md-li">.*<\/li>\n?)+/g, (match) => {
      return `<ul class="md-ul">${match}</ul>`
    })

    // 有序列表
    html = html.replace(/^\d+\. (.+)$/gm, '<li class="md-li-ol">$1</li>')

    // 引用
    html = html.replace(/^&gt; (.+)$/gm, '<blockquote class="md-quote">$1</blockquote>')

    // 分割线
    html = html.replace(/^---$/gm, '<hr class="md-hr" />')

    // 链接
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')

    // LaTeX 块级公式 $$...$$（流式未闭合时跳过）
    html = html.replace(/\$\$([\s\S]+?)\$\$/g, (_m, tex) => {
      return `<div class="md-latex-block">${renderLatexBlock(tex.trim())}</div>`
    })

    // LaTeX 行内公式 $...$
    html = html.replace(/\$([^$\n]+)\$/g, (_m, tex) => {
      return `<span class="md-latex">${renderLatexInline(tex)}</span>`
    })

    // LaTeX 环境
    html = html.replace(/\\begin\{(equation\*?|align\*?|gather\*?)\}([\s\S]*?)\\end\{\1\}/g, (_m, env, body) => {
      return `<div class="md-latex-block">${renderLatexBlock(body.trim())}</div>`
    })

    // 换行
    html = html.replace(/\n\n/g, '</p><p>')
    html = html.replace(/\n/g, '<br />')

    return `<p class="md-para">${html}</p>`
  } catch {
    // 渲染失败时退回纯文本，避免流式中断
    return `<p class="md-para">${escapeHtml(text)}</p>`
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// 行内 LaTeX → HTML（简单映射）
function renderLatexInline(tex: string): string {
  let s = tex
  // 常见符号
  const map: Record<string, string> = {
    '\\alpha': 'α', '\\beta': 'β', '\\gamma': 'γ', '\\delta': 'δ',
    '\\epsilon': 'ε', '\\theta': 'θ', '\\lambda': 'λ', '\\mu': 'μ',
    '\\pi': 'π', '\\sigma': 'σ', '\\phi': 'φ', '\\omega': 'ω',
    '\\infty': '∞', '\\partial': '∂', '\\nabla': '∇',
    '\\times': '×', '\\cdot': '·', '\\pm': '±',
    '\\leq': '≤', '\\geq': '≥', '\\neq': '≠', '\\approx': '≈',
    '\\rightarrow': '→', '\\leftarrow': '←', '\\Rightarrow': '⇒', '\\Leftarrow': '⇐',
    '\\sum': '∑', '\\prod': '∏', '\\int': '∫',
    '\\sqrt': '√', '\\forall': '∀', '\\exists': '∃',
    '\\in': '∈', '\\notin': '∉', '\\subset': '⊂', '\\cup': '∪', '\\cap': '∩',
    '\\mathbb{R}': 'ℝ', '\\mathbb{N}': 'ℕ', '\\mathbb{Z}': 'ℤ', '\\mathbb{Q}': 'ℚ', '\\mathbb{C}': 'ℂ',
    '\\ldots': '…', '\\cdots': '⋯',
  }
  for (const [key, val] of Object.entries(map)) {
    s = s.split(key).join(val)
  }
  // \frac{a}{b} → a/b
  s = s.replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '($1)/($2)')
  // \text{...}
  s = s.replace(/\\text\{([^}]+)\}/g, '$1')
  // \mathbf{...} → <b>
  s = s.replace(/\\mathbf\{([^}]+)\}/g, '<b>$1</b>')
  // \mathrm{...}
  s = s.replace(/\\mathrm\{([^}]+)\}/g, '$1')
  // 下标 _
  s = s.replace(/\^\{([^}]+)\}/g, '<sup>$1</sup>')
  s = s.replace(/\^(\w)/g, '<sup>$1</sup>')
  s = s.replace(/_\{([^}]+)\}/g, '<sub>$1</sub>')
  s = s.replace(/_(\w)/g, '<sub>$1</sub>')
  // 移除剩余的反斜杠命令
  s = s.replace(/\\[a-zA-Z]+\*?/g, '')
  return s
}

// 块级 LaTeX → HTML
function renderLatexBlock(tex: string): string {
  let s = tex.trim()
  // align 环境：按行拆分
  const lines = s.split('\\\\').map((l) => l.trim()).filter(Boolean)
  if (lines.length > 1) {
    const rendered = lines.map((l) => renderLatexInline(l)).join('<br />')
    return `<div class="md-latex-lines">${rendered}</div>`
  }
  return renderLatexInline(s)
}
