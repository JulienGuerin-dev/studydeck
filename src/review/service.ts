import { db, deviceId, now, uuid } from '../db/db'
import type { Card, ReviewEvent, Session } from '../db/types'
import { descendantIds, folderPath, listFolders } from '../domain/folders'
import { autoArchive, kindOf, rootOf } from '../domain/subjects'
import { recomputeScheduling } from './scheduling'
import { ReviewSession } from './session'

export type ScopeId = string | null // null = toute la bibliothèque

export async function cardsInScope(scope: ScopeId): Promise<Card[]> {
  const cards = (await db.cards.toArray()).filter((c) => c.deletedAt === null)
  if (scope === null) return cards
  const ids = new Set(await descendantIds(scope))
  return cards.filter((c) => ids.has(c.folderId))
}

/** Matière (type) de chaque carte : sert à savoir si une carte est notée (apprentissage) ou simplement consultée. */
async function kindsByCard(cards: Card[]): Promise<Map<string, string>> {
  const byId = new Map((await listFolders()).map((f) => [f.id, f]))
  return new Map(cards.map((c) => [c.id, kindOf(rootOf(c.folderId, byId))]))
}

/**
 * Cartes « à réviser » : uniquement les matières en apprentissage ; cartes jamais révisées ou dont l'échéance
 * est arrivée, hors cartes ayant terminé les 6 étapes.
 */
export async function dueCardsInScope(scope: ScopeId, at = now()): Promise<Card[]> {
  const cards = await cardsInScope(scope)
  const kinds = await kindsByCard(cards)
  const sched = new Map((await db.scheduling.toArray()).map((s) => [s.cardId, s]))
  return cards.filter((c) => {
    if (kinds.get(c.id) !== 'learning') return false
    const s = sched.get(c.id)
    return !s || (!s.graduated && s.nextReviewAt <= at)
  })
}

export async function scopeLabel(scope: ScopeId): Promise<string> {
  if (scope === null) return 'Toute la bibliothèque'
  return folderPath(scope, await listFolders()) || 'Dossier'
}

export interface LiveSession {
  id: string
  logic: ReviewSession
  mode: 'due' | 'free'
  startedAt: number
  /** Identifiant de l'événement écrit pour chaque réponse (null = carte consultée sans notation). */
  eventIds: (string | null)[]
}

export async function startSession(scope: ScopeId, mode: 'due' | 'free', cardIds: string[]): Promise<LiveSession> {
  const all = await cardsInScope(null)
  const chosen = all.filter((c) => cardIds.includes(c.id))
  const kinds = await kindsByCard(chosen)
  const ungraded = chosen.filter((c) => kinds.get(c.id) !== 'learning').map((c) => c.id)
  const logic = new ReviewSession(cardIds, Math.random, ungraded)
  const id = uuid()
  const startedAt = now()
  const rec: Session = {
    id, startedAt, endedAt: null, scopeFolderId: scope, scopeLabel: await scopeLabel(scope), mode,
    selected: logic.selected, correct: 0, incorrect: 0, attempts: 0, deviceId: await deviceId(),
  }
  await db.sessions.add(rec)
  return { id, logic, mode, startedAt, eventIds: [] }
}

const counters = (s: LiveSession) => ({ correct: s.logic.correct, incorrect: s.logic.incorrect, attempts: s.logic.attempts })

/**
 * Enregistre une réponse : l'événement est écrit en base AVANT de passer à la carte suivante,
 * et l'étape de la carte est recalculée. Une carte sans notation (Loisir / Archive) ne génère aucun événement.
 */
export async function answerCard(s: LiveSession, correct: boolean): Promise<void> {
  const pres = s.logic.answer(correct)
  if (!pres.graded) { s.eventIds.push(null); return }
  const ev: ReviewEvent = {
    id: uuid(), cardId: pres.cardId, deviceId: await deviceId(), sessionId: s.id, at: now(), correct, kind: pres.kind, mode: s.mode,
  }
  s.eventIds.push(ev.id)
  await db.transaction('rw', db.events, db.scheduling, db.sessions, async () => {
    await db.events.add(ev)
    await recomputeScheduling([pres.cardId])
    await db.sessions.update(s.id, counters(s))
  })
}

/**
 * Annule la dernière réponse. L'historique n'est jamais modifié : un événement « undo » est ajouté, et les
 * statistiques comme l'étape de la carte l'ignorent. Retourne l'identifiant de la carte à revoir.
 */
export async function undoLast(s: LiveSession): Promise<string | null> {
  const pres = s.logic.undo()
  if (!pres) return null
  const eventId = s.eventIds.pop() ?? null
  if (eventId) {
    const ev: ReviewEvent = {
      id: uuid(), cardId: pres.cardId, deviceId: await deviceId(), sessionId: s.id, at: now(), correct: true,
      kind: 'undo', mode: s.mode, undoes: eventId,
    }
    await db.transaction('rw', db.events, db.scheduling, db.sessions, async () => {
      await db.events.add(ev)
      await recomputeScheduling([pres.cardId])
      await db.sessions.update(s.id, counters(s))
    })
  }
  return pres.cardId
}

export async function endSession(s: LiveSession): Promise<{ session?: Session; archived: string[] }> {
  await db.sessions.update(s.id, { endedAt: now(), ...counters(s) })
  // Une matière dont toutes les cartes ont terminé les 6 étapes passe en archive
  const evs = await db.events.where('sessionId').equals(s.id).toArray()
  const cards = new Map((await db.cards.toArray()).map((c) => [c.id, c]))
  const folders = new Map((await listFolders()).map((f) => [f.id, f]))
  const roots = new Set<string>()
  for (const e of evs) {
    const c = cards.get(e.cardId)
    const r = c ? rootOf(c.folderId, folders) : undefined
    if (r) roots.add(r.id)
  }
  const archived = await autoArchive([...roots])
  return { session: await db.sessions.get(s.id), archived }
}
