// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { extractMath, plainPreview, renderMarkdown } from '../src/ui/markdown'

const H = 'a'.repeat(64)

describe('Rendu Markdown + LaTeX', () => {
  it('rend les formules avec KaTeX (pas de LaTeX brut)', () => {
    const html = renderMarkdown('Soit $x^2$ puis $$\\int_0^1 f(x)\\,dx$$ et \\(\\frac{a}{b}\\)')
    expect(html).toContain('katex')
    expect(html).toContain('katex-display')
    expect(html).not.toContain('\\int')
    expect(html).not.toContain('$x^2$')
  })
  it('ne touche pas aux montants en dollars ni au code', () => {
    expect(extractMath('Ça coûte 5 $ ou 6 $ au total').maths).toHaveLength(0)
    expect(extractMath('`$x$` et ```\n$y$\n```').maths).toHaveLength(0)
  })
  it('gère tableaux, listes, titres, gras, blocs de code avec indentation', () => {
    const html = renderMarkdown('## T\n\n**g** *i*\n\n- a\n- b\n\n1. un\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```\n  indenté\n```')
    for (const tag of ['<h2', '<strong>', '<em>', '<ul>', '<ol>', '<table>', '<pre>']) expect(html).toContain(tag)
    expect(html).toContain('  indenté')
  })
  it('conserve les références d\'images locales et assainit le HTML dangereux', () => {
    const html = renderMarkdown(`![x](media:${H}) <script>alert(1)</script> <img src=x onerror=alert(1)> [l](javascript:alert(1))`)
    expect(html).toContain(`src="media:${H}"`)
    expect(html).not.toContain('<script')
    expect(html).not.toContain('onerror')
    expect(html).not.toContain('javascript:')
  })
  it('génère un aperçu texte court', () => {
    expect(plainPreview('## Titre **gras** ![i](media:x)')).toBe('Titre gras [image]')
    expect(plainPreview('x'.repeat(300), 50).length).toBe(50)
  })
})
