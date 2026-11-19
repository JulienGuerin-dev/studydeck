import { db, deviceId, now, uuid } from '../db/db'
import type { Card, ReviewEvent, Session } from '../db/types'
import { descendantIds, folderPath, listFolders } from '../domain/folders'
import { recomputeScheduling } from './scheduling'
import { ReviewSession } from './session'

export type ScopeId = string | null // null = toute la bibliothèque

export async function cardsInScope(scope: ScopeId): Promise<Card[]> {
  const cards = (await db.cards.toArray()).filter((c) => c.deletedAt === null)
  if (scope === null) return cards
  const ids = new Set(await descendantIds(scope))
  return cards.filter((c) => ids.has(c.folderId))
}

/** Cartes « à réviser » : déjà planifiées et échues, ou jamais révisées. */
export async function dueCardsInScope(scope: ScopeId, at = now()): Promise<Card[]> {
  const cards = await cardsInScope(scope)
  const sched = new Map((await db.scheduling.toArray()).map((s) => [s.cardId, s]))
  return cards.filter((c) => {
    const s = sched.get(c.id)
    return !s || s.nextReviewAt <= at
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
}

/** Crée la session et l'enregistre immédiatement (récupération possible en cas de fermeture brutale). */
export async function startSession(scope: ScopeId, mode: 'due' | 'free', cardIds: string[]): Promise<LiveSession> {
  const logic = new ReviewSession(cardIds)
  const id = uuid()
  const startedAt = now()
  const rec: Session = {
    id, startedAt, endedAt: null, scopeFolderId: scope, scopeLabel: await scopeLabel(scope), mode,
    selected: logic.selected, correct: 0, incorrect: 0, attempts: 0, deviceId: await deviceId(),
  }
  await db.sessions.add(rec)
  return { id, logic, mode, startedAt }
}

/**
 * Enregistre une réponse : l'événement est écrit en base AVANT de passer à la carte suivante,
 * et la planification SM-2 de la carte est recalculée.
 */
export async function answerCard(s: LiveSession, correct: boolean): Promise<void> {
  const pres = s.logic.answer(correct)
  const ev: ReviewEvent = {
    id: uuid(), cardId: pres.cardId, deviceId: await deviceId(), sessionId: s.id, at: now(), correct, kind: pres.kind, mode: s.mode,
  }
  await db.transaction('rw', db.events, db.scheduling, db.sessions, async () => {
    await db.events.add(ev)
    await recomputeScheduling([pres.cardId])
    await db.sessions.update(s.id, {
      correct: s.logic.correct, incorrect: s.logic.incorrect, attempts: s.logic.attempts,
    })
  })
}

export async function endSession(s: LiveSession): Promise<Session | undefined> {
  await db.sessions.update(s.id, {
    endedAt: now(), correct: s.logic.correct, incorrect: s.logic.incorrect, attempts: s.logic.attempts,
  })
  return db.sessions.get(s.id)
}
