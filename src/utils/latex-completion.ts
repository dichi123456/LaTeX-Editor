// LaTeX 自动补全数据源与逻辑
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { bibScanner } from './bibtex'

// 常用 LaTeX 命令
const COMMON_COMMANDS: Completion[] = [
  { label: '\\documentclass', type: 'keyword', info: '文档类' },
  { label: '\\usepackage', type: 'keyword', info: '导入宏包' },
  { label: '\\begin', type: 'keyword', info: '开始环境' },
  { label: '\\end', type: 'keyword', info: '结束环境' },
  { label: '\\section', type: 'function', info: '章节' },
  { label: '\\subsection', type: 'function', info: '子章节' },
  { label: '\\subsubsection', type: 'function', info: '子子章节' },
  { label: '\\paragraph', type: 'function', info: '段落' },
  { label: '\\chapter', type: 'function', info: '章（book/report）' },
  { label: '\\title', type: 'function', info: '标题' },
  { label: '\\author', type: 'function', info: '作者' },
  { label: '\\date', type: 'function', info: '日期' },
  { label: '\\maketitle', type: 'function', info: '生成标题' },
  { label: '\\tableofcontents', type: 'function', info: '目录' },
  { label: '\\label', type: 'function', info: '标签' },
  { label: '\\ref', type: 'function', info: '引用' },
  { label: '\\eqref', type: 'function', info: '公式引用' },
  { label: '\\pageref', type: 'function', info: '页码引用' },
  { label: '\\cite', type: 'function', info: '引用文献' },
  { label: '\\citep', type: 'function', info: 'natbib 括号引用' },
  { label: '\\citet', type: 'function', info: 'natbib 文本引用' },
  { label: '\\bibliography', type: 'function', info: '参考文献' },
  { label: '\\bibliographystyle', type: 'function', info: '文献样式' },
  { label: '\\includegraphics', type: 'function', info: '插入图片' },
  { label: '\\textbf', type: 'function', info: '加粗' },
  { label: '\\textit', type: 'function', info: '斜体' },
  { label: '\\underline', type: 'function', info: '下划线' },
  { label: '\\emph', type: 'function', info: '强调' },
  { label: '\\texttt', type: 'function', info: '等宽字体' },
  { label: '\\textsc', type: 'function', info: '小型大写' },
  { label: '\\footnote', type: 'function', info: '脚注' },
  { label: '\\item', type: 'function', info: '列表项' },
  { label: '\\newpage', type: 'function', info: '分页' },
  { label: '\\clearpage', type: 'function', info: '清页' },
  { label: '\\pagebreak', type: 'function', info: '建议分页' },
  { label: '\\noindent', type: 'function', info: '取消缩进' },
  { label: '\\indent', type: 'function', info: '首行缩进' },
  { label: '\\centering', type: 'function', info: '居中' },
  { label: '\\hfill', type: 'function', info: '水平填充' },
  { label: '\\vspace', type: 'function', info: '垂直间距' },
  { label: '\\hspace', type: 'function', info: '水平间距' },
  { label: '\\today', type: 'constant', info: '今天日期' },
  { label: '\\LaTeX', type: 'constant', info: 'LaTeX 标志' },
  { label: '\\TeX', type: 'constant', info: 'TeX 标志' },
  { label: '\\ldots', type: 'constant', info: '省略号' },
  { label: '\\cdots', type: 'constant', info: '居中省略号' },
  { label: '\\textwidth', type: 'variable', info: '文本宽度' },
  { label: '\\linewidth', type: 'variable', info: '行宽度' },
  { label: '\\setCJKmainfont', type: 'function', info: '设置中文主字体' },
  { label: '\\setCJKsansfont', type: 'function', info: '设置中文无衬线字体' },
  { label: '\\setCJKmonofont', type: 'function', info: '设置中文等宽字体' }
]

// 常用环境
const ENVIRONMENTS: Completion[] = [
  { label: 'document', type: 'class', info: '文档环境' },
  { label: 'abstract', type: 'class', info: '摘要' },
  { label: 'itemize', type: 'class', info: '无序列表' },
  { label: 'enumerate', type: 'class', info: '有序列表' },
  { label: 'description', type: 'class', info: '描述列表' },
  { label: 'figure', type: 'class', info: '图片浮动体' },
  { label: 'figure*', type: 'class', info: '跨栏图片' },
  { label: 'table', type: 'class', info: '表格浮动体' },
  { label: 'table*', type: 'class', info: '跨栏表格' },
  { label: 'tabular', type: 'class', info: '表格' },
  { label: 'tabularx', type: 'class', info: '自适应宽度表格' },
  { label: 'equation', type: 'class', info: '编号公式' },
  { label: 'equation*', type: 'class', info: '无编号公式' },
  { label: 'align', type: 'class', info: '对齐公式' },
  { label: 'align*', type: 'class', info: '无编号对齐公式' },
  { label: 'gather', type: 'class', info: '多行公式' },
  { label: 'multline', type: 'class', info: '多行公式（首尾对齐）' },
  { label: 'cases', type: 'class', info: '分段函数' },
  { label: 'matrix', type: 'class', info: '矩阵' },
  { label: 'pmatrix', type: 'class', info: '圆括号矩阵' },
  { label: 'bmatrix', type: 'class', info: '方括号矩阵' },
  { label: 'vmatrix', type: 'class', info: '行列式' },
  { label: 'lstlisting', type: 'class', info: '代码块' },
  { label: 'verbatim', type: 'class', info: '原样输出' },
  { label: 'quote', type: 'class', info: '引文' },
  { label: 'quotation', type: 'class', info: '引文（带缩进）' },
  { label: 'verse', type: 'class', info: '诗歌' },
  { label: 'center', type: 'class', info: '居中环境' },
  { label: 'flushleft', type: 'class', info: '左对齐' },
  { label: 'flushright', type: 'class', info: '右对齐' },
  { label: 'minipage', type: 'class', info: '小页' },
  { label: 'thebibliography', type: 'class', info: '参考文献列表' },
  { label: 'frame', type: 'class', info: 'Beamer 幻灯片帧' },
  { label: 'columns', type: 'class', info: 'Beamer 多栏' },
  { label: 'column', type: 'class', info: 'Beamer 栏' },
  { label: 'block', type: 'class', info: 'Beamer 块' },
  { label: 'theorem', type: 'class', info: '定理' },
  { label: 'proof', type: 'class', info: '证明' }
]

// 常用数学符号
const MATH_SYMBOLS: Completion[] = [
  { label: '\\alpha', type: 'constant', info: 'α' },
  { label: '\\beta', type: 'constant', info: 'β' },
  { label: '\\gamma', type: 'constant', info: 'γ' },
  { label: '\\delta', type: 'constant', info: 'δ' },
  { label: '\\epsilon', type: 'constant', info: 'ε' },
  { label: '\\theta', type: 'constant', info: 'θ' },
  { label: '\\lambda', type: 'constant', info: 'λ' },
  { label: '\\mu', type: 'constant', info: 'μ' },
  { label: '\\pi', type: 'constant', info: 'π' },
  { label: '\\sigma', type: 'constant', info: 'σ' },
  { label: '\\phi', type: 'constant', info: 'φ' },
  { label: '\\omega', type: 'constant', info: 'ω' },
  { label: '\\Gamma', type: 'constant', info: 'Γ' },
  { label: '\\Delta', type: 'constant', info: 'Δ' },
  { label: '\\Theta', type: 'constant', info: 'Θ' },
  { label: '\\Lambda', type: 'constant', info: 'Λ' },
  { label: '\\Sigma', type: 'constant', info: 'Σ' },
  { label: '\\Phi', type: 'constant', info: 'Φ' },
  { label: '\\Omega', type: 'constant', info: 'Ω' },
  { label: '\\infty', type: 'constant', info: '∞' },
  { label: '\\partial', type: 'constant', info: '∂' },
  { label: '\\nabla', type: 'constant', info: '∇' },
  { label: '\\sum', type: 'function', info: '求和' },
  { label: '\\prod', type: 'function', info: '连乘' },
  { label: '\\int', type: 'function', info: '积分' },
  { label: '\\oint', type: 'function', info: '环路积分' },
  { label: '\\lim', type: 'function', info: '极限' },
  { label: '\\sqrt', type: 'function', info: '平方根' },
  { label: '\\frac', type: 'function', info: '分数' },
  { label: '\\dfrac', type: 'function', info: '显示分数' },
  { label: '\\textfrac', type: 'function', info: '文本分数' },
  { label: '\\leq', type: 'constant', info: '≤' },
  { label: '\\geq', type: 'constant', info: '≥' },
  { label: '\\neq', type: 'constant', info: '≠' },
  { label: '\\approx', type: 'constant', info: '≈' },
  { label: '\\equiv', type: 'constant', info: '≡' },
  { label: '\\subset', type: 'constant', info: '⊂' },
  { label: '\\supset', type: 'constant', info: '⊃' },
  { label: '\\cup', type: 'constant', info: '∪' },
  { label: '\\cap', type: 'constant', info: '∩' },
  { label: '\\in', type: 'constant', info: '∈' },
  { label: '\\notin', type: 'constant', info: '∉' },
  { label: '\\times', type: 'constant', info: '×' },
  { label: '\\cdot', type: 'constant', info: '·' },
  { label: '\\pm', type: 'constant', info: '±' },
  { label: '\\mp', type: 'constant', info: '∓' },
  { label: '\\leftarrow', type: 'constant', info: '←' },
  { label: '\\rightarrow', type: 'constant', info: '→' },
  { label: '\\Leftarrow', type: 'constant', info: '⇐' },
  { label: '\\Rightarrow', type: 'constant', info: '⇒' },
  { label: '\\Leftrightarrow', type: 'constant', info: '⇔' },
  { label: '\\forall', type: 'constant', info: '∀' },
  { label: '\\exists', type: 'constant', info: '∃' },
  { label: '\\neg', type: 'constant', info: '¬' },
  { label: '\\land', type: 'constant', info: '∧' },
  { label: '\\lor', type: 'constant', info: '∨' },
  { label: '\\mathbb', type: 'function', info: '黑板粗体' },
  { label: '\\mathbf', type: 'function', info: '粗体' },
  { label: '\\mathit', type: 'function', info: '数学斜体' },
  { label: '\\mathrm', type: 'function', info: '正体' },
  { label: '\\mathcal', type: 'function', info: '花体' },
  { label: '\\operatorname', type: 'function', info: '运算符名' }
]

// 中文常用快捷
const CN_SHORTCUTS: Completion[] = [
  { label: '\\chinesearticle', snippet: '\\documentclass[UTF8,a4paper,12pt]{ctexart}\n\\usepackage{ctex}\n\\setCJKmainfont{SimSun}\n\\setCJKsansfont{Microsoft YaHei}\n\\parindent = 2em\n\n\\title{$1}\n\\author{$2}\n\\date{\\today}\n\n\\begin{document}\n\\maketitle\n\n$0\n\n\\end{document}', info: '中文文章模板' },
  { label: '\\beginfigure', snippet: '\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics[width=0.8\\textwidth]{$1}\n  \\caption{$2}\n  \\label{fig:$3}\n\\end{figure}', info: '图片环境' },
  { label: '\\begintable', snippet: '\\begin{table}[htbp]\n  \\centering\n  \\caption{$1}\n  \\label{tab:$2}\n  \\begin{tabular}{l c r}\n    \\hline\n    $0\n    \\\\\n    \\hline\n  \\end{tabular}\n\\end{table}', info: '表格环境' },
  { label: '\\beginalign', snippet: '\\begin{align}\n  $1\n  \\label{eq:$2}\n\\end{align}', info: '对齐公式环境' },
  { label: '\\beginitemize', snippet: '\\begin{itemize}\n  \\item $1\n\\end{itemize}', info: '无序列表' },
  { label: '\\beginenumerate', snippet: '\\begin{enumerate}\n  \\item $1\n\\end{enumerate}', info: '有序列表' },
  { label: '\\beginframe', snippet: '\\begin{frame}{$1}\n  $0\n\\end{frame}', info: 'Beamer 帧' }
]

/**
 * 主补全函数
 */
export function latexCompletions(context: CompletionContext): CompletionResult | null {
  const { state, pos, explicit } = context
  const line = state.doc.lineAt(pos)
  const textBefore = line.text.slice(0, pos - line.from)
  const fullText = state.sliceDoc(0, pos)

  // 1. \begin{} 环境补全
  const beginMatch = textBefore.match(/\\begin\{([^}]*)$/)
  if (beginMatch) {
    return {
      from: pos - beginMatch[1].length,
      options: ENVIRONMENTS.map((e) => ({
        ...e,
        apply: e.label
      })),
      validFor: /^[\w*]*$/
    }
  }

  // 2. \cite{} 引用补全 — 优先使用 BibTeX 扫描器，回退到文档内提取
  const citeMatch = textBefore.match(/\\cite[pt]?\*?(?:\[[^\]]*\])?\{([^}]*)$/)
  if (citeMatch) {
    const prefix = citeMatch[1]
    let options: Completion[] = []

    // 从 bibScanner 获取项目级引用键
    const scanned = bibScanner.getEntries()
    if (scanned.length > 0) {
      options = scanned.map((e) => ({
        label: e.key,
        type: 'text' as const,
        info: e.title ? `${e.type}: ${e.title.slice(0, 60)}` : e.type,
        apply: e.key
      }))
    } else {
      // 回退：从当前文档提取
      const bibKeys = extractBibKeys(state.doc.toString())
      options = bibKeys.map((k) => ({ label: k, type: 'text' as const, info: '引用键' }))
    }

    return {
      from: pos - prefix.length,
      options,
      validFor: /^[\w:.-]*$/
    }
  }

  // 3. \ref{} 标签补全
  const refMatch = textBefore.match(/\\(ref|eqref|pageref|autoref)\{([^}]*)$/)
  if (refMatch) {
    const labels = extractLabels(state.doc.toString())
    return {
      from: pos - refMatch[2].length,
      options: labels.map((l) => ({ label: l, type: 'variable', info: '标签' })),
      validFor: /^[\w:.-]*$/
    }
  }

  // 4. \includegraphics{} 图片补全
  const imgMatch = textBefore.match(/\\includegraphics(?:\[[^\]]*\])?\{([^}]*)$/)
  if (imgMatch) {
    // 这里只能给出常见路径提示，实际项目图片由前端注入更好
    const images = extractImageRefs(state.doc.toString())
    return {
      from: pos - imgMatch[1].length,
      options: images.map((i) => ({ label: i, type: 'file', info: '图片' })),
      validFor: /^[\w./\\-]*$/
    }
  }

  // 5. \usepackage{} 宏包补全
  const pkgMatch = textBefore.match(/\\usepackage(?:\[[^\]]*\])?\{([^}]*)$/)
  if (pkgMatch) {
    return {
      from: pos - pkgMatch[1].length,
      options: COMMON_PACKAGES.map((p) => ({ label: p.label, type: 'namespace', info: p.info })),
      validFor: /^[\w,-]*$/
    }
  }

  // 6. 普通命令补全（以 \ 开头）
  const cmdMatch = textBefore.match(/\\([a-zA-Z@]*)$/)
  if (cmdMatch) {
    const word = cmdMatch[1]
    if (word.length === 0 && !explicit) return null
    const options = [
      ...COMMON_COMMANDS,
      ...CN_SHORTCUTS,
      ...MATH_SYMBOLS
    ]
    return {
      from: pos - word.length - 1, // 包含反斜杠
      options,
      validFor: /^\\?[a-zA-Z@]*$/
    }
  }

  // 7. 显式触发（Ctrl+Space）时给出所有
  if (explicit) {
    return {
      from: pos,
      options: [...COMMON_COMMANDS, ...CN_SHORTCUTS],
      validFor: undefined
    }
  }

  return null
}

const COMMON_PACKAGES: { label: string; info: string }[] = [
  { label: 'amsmath', info: '数学扩展' },
  { label: 'amssymb', info: '数学符号' },
  { label: 'amsthm', info: '定理环境' },
  { label: 'graphicx', info: '图片' },
  { label: 'xcolor', info: '颜色' },
  { label: 'geometry', info: '页面布局' },
  { label: 'hyperref', info: '超链接' },
  { label: 'fontspec', info: '字体设置（XeLaTeX）' },
  { label: 'ctex', info: '中文支持' },
  { label: 'booktabs', info: '三线表' },
  { label: 'multirow', info: '表格合并行' },
  { label: 'multicol', info: '多栏' },
  { label: 'array', info: '表格列格式' },
  { label: 'tabularx', info: '自适应表格' },
  { label: 'longtable', info: '跨页表格' },
  { label: 'natbib', info: '引用样式' },
  { label: 'biblatex', info: '现代参考文献' },
  { label: 'gbt7714', info: '国标参考文献格式' },
  { label: 'listings', info: '代码高亮' },
  { label: 'minted', info: '代码高亮（需 shell-escape）' },
  { label: 'tikz', info: '绘图' },
  { label: 'pgfplots', info: '函数图' },
  { label: 'caption', info: '图表标题' },
  { label: 'subcaption', info: '子图' },
  { label: 'float', info: '浮动体控制' },
  { label: 'setspace', info: '行距' },
  { label: 'enumitem', info: '列表定制' },
  { label: 'titlesec', info: '标题样式' },
  { label: 'fancyhdr', info: '页眉页脚' },
  { label: 'lastpage', info: '总页数' },
  { label: 'xeCJK', info: '中日韩文字（ctex 已含）' },
  { label: 'ulem', info: '下划线扩展' },
  { label: 'soul', info: '高亮/下划线' }
]

function extractBibKeys(text: string): string[] {
  const keys = new Set<string>()
  // 从 \cite{key1,key2} 中提取已有的
  const citeRe = /\\cite[pt]?\{([^}]+)\}/g
  let m: RegExpExecArray | null
  while ((m = citeRe.exec(text))) {
    for (const k of m[1].split(',')) {
      const key = k.trim()
      if (key) keys.add(key)
    }
  }
  // 从 @article{key, 等 bib 语法（如果当前文档就是 bib）
  const bibRe = /@\w+\{([^,\s]+)\s*,/g
  while ((m = bibRe.exec(text))) {
    keys.add(m[1].trim())
  }
  return [...keys]
}

function extractLabels(text: string): string[] {
  const labels = new Set<string>()
  const re = /\\label\{([^}]+)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    labels.add(m[1])
  }
  return [...labels]
}

function extractImageRefs(text: string): string[] {
  const imgs = new Set<string>()
  const re = /\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    imgs.add(m[1])
  }
  return [...imgs]
}
