// 模板注册表：内置模板元数据
import zhArticle from '../templates/中文论文.tex?raw'
import zhResume from '../templates/中文简历.tex?raw'
import labReport from '../templates/实验报告.tex?raw'
import beamer from '../templates/幻灯片/Beamer经典Madrid.tex?raw'
import slidesAcademic from '../templates/幻灯片/学术研究汇报.tex?raw'
import slidesCourse from '../templates/幻灯片/课程报告.tex?raw'
import slidesMinimalEn from '../templates/幻灯片/极简英文研讨会.tex?raw'
import slidesModernCn from '../templates/幻灯片/现代中文报告.tex?raw'
import enArticle from '../templates/英文论文.tex?raw'
import resumeUndergrad from '../templates/简历/中文应届生简历.tex?raw'
import resumeTech from '../templates/简历/中文技术双栏简历.tex?raw'
import resumeCompact from '../templates/简历/中文紧凑简历.tex?raw'
import resumeEn from '../templates/简历/英文简历.tex?raw'
import ieeeJournal from '../templates/英文论文/IEEE投稿模板.tex?raw'
import elsevierJournal from '../templates/英文论文/Elsevier投稿模板.tex?raw'
import wileyJournal from '../templates/英文论文/Wiley投稿模板.tex?raw'
import cumcmMain from '../templates/cumcm/main.tex?raw'
import cumcmCls from '../templates/cumcm/cumcmthesis.cls?raw'
import cumcmSty from '../templates/cumcm/cumcm2026.sty?raw'
import {
  cat_pdf as cumcmCat,
  f1_png as cumcmF1,
  gongzhonghao_jpg as cumcmGzh,
  gongzhonghao2_png as cumcmGzh2,
  smokeblk_pdf as cumcmSmoke,
  upload_png as cumcmUpload
} from '../templates/cumcm/assets.base64'

// Elsevier CAS 官方双栏
import casDcMain from '../templates/英文论文/Elsevier_CAS_双栏/cas-dc-template.tex?raw'
import casDcCls from '../templates/英文论文/Elsevier_CAS_双栏/cas-dc.cls?raw'
import casCommonSty from '../templates/英文论文/Elsevier_CAS_双栏/cas-common.sty?raw'
import casRefsDc from '../templates/英文论文/Elsevier_CAS_双栏/cas-refs.bib?raw'
import casBst from '../templates/英文论文/Elsevier_CAS_双栏/model1-num-names.bst?raw'
import { cas_dc_assets } from '../templates/英文论文/Elsevier_CAS_双栏/assets.base64'

// Elsevier CAS 官方单栏
import casScMain from '../templates/英文论文/Elsevier_CAS_单栏/cas-sc-template.tex?raw'
import casScCls from '../templates/英文论文/Elsevier_CAS_单栏/cas-sc.cls?raw'
import casRefsSc from '../templates/英文论文/Elsevier_CAS_单栏/cas-refs.bib?raw'
import { cas_sc_assets } from '../templates/英文论文/Elsevier_CAS_单栏/assets.base64'

// IEEE 官方会议模板
import ieeeConfMain from '../templates/英文论文/IEEE_Conference_Official/conference_101719.tex?raw'
import ieeeTranCls from '../templates/英文论文/IEEE_Conference_Official/IEEEtran.cls?raw'
import { ieee_conf_assets } from '../templates/英文论文/IEEE_Conference_Official/assets.base64'

// IEEE 官方期刊模板
import ieeeJrnlMain from '../templates/英文论文/IEEE_Journal_Official/bare_jrnl.tex?raw'

export type TemplateCategory =
  | '中文论文'
  | '英文论文'
  | '简历'
  | '幻灯片'
  | '报告'
  | '其他'

export interface TemplateMeta {
  id: string
  name: string
  category: TemplateCategory
  engine: string
  description: string
  content: string
  extraFiles?: Array<{ name: string; content: string }>
  assetFiles?: Array<{ name: string; dataUrl: string }>
  preview?: string
  locked?: boolean
  remoteUrl?: string
}

export interface TemplateNavItem {
  id: string
  label: string
  icon: string
  category: TemplateCategory | '全部'
}

export const TEMPLATE_NAV: TemplateNavItem[] = [
  { id: 'all', label: '全部模板', icon: '▦', category: '全部' },
  { id: 'zh-paper', label: '中文论文', icon: '📄', category: '中文论文' },
  { id: 'en-paper', label: '英文论文', icon: '📰', category: '英文论文' },
  { id: 'resume', label: '简历', icon: '👤', category: '简历' },
  { id: 'slides', label: '幻灯片', icon: '🖼', category: '幻灯片' },
  { id: 'report', label: '报告', icon: '📋', category: '报告' }
]

function makePreview(title: string, subtitle: string, accent: string, layout: 'stack' | 'column' | 'side' = 'stack'): string {
  if (layout === 'column') {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 260" width="200" height="260">
  <rect width="200" height="260" rx="4" fill="#fafaf9" stroke="#e5e7eb"/>
  <rect x="0" y="0" width="62" height="260" fill="#1f2937"/>
  <rect x="10" y="24" width="42" height="6" rx="1" fill="${accent}"/>
  <rect x="10" y="40" width="36" height="3" rx="1" fill="#9ca3af"/>
  <rect x="10" y="58" width="42" height="3" rx="1" fill="#6b7280"/>
  <rect x="78" y="28" width="70" height="5" rx="1" fill="${accent}" opacity="0.75"/>
  <rect x="78" y="48" width="100" height="3" rx="1" fill="#d1d5db"/>
  <rect x="78" y="60" width="100" height="3" rx="1" fill="#e5e7eb"/>
  <rect x="78" y="92" width="48" height="4" rx="1" fill="#d1d5db"/>
  <rect x="78" y="108" width="100" height="3" rx="1" fill="#e5e7eb"/>
  <text x="100" y="246" text-anchor="middle" font-family="sans-serif" font-size="8" fill="#9ca3af">${title}</text>
</svg>`
    return `data:image/svg+xml,${encodeURIComponent(svg)}`
  }
  if (layout === 'side') {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 260" width="200" height="260">
  <rect width="200" height="260" rx="4" fill="#fafaf9" stroke="#e5e7eb"/>
  <rect x="16" y="16" width="168" height="36" rx="2" fill="#fff" stroke="#f3f4f6"/>
  <circle cx="38" cy="34" r="12" fill="${accent}" opacity="0.25"/>
  <rect x="58" y="26" width="70" height="5" rx="1" fill="${accent}" opacity="0.7"/>
  <rect x="58" y="38" width="90" height="3" rx="1" fill="#d1d5db"/>
  <rect x="16" y="64" width="48" height="4" rx="1" fill="${accent}"/>
  <rect x="16" y="78" width="168" height="3" rx="1" fill="#e5e7eb"/>
  <rect x="16" y="110" width="48" height="4" rx="1" fill="${accent}"/>
  <rect x="16" y="124" width="168" height="3" rx="1" fill="#e5e7eb"/>
  <text x="100" y="246" text-anchor="middle" font-family="sans-serif" font-size="8" fill="#9ca3af">${title}</text>
</svg>`
    return `data:image/svg+xml,${encodeURIComponent(svg)}`
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 260" width="200" height="260">
  <rect width="200" height="260" rx="4" fill="#fafaf9" stroke="#e5e7eb"/>
  <rect x="16" y="16" width="168" height="228" rx="2" fill="#fff" stroke="#f3f4f6"/>
  <rect x="28" y="32" width="80" height="6" rx="1" fill="${accent}" opacity="0.7"/>
  <rect x="28" y="46" width="120" height="4" rx="1" fill="#d1d5db"/>
  <rect x="28" y="72" width="144" height="3" rx="1" fill="#e5e7eb"/>
  <rect x="28" y="92" width="144" height="3" rx="1" fill="#e5e7eb"/>
  <rect x="28" y="112" width="144" height="3" rx="1" fill="#e5e7eb"/>
  <rect x="28" y="132" width="144" height="3" rx="1" fill="#e5e7eb"/>
  <rect x="28" y="152" width="144" height="3" rx="1" fill="#e5e7eb"/>
  <rect x="28" y="172" width="144" height="3" rx="1" fill="#e5e7eb"/>
  <rect x="28" y="192" width="144" height="3" rx="1" fill="#e5e7eb"/>
  <text x="100" y="248" text-anchor="middle" font-family="sans-serif" font-size="8" fill="#9ca3af">${title}</text>
</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

export const BUILTIN_TEMPLATES: TemplateMeta[] = [
  {
    id: 'zh-article',
    name: '中文论文',
    category: '中文论文',
    engine: 'xelatex',
    description: 'ctexart 中文课程论文/学位论文模板，含封面、摘要、章节结构',
    content: zhArticle,
    preview: makePreview('中文论文', 'ctexart', '#2563eb')
  },
  {
    id: 'cumcm',
    name: '国赛论文',
    category: '中文论文',
    engine: 'xelatex',
    description: '全国大学生数学建模竞赛（CUMCM）标准模板，含封面、承诺书、摘要、示例图片与参考文献结构',
    content: cumcmMain,
    extraFiles: [
      { name: 'cumcmthesis.cls', content: cumcmCls },
      { name: 'cumcm2026.sty', content: cumcmSty }
    ],
    assetFiles: [
      { name: 'figures/cat.pdf', dataUrl: cumcmCat },
      { name: 'figures/f1.png', dataUrl: cumcmF1 },
      { name: 'figures/gongzhonghao.jpg', dataUrl: cumcmGzh },
      { name: 'figures/gongzhonghao2.png', dataUrl: cumcmGzh2 },
      { name: 'figures/smokeblk.pdf', dataUrl: cumcmSmoke },
      { name: 'figures/upload.png', dataUrl: cumcmUpload }
    ],
    preview: makePreview('国赛论文', 'CUMCM', '#dc2626')
  },
  {
    id: 'en-article',
    name: '英文论文',
    category: '英文论文',
    engine: 'pdflatex',
    description: '英文期刊/会议论文模板，含 abstract、references 结构',
    content: enArticle,
    preview: makePreview('英文论文', 'article', '#0ea5e9')
  },
  {
    id: 'ieee-conference',
    name: 'IEEE 投稿模板',
    category: '英文论文',
    engine: 'pdflatex',
    description: '基于官方 IEEEtran 的会议/期刊骨架（TeX Live 自带类文件）',
    content: ieeeJournal,
    preview: makePreview('IEEE', 'IEEEtran', '#00629B')
  },
  {
    id: 'elsevier-journal',
    name: 'Elsevier 投稿模板',
    category: '英文论文',
    engine: 'pdflatex',
    description: '基于官方 elsarticle 的预印本/期刊骨架',
    content: elsevierJournal,
    preview: makePreview('Elsevier', 'elsarticle', '#FF6600')
  },
  {
    id: 'wiley-journal',
    name: 'Wiley 投稿模板',
    category: '英文论文',
    engine: 'pdflatex',
    description: 'Wiley 常见期刊结构骨架；正式提交请按目标期刊下载 Wiley class',
    content: wileyJournal,
    preview: makePreview('Wiley', 'journal', '#9B0000')
  },
  {
    id: 'elsevier-cas-dc',
    name: 'Elsevier CAS 双栏',
    category: '英文论文',
    engine: 'pdflatex',
    description: 'Elsevier 官方 CAS 双栏模板（cas-dc），含类文件、示例图与参考文献',
    content: casDcMain,
    extraFiles: [
      { name: 'cas-dc.cls', content: casDcCls },
      { name: 'cas-common.sty', content: casCommonSty },
      { name: 'cas-refs.bib', content: casRefsDc },
      { name: 'model1-num-names.bst', content: casBst }
    ],
    assetFiles: cas_dc_assets,
    preview: makePreview('CAS 双栏', 'Elsevier', '#FF6600', 'column')
  },
  {
    id: 'elsevier-cas-sc',
    name: 'Elsevier CAS 单栏',
    category: '英文论文',
    engine: 'pdflatex',
    description: 'Elsevier 官方 CAS 单栏模板（cas-sc），含类文件、示例图与参考文献',
    content: casScMain,
    extraFiles: [
      { name: 'cas-sc.cls', content: casScCls },
      { name: 'cas-common.sty', content: casCommonSty },
      { name: 'cas-refs.bib', content: casRefsSc },
      { name: 'model1-num-names.bst', content: casBst }
    ],
    assetFiles: cas_sc_assets,
    preview: makePreview('CAS 单栏', 'Elsevier', '#FF6600')
  },
  {
    id: 'ieee-conference-official',
    name: 'IEEE 会议论文（官方）',
    category: '英文论文',
    engine: 'pdflatex',
    description: 'IEEE 官方会议模板 conference_101719，自带 IEEEtran.cls 与示例图',
    content: ieeeConfMain,
    extraFiles: [{ name: 'IEEEtran.cls', content: ieeeTranCls }],
    assetFiles: ieee_conf_assets,
    preview: makePreview('IEEE 会议', 'conference', '#00629B')
  },
  {
    id: 'ieee-journal-official',
    name: 'IEEE 期刊论文（官方）',
    category: '英文论文',
    engine: 'pdflatex',
    description: 'IEEE 官方期刊骨架 bare_jrnl（IEEEtran journal），依赖 TeX Live 自带类文件',
    content: ieeeJrnlMain,
    preview: makePreview('IEEE 期刊', 'journal', '#00629B')
  },
  {
    id: 'resume-undergrad',
    name: '中文应届生简历',
    category: '简历',
    engine: 'xelatex',
    description: '单栏应届生简历，含教育、实习、项目、技能与奖项，适合校招投递',
    content: resumeUndergrad,
    preview: makePreview('应届生简历', 'single', '#1A56DB', 'side')
  },
  {
    id: 'resume-tech',
    name: '中文技术双栏',
    category: '简历',
    engine: 'xelatex',
    description: '深色侧栏 + 主内容区双栏布局，适合社招技术岗',
    content: resumeTech,
    preview: makePreview('技术双栏', 'sidebar', '#3B82F6', 'column')
  },
  {
    id: 'resume-compact',
    name: '中文紧凑简历',
    category: '简历',
    engine: 'xelatex',
    description: '高信息密度单页简历，适合内容较多时控制在一页内',
    content: resumeCompact,
    preview: makePreview('紧凑简历', 'dense', '#0F766E', 'side')
  },
  {
    id: 'resume-en',
    name: '英文简历',
    category: '简历',
    engine: 'xelatex',
    description: 'Awesome-CV 风格英文简历，含 Education、Experience、Projects、Skills',
    content: resumeEn,
    preview: makePreview('English CV', 'EN', '#5B21B6', 'side')
  },
  {
    id: 'zh-resume',
    name: '中文简历（简洁）',
    category: '简历',
    engine: 'xelatex',
    description: '简洁中文简历模板，含教育背景、项目经历、技能板块',
    content: zhResume,
    preview: makePreview('简洁简历', 'basic', '#10b981', 'side')
  },
  {
    id: 'beamer-madrid',
    name: 'Beamer 经典 Madrid',
    category: '幻灯片',
    engine: 'xelatex',
    description: '经典 Beamer Madrid 主题，适合通用学术报告入门',
    content: beamer,
    preview: makePreview('Madrid', 'classic', '#8b5cf6')
  },
  {
    id: 'slides-academic-metro',
    name: '学术研究汇报',
    category: '幻灯片',
    engine: 'xelatex',
    description: 'Metropolis 现代深色主题，适合组会/学术报告，含结果表与公式',
    content: slidesAcademic,
    preview: makePreview('学术汇报', 'Metropolis', '#1e293b')
  },
  {
    id: 'slides-course',
    name: '课程报告',
    category: '幻灯片',
    engine: 'xelatex',
    description: '清新青绿双色课程展示，含流程图与作业提示结构',
    content: slidesCourse,
    preview: makePreview('课程报告', 'course', '#0F766E')
  },
  {
    id: 'slides-modern-cn',
    name: '现代中文报告',
    category: '幻灯片',
    engine: 'xelatex',
    description: '浅色现代 Metropolis 变体，适合项目进展与阶段汇报',
    content: slidesModernCn,
    preview: makePreview('中文报告', 'progress', '#0EA5E9')
  },
  {
    id: 'slides-minimal-en',
    name: '极简英文研讨会',
    category: '幻灯片',
    engine: 'xelatex',
    description: 'Arguelles 极简英文 seminar 风格，适合国际组会与 journal club',
    content: slidesMinimalEn,
    preview: makePreview('EN Seminar', 'arguelles', '#334155')
  },
  {
    id: 'lab-report',
    name: '实验报告',
    category: '报告',
    engine: 'xelatex',
    description: '大学物理/化学等课程实验报告模板，含实验目的、步骤、数据表格',
    content: labReport,
    preview: makePreview('实验报告', 'report', '#f59e0b')
  }
]

export const TEMPLATE_CATEGORIES = [
  '全部',
  '中文论文',
  '英文论文',
  '简历',
  '幻灯片',
  '报告'
] as const

export function filterTemplates(category: string): TemplateMeta[] {
  if (category === '全部') return BUILTIN_TEMPLATES
  return BUILTIN_TEMPLATES.filter((t) => t.category === category)
}

export function searchTemplates(query: string): TemplateMeta[] {
  const q = query.trim().toLowerCase()
  if (!q) return BUILTIN_TEMPLATES
  return BUILTIN_TEMPLATES.filter(
    (t) =>
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.category.toLowerCase().includes(q)
  )
}
