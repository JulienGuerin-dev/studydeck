import { useEffect, useMemo, useRef } from 'react'
import { mediaUrl } from '../domain/media'
import { renderMarkdown } from './markdown'

type Extra = Map<string, { mime: string; data: Uint8Array }>

/** Affiche du Markdown + LaTeX ; résout les images locales `media:<hash>`. */
export function Rich({ text, media, className = '' }: { text: string; media?: Extra; className?: string }) {
  const html = useMemo(() => renderMarkdown(text), [text])
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const root = ref.current
    if (!root) return
    let alive = true
    root.querySelectorAll<HTMLImageElement>('img[src^="media:"]').forEach(async (img) => {
      const hash = img.getAttribute('src')!.slice(6)
      const url = await mediaUrl(hash, media)
      if (!alive) return
      if (url) img.src = url
      else { img.alt = img.alt || 'Image manquante'; img.classList.add('missing') }
    })
    return () => { alive = false }
  }, [html, media])
  return <div ref={ref} className={`rich ${className}`} dangerouslySetInnerHTML={{ __html: html }} />
}
