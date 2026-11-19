import { db } from '../db/db'
import { sha256Hex } from '../db/hash'

export const MEDIA_PREFIX = 'media:'
export const MEDIA_REF_RE = /media:([0-9a-f]{64})/g

export const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg',
}
export const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
}

export function mimeFromName(name: string): string | null {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return MIME_BY_EXT[ext] ?? null
}

/** Enregistre une image (dédupliquée par hash SHA-256) et retourne son hash. */
export async function storeBlob(data: Uint8Array, mime: string): Promise<string> {
  const hash = await sha256Hex(data)
  if (!(await db.blobs.get(hash))) await db.blobs.put({ hash, mime, data })
  return hash
}

/** Redimensionne une image importée (max 1600 px) pour garder une bibliothèque légère. */
export async function imageFileToStored(file: File): Promise<string> {
  const mime = file.type || mimeFromName(file.name) || 'image/png'
  const raw = new Uint8Array(await file.arrayBuffer())
  if (mime === 'image/svg+xml' || mime === 'image/gif') return storeBlob(raw, mime)
  try {
    const bmp = await createImageBitmap(file)
    const max = 1600
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
    if (scale === 1 && raw.length < 600_000) return storeBlob(raw, mime)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale)
    canvas.height = Math.round(bmp.height * scale)
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    const outMime = mime === 'image/png' ? 'image/png' : 'image/jpeg'
    const blob: Blob = await new Promise((res, rej) =>
      canvas.toBlob((b) => (b ? res(b) : rej(new Error('Conversion impossible'))), outMime, 0.88))
    return storeBlob(new Uint8Array(await blob.arrayBuffer()), outMime)
  } catch {
    return storeBlob(raw, mime)
  }
}

const urlCache = new Map<string, string>()

/** URL utilisable dans <img> pour une image stockée localement (ou fournie en aperçu). */
export async function mediaUrl(hash: string, extra?: Map<string, { mime: string; data: Uint8Array }>): Promise<string | null> {
  const hit = urlCache.get(hash)
  if (hit) return hit
  const rec = extra?.get(hash) ?? (await db.blobs.get(hash))
  if (!rec) return null
  const url = URL.createObjectURL(new Blob([rec.data as BlobPart], { type: rec.mime }))
  urlCache.set(hash, url)
  return url
}

export function referencedHashes(...texts: string[]): string[] {
  const out = new Set<string>()
  for (const t of texts) for (const m of t.matchAll(MEDIA_REF_RE)) out.add(m[1])
  return [...out]
}
