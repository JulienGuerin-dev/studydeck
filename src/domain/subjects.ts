import { db, deviceId, now, uuid } from '../db/db'
import type { Card, Folder, ReviewEvent, SubjectKind } from '../db/types'
import { recomputeScheduling } from '../review/scheduling'
import { descendantIds } from './folders'

export const kindOf = (f: Folder | undefined): SubjectKind => f?.kind ?? 'learning'

export function rootOf(id: string, byId: Map<string, Folder>): Folder | undefined {
  let cur = byId.get(id)
  let g = 0
  while (cur?.parentId && byId.has(cur.parentId) && g++ < 200) cur = byId.get(cur.parentId)
  return cur
}

export const KIND_LABEL: Record<SubjectKind, string> = { learning: 'Apprentissage', hobbit: 'Loisir', archive: 'Archive' }

/** Cartes vivantes d'une matière (sous-dossiers compris). */
async function subjectCards(rootId: string): Promise<Card[]> {
  const ids = new Set(await descendantIds(rootId))
  return (await db.cards.toArray()).filter((c) => c.deletedAt === null && ids.has(c.folderId))
}

/**
 * Change le type d'une matière. En passant (ou repassant) à « learning », `level` indique l'étape où l'on se situe :
 * toutes les cartes de la matière sont placées à cette étape (événements « set-level », historique conservé).
 */
export async function setSubjectKind(rootId: string, kind: SubjectKind, level?: number): Promise<number> {
  const f = await db.folders.get(rootId)
  if (!f || f.deletedAt !== null) throw new Error('Matière introuvable.')
  if (f.parentId !== null) throw new Error('Le type ne se règle que sur une matière (dossier racine).')
  const dev = await deviceId()
  const t = now()
  const cards = kind === 'learning' && level ? await subjectCards(rootId) : []
  const events: ReviewEvent[] = cards.map((c) => ({
    id: uuid(), cardId: c.id, deviceId: dev, sessionId: 'manual', at: t, correct: true, kind: 'set-level', mode: 'free', level,
  }))
  await db.transaction('rw', db.folders, db.events, db.scheduling, async () => {
    if ((f.kind ?? 'learning') !== kind) await db.folders.put({ ...f, kind, updatedAt: t, rev: f.rev + 1, deviceId: dev })
    if (events.length) await db.events.bulkAdd(events)
    await recomputeScheduling(cards.map((c) => c.id))
  })
  return events.length
}

/** Place une carte à une étape donnée (correction manuelle). */
export async function setCardLevel(cardId: string, level: number) {
  const c = await db.cards.get(cardId)
  if (!c || c.deletedAt !== null) throw new Error('Carte introuvable.')
  const ev: ReviewEvent = {
    id: uuid(), cardId, deviceId: await deviceId(), sessionId: 'manual', at: now(), correct: true, kind: 'set-level', mode: 'free', level,
  }
  await db.transaction('rw', db.events, db.scheduling, async () => {
    await db.events.add(ev)
    await recomputeScheduling([cardId])
  })
}

export async function setFolderStyle(id: string, style: { emoji?: string; color?: string }) {
  const f = await db.folders.get(id)
  if (!f || f.deletedAt !== null) throw new Error('Dossier introuvable.')
  const next: Folder = { ...f, updatedAt: now(), rev: f.rev + 1, deviceId: await deviceId() }
  if ('emoji' in style) { if (style.emoji) next.emoji = style.emoji.trim(); else delete next.emoji }
  if ('color' in style) { if (style.color) next.color = style.color; else delete next.color }
  await db.folders.put(next)
}

/**
 * Une matière en apprentissage dont TOUTES les cartes ont terminé les 6 étapes passe en « archive ».
 * Retourne les noms des matières archivées.
 */
export async function autoArchive(rootIds: string[]): Promise<string[]> {
  const archived: string[] = []
  for (const id of [...new Set(rootIds)]) {
    const f = await db.folders.get(id)
    if (!f || f.deletedAt !== null || f.parentId !== null || kindOf(f) !== 'learning') continue
    const cards = await subjectCards(id)
    if (!cards.length) continue
    const scheds = new Map((await db.scheduling.bulkGet(cards.map((c) => c.id))).filter(Boolean).map((s) => [s!.cardId, s!]))
    if (cards.every((c) => scheds.get(c.id)?.graduated)) {
      await db.folders.put({ ...f, kind: 'archive', updatedAt: now(), rev: f.rev + 1, deviceId: await deviceId() })
      archived.push(f.name)
    }
  }
  return archived
}
