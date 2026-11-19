// Format d'échange .studydeck (voir docs/FORMAT_STUDYDECK.md).
// Séparé du stockage interne : l'import convertit, l'export reconstruit.

import { db, deviceId, now, uuid } from '../db/db'
import { sha256Hex } from '../db/hash'
import type { Card, Folder } from '../db/types'
import { EXT_BY_MIME, mimeFromName, referencedHashes } from '../domain/media'
import { recomputeScheduling } from '../review/scheduling'
import { isZip, makeZip, readZip, strFromU8 } from './zip'

export const DECK_FORMAT = 'studydeck'
export const DECK_VERSION = 1
const MAX_CARDS = 20000
const MAX_TEXT = 200_000

/* ----------------------- Types du brouillon d'import ----------------------- */

export interface DraftCard { tempId: string; front: string; back: string }
export interface DraftFolder { tempId: string; name: string; cards: DraftCard[]; folders: DraftFolder[] }
export interface DraftMedia { mime: string; data: Uint8Array }
export interface Draft {
  name: string
  rootCards: DraftCard[]
  folders: DraftFolder[]
  media: Map<string, DraftMedia> // hash -> contenu
}

export interface ParseResult {
  ok: boolean
  errors: string[]
  warnings: string[]
  draft?: Draft
}

/* ----------------------------- Lecture / validation ----------------------------- */

export async function parseStudyDeck(bytes: Uint8Array): Promise<ParseResult> {
  const errors: string[] = []
  const warnings: string[] = []
  let jsonText: string
  const files: Record<string, Uint8Array> = {}

  try {
    if (isZip(bytes)) {
      const z = readZip(bytes)
      const key = Object.keys(z).find((k) => k.toLowerCase() === 'deck.json')
      if (!key) return { ok: false, errors: ['Le fichier ne contient pas de « deck.json » à sa racine.'], warnings }
      jsonText = strFromU8(z[key])
      for (const [k, v] of Object.entries(z)) if (k.toLowerCase().startsWith('media/') && v.length) files[k.replace(/^media\//i, 'media/')] = v
    } else {
      jsonText = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    }
  } catch {
    return { ok: false, errors: ['Le fichier est illisible : ce n\'est ni une archive .studydeck valide ni un fichier JSON UTF-8.'], warnings }
  }

  let raw: unknown
  try {
    raw = JSON.parse(jsonText.replace(/^\uFEFF/, ''))
  } catch (e) {
    return { ok: false, errors: [`Le JSON est invalide : ${(e as Error).message}`], warnings }
  }
  if (!isObj(raw)) return { ok: false, errors: ['Le contenu doit être un objet JSON.'], warnings }
  if (raw.format !== DECK_FORMAT) errors.push(`Le champ « format » doit valoir "${DECK_FORMAT}".`)
  if (raw.version !== DECK_VERSION) errors.push(`Version non prise en charge : ${String(raw.version)} (attendu : ${DECK_VERSION}).`)
  if (errors.length) return { ok: false, errors, warnings }

  const media = new Map<string, DraftMedia>()
  const pathToHash = new Map<string, string>()
  const ctx = { errors, warnings, count: 0, files, media, pathToHash }

  // Charge les images utilisées
  const rootCards = await readCards(raw.cards, 'à la racine', ctx)
  const folders = await readFolders(raw.folders, [], ctx)

  if (ctx.count === 0 && !errors.length) errors.push('Le fichier ne contient aucune carte.')
  if (ctx.count > MAX_CARDS) errors.push(`Trop de cartes (${ctx.count}). Maximum : ${MAX_CARDS}.`)
  if (errors.length) return { ok: false, errors: errors.slice(0, 30), warnings }

  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'Import'
  return { ok: true, errors: [], warnings, draft: { name, rootCards, folders, media } }
}

type Ctx = {
  errors: string[]; warnings: string[]; count: number
  files: Record<string, Uint8Array>; media: Map<string, DraftMedia>; pathToHash: Map<string, string>
}
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

async function readCards(raw: unknown, where: string, ctx: Ctx): Promise<DraftCard[]> {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) { ctx.errors.push(`« cards » doit être une liste (${where}).`); return [] }
  const out: DraftCard[] = []
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]
    const label = `Carte n°${i + 1} (${where})`
    if (!isObj(c)) { ctx.errors.push(`${label} : doit être un objet.`); continue }
    if (typeof c.front !== 'string' || !c.front.trim()) { ctx.errors.push(`${label} : « front » (recto) manquant ou vide.`); continue }
    if (typeof c.back !== 'string' || !c.back.trim()) { ctx.errors.push(`${label} : « back » (verso) manquant ou vide.`); continue }
    if (c.front.length > MAX_TEXT || c.back.length > MAX_TEXT) { ctx.errors.push(`${label} : texte trop long.`); continue }
    ctx.count++
    out.push({
      tempId: uuid(),
      front: await resolveMedia(c.front, label, ctx),
      back: await resolveMedia(c.back, label, ctx),
    })
  }
  return out
}

async function readFolders(raw: unknown, path: string[], ctx: Ctx): Promise<DraftFolder[]> {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) { ctx.errors.push(`« folders » doit être une liste (${path.join(' / ') || 'racine'}).`); return [] }
  const out: DraftFolder[] = []
  for (let i = 0; i < raw.length; i++) {
    const f = raw[i]
    if (!isObj(f)) { ctx.errors.push(`Dossier n°${i + 1} (${path.join(' / ') || 'racine'}) : doit être un objet.`); continue }
    if (typeof f.name !== 'string' || !f.name.trim()) { ctx.errors.push(`Dossier n°${i + 1} (${path.join(' / ') || 'racine'}) : « name » manquant.`); continue }
    const here = [...path, f.name.trim()]
    if (here.length > 50) { ctx.errors.push(`Hiérarchie trop profonde à « ${here.join(' / ')} ».`); continue }
    out.push({
      tempId: uuid(),
      name: f.name.trim(),
      cards: await readCards(f.cards, `dossier « ${here.join(' / ')} »`, ctx),
      folders: await readFolders(f.folders, here, ctx),
    })
  }
  return out
}

/** Remplace `media/xxx.png` par `media:<sha256>` et enregistre l'image dans le brouillon. */
async function resolveMedia(text: string, label: string, ctx: Ctx): Promise<string> {
  const re = /(?<=[("'])media\/[^\s)"']+/g
  const found = [...new Set(text.match(re) ?? [])]
  let out = text
  for (const p of found) {
    let h = ctx.pathToHash.get(p)
    if (!h) {
      const data = ctx.files[p]
      const mime = mimeFromName(p)
      if (!data) { ctx.errors.push(`${label} : image « ${p} » absente de l'archive.`); continue }
      if (!mime) { ctx.errors.push(`${label} : format d'image non pris en charge pour « ${p} ».`); continue }
      h = await sha256Hex(data)
      ctx.pathToHash.set(p, h)
      ctx.media.set(h, { mime, data })
    }
    out = out.split(p).join(`media:${h}`)
  }
  return out
}

/* ------------------------------ Aide sur le brouillon ------------------------------ */

export function flattenDraft(d: Draft): { card: DraftCard; path: string[] }[] {
  const out: { card: DraftCard; path: string[] }[] = d.rootCards.map((card) => ({ card, path: [] }))
  const walk = (fs: DraftFolder[], path: string[]) => {
    for (const f of fs) {
      const p = [...path, f.name]
      for (const card of f.cards) out.push({ card, path: p })
      walk(f.folders, p)
    }
  }
  walk(d.folders, [])
  return out
}

export function removeDraftCard(d: Draft, tempId: string) {
  d.rootCards = d.rootCards.filter((c) => c.tempId !== tempId)
  const walk = (fs: DraftFolder[]) => {
    for (const f of fs) { f.cards = f.cards.filter((c) => c.tempId !== tempId); walk(f.folders) }
  }
  walk(d.folders)
}

export function editDraftCard(d: Draft, tempId: string, front: string, back: string) {
  for (const { card } of flattenDraft(d)) if (card.tempId === tempId) { card.front = front; card.back = back }
}

export function cloneDraft(d: Draft): Draft {
  const cf = (f: DraftFolder): DraftFolder => ({ ...f, cards: f.cards.map((c) => ({ ...c })), folders: f.folders.map(cf) })
  return { ...d, rootCards: d.rootCards.map((c) => ({ ...c })), folders: d.folders.map(cf), media: d.media }
}

/* ---------------------------------- Importation ---------------------------------- */

export interface ImportDestination {
  parentId: string | null // dossier existant dans lequel importer (null = racine)
  newFolderName?: string // dossier à créer au moment de l'import (sous parentId)
  keepHierarchy: boolean // conserver les dossiers du fichier
}

export async function importDraft(draft: Draft, dest: ImportDestination): Promise<{ cards: number; folders: number }> {
  const dev = await deviceId()
  const t = now()
  const folders: Folder[] = []
  const cards: Card[] = []
  const usedTexts: string[] = []

  const mkFolder = (name: string, parentId: string | null): Folder => {
    const f: Folder = { id: uuid(), parentId, name, createdAt: t, updatedAt: t, deletedAt: null, rev: 1, deviceId: dev }
    folders.push(f)
    return f
  }
  const mkCard = (c: DraftCard, folderId: string) => {
    cards.push({ id: uuid(), folderId, front: c.front, back: c.back, createdAt: t, updatedAt: t, deletedAt: null, rev: 1, deviceId: dev })
    usedTexts.push(c.front, c.back)
  }

  let base: string | null = dest.parentId
  if (dest.parentId) {
    const p = await db.folders.get(dest.parentId)
    if (!p || p.deletedAt !== null) throw new Error('Le dossier de destination est introuvable.')
  }
  const all = flattenDraft(draft)
  if (!all.length) throw new Error('Aucune carte à importer.')
  const newName = dest.newFolderName?.trim()
  if (newName) base = mkFolder(newName, dest.parentId).id
  const needsBase = !dest.keepHierarchy || draft.rootCards.length > 0
  if (needsBase && base === null) base = mkFolder(draft.name, null).id

  if (dest.keepHierarchy) {
    for (const c of draft.rootCards) mkCard(c, base!)
    const walk = (fs: DraftFolder[], parent: string | null) => {
      for (const f of fs) {
        const nf = mkFolder(f.name, parent)
        for (const c of f.cards) mkCard(c, nf.id)
        walk(f.folders, nf.id)
      }
    }
    walk(draft.folders, base)
  } else {
    for (const { card } of all) mkCard(card, base!)
  }

  const blobs = referencedHashes(...usedTexts)
    .map((h) => ({ h, m: draft.media.get(h) }))
    .filter((x): x is { h: string; m: DraftMedia } => !!x.m)

  await db.transaction('rw', db.folders, db.cards, db.blobs, async () => {
    await db.folders.bulkAdd(folders)
    await db.cards.bulkAdd(cards)
    for (const b of blobs) if (!(await db.blobs.get(b.h))) await db.blobs.put({ hash: b.h, mime: b.m.mime, data: b.m.data })
  })
  return { cards: cards.length, folders: folders.length }
}

/* ---------------------------------- Exportation ---------------------------------- */

/** Exporte une matière/un dossier (avec ses descendants) ou toute la bibliothèque (scope = null). */
export async function exportStudyDeck(scope: string | null): Promise<{ bytes: Uint8Array; cards: number; name: string }> {
  const folders = (await db.folders.toArray()).filter((f) => f.deletedAt === null)
  const cards = (await db.cards.toArray()).filter((c) => c.deletedAt === null)
  const kids = new Map<string | null, Folder[]>()
  for (const f of folders) kids.set(f.parentId, [...(kids.get(f.parentId) ?? []), f])
  const cardsBy = new Map<string, Card[]>()
  for (const c of cards) cardsBy.set(c.folderId, [...(cardsBy.get(c.folderId) ?? []), c])
  const hashes = new Set<string>()
  let n = 0

  const conv = (s: string) => s.replace(/media:([0-9a-f]{64})/g, (_m, h: string) => { hashes.add(h); return `media/${h}` })
  const build = (f: Folder, depth = 0): unknown => ({
    name: f.name,
    cards: (cardsBy.get(f.id) ?? []).map((c) => { n++; return { front: conv(c.front), back: conv(c.back) } }),
    folders: depth > 100 ? [] : (kids.get(f.id) ?? []).sort(byName).map((k) => build(k, depth + 1)),
  })

  let name = 'Bibliothèque'
  let top: unknown[]
  if (scope === null) top = (kids.get(null) ?? []).sort(byName).map((f) => build(f))
  else {
    const f = folders.find((x) => x.id === scope)
    if (!f) throw new Error('Dossier introuvable.')
    name = f.name
    top = [build(f)]
  }

  const files: Record<string, Uint8Array | string> = {}
  const missing: string[] = []
  const blobExt = new Map<string, string>()
  for (const h of hashes) {
    const b = await db.blobs.get(h)
    if (!b) { missing.push(h); continue }
    const ext = EXT_BY_MIME[b.mime] ?? 'bin'
    blobExt.set(h, ext)
    files[`media/${h}.${ext}`] = b.data
  }
  const json = JSON.stringify({ format: DECK_FORMAT, version: DECK_VERSION, name, folders: top }, null, 2)
    .replace(/media\/([0-9a-f]{64})/g, (m, h: string) => (blobExt.has(h) ? `media/${h}.${blobExt.get(h)}` : m))
  files['deck.json'] = json
  return { bytes: makeZip(files), cards: n, name }
}

const byName = (a: Folder, b: Folder) => a.name.localeCompare(b.name, 'fr')

// utilisé par l'interface après import pour mettre à jour d'éventuelles planifications
export async function refreshAfterImport(cardIds: string[]) {
  await recomputeScheduling(cardIds)
}
