// Rendu Markdown + LaTeX (KaTeX), assaini (DOMPurify). Les formules sont extraites avant le Markdown
// puis réinjectées après l'assainissement pour que KaTeX ne soit pas altéré.

import DOMPurify from 'dompurify'
import katex from 'katex'
import { marked } from 'marked'

marked.setOptions({ gfm: true, breaks: true })

interface Math { tex: string; display: boolean }
const PH_OPEN = '\uE000'
const PH_CLOSE = '\uE001'

export function extractMath(src: string): { text: string; maths: Math[] } {
  const maths: Math[] = []
  const hold = (tex: string, display: boolean) => {
    maths.push({ tex: tex.trim(), display })
    return `${PH_OPEN}${maths.length - 1}${PH_CLOSE}`
  }
  const parts = src.split(/(```[\s\S]*?```|`[^`\n]*`)/g) // les segments impairs sont du code : on n'y touche pas
  const text = parts
    .map((p, i) => {
      if (i % 2 === 1) return p
      return p
        .replace(/\$\$([\s\S]+?)\$\$/g, (_m, t: string) => hold(t, true))
        .replace(/\\\[([\s\S]+?)\\\]/g, (_m, t: string) => hold(t, true))
        .replace(/\\\(([\s\S]+?)\\\)/g, (_m, t: string) => hold(t, false))
        .replace(/(?<![\\$])\$(?![\s$])([^$\n]+?)(?<![\s\\])\$(?![\d$])/g, (_m, t: string) => hold(t, false))
    })
    .join('')
  return { text, maths }
}

const URI_OK = /^(?:(?:https?|media|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i

export function renderMarkdown(src: string): string {
  const { text, maths } = extractMath(src ?? '')
  const raw = marked.parse(text, { async: false }) as string
  const clean = DOMPurify.sanitize(raw, { ALLOWED_URI_REGEXP: URI_OK, FORBID_TAGS: ['style', 'form', 'input', 'iframe'] })
  return clean.replace(new RegExp(`${PH_OPEN}(\\d+)${PH_CLOSE}`, 'g'), (_m, i: string) => {
    const m = maths[Number(i)]
    try {
      return katex.renderToString(m.tex, { displayMode: m.display, throwOnError: false, output: 'html', strict: 'ignore' })
    } catch {
      return `<code>${m.tex.replace(/</g, '&lt;')}</code>`
    }
  })
}

/** Texte brut abrégé pour les listes. */
export function plainPreview(src: string, max = 140): string {
  const t = (src ?? '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '[image]')
    .replace(/```[\s\S]*?```/g, '[code]')
    .replace(/[#*_`>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return t.length > max ? t.slice(0, max - 1) + '…' : t
}
