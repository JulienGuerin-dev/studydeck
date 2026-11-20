// Apprentissage par étapes (remplace SM-2).
//
// Étapes d'une carte : 1 (création, 1re révision) → 2 → 3 → 4 → 5 → 6 → terminée.
// Délai AVANT la révision d'une étape, compté depuis la dernière révision réussie :
//   étape 2 : 2 jours · étape 3 : 4 jours · étape 4 : 7 jours · étape 5 : 14 jours · étape 6 : 30 jours.
// Règles (appliquées à la PREMIÈRE présentation d'une carte dans une session, et seulement si la carte était due) :
//   - réussite  → étape suivante (réussir l'étape 6 = carte terminée) ; le retard n'est jamais pénalisé ;
//   - échec     → la carte reste à la même étape (elle reviendra après le délai de cette étape) ;
//   - 2e échec consécutif à la même étape → la carte descend d'une étape (jamais sous l'étape 1).
// Une révision faite avant l'échéance (révision libre) est enregistrée mais ne change pas l'étape.
// L'état est TOUJOURS recalculé en rejouant l'historique : fusion de synchronisation sans conflit, et les délais
// peuvent être réglés plus tard sans rien perdre.

import type { ReviewEvent, Scheduling } from '../db/types'

export const DAY = 86_400_000
export const LEVELS = 6
export const DELAY_DAYS: Record<number, number> = { 1: 0, 2: 2, 3: 4, 4: 7, 5: 14, 6: 30 }
export const NEVER = Number.MAX_SAFE_INTEGER

export function startOfDay(t: number): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Retire les événements annulés et les événements d'annulation eux-mêmes. */
export function effectiveEvents(events: ReviewEvent[]): ReviewEvent[] {
  const undone = new Set(events.filter((e) => e.kind === 'undo' && e.undoes).map((e) => e.undoes!))
  return events.filter((e) => e.kind !== 'undo' && !undone.has(e.id))
}

export interface CardState {
  level: number
  graduated: boolean
  failStreak: number
  nextReviewAt: number
  lastReviewAt: number | null
  reviews: number
}

export const INITIAL: CardState = { level: 1, graduated: false, failStreak: 0, nextReviewAt: 0, lastReviewAt: null, reviews: 0 }

export interface Transition {
  eventId: string
  at: number
  levelBefore: number
  levelAfter: number
  correct: boolean
  eligible: boolean // la carte était due : la réponse a compté pour la progression
  lateDays: number
}

const clampLevel = (n: number) => Math.min(LEVELS, Math.max(1, Math.round(n)))
const byTime = (a: ReviewEvent, b: ReviewEvent) => a.at - b.at || a.id.localeCompare(b.id)

export function step(s: CardState, e: ReviewEvent): { state: CardState; transition?: Transition } {
  if (e.kind === 'set-level') {
    return { state: { ...s, level: clampLevel(e.level ?? 1), graduated: false, failStreak: 0, nextReviewAt: e.at } }
  }
  if (e.kind !== 'first') return { state: s }
  const eligible = !s.graduated && e.at >= s.nextReviewAt
  const tr: Transition = {
    eventId: e.id, at: e.at, levelBefore: s.level, levelAfter: s.level, correct: e.correct, eligible,
    lateDays: eligible && s.nextReviewAt > 0 ? Math.max(0, (e.at - s.nextReviewAt) / DAY) : 0,
  }
  if (!eligible) return { state: { ...s, lastReviewAt: e.at }, transition: tr }
  const day = startOfDay(e.at)
  let next: CardState
  if (e.correct) {
    if (s.level >= LEVELS) next = { ...s, graduated: true, failStreak: 0, nextReviewAt: NEVER, lastReviewAt: e.at, reviews: s.reviews + 1 }
    else {
      const level = s.level + 1
      next = { level, graduated: false, failStreak: 0, nextReviewAt: day + DELAY_DAYS[level] * DAY, lastReviewAt: e.at, reviews: s.reviews + 1 }
    }
  } else if (s.failStreak === 0) {
    next = { ...s, failStreak: 1, nextReviewAt: day + DELAY_DAYS[s.level] * DAY, lastReviewAt: e.at, reviews: s.reviews + 1 }
  } else {
    const level = Math.max(1, s.level - 1)
    next = { level, graduated: false, failStreak: 0, nextReviewAt: day + DELAY_DAYS[level] * DAY, lastReviewAt: e.at, reviews: s.reviews + 1 }
  }
  tr.levelAfter = next.level
  return { state: next, transition: tr }
}

export function replayCard(events: ReviewEvent[]): { state: CardState; transitions: Transition[]; touched: boolean } {
  let state = INITIAL
  const transitions: Transition[] = []
  let touched = false
  for (const e of effectiveEvents(events).sort(byTime)) {
    if (e.kind === 'first' || e.kind === 'set-level') touched = true
    const r = step(state, e)
    state = r.state
    if (r.transition) transitions.push(r.transition)
  }
  return { state, transitions, touched }
}

/** Planification d'une carte ; null si elle n'a jamais été révisée (donc à faire dès maintenant, étape 1). */
export function replaySchedule(cardId: string, events: ReviewEvent[]): Scheduling | null {
  const { state, touched } = replayCard(events.filter((e) => e.cardId === cardId))
  if (!touched) return null
  return { cardId, ...state }
}

export const levelDelayLabel = (level: number): string => {
  const d = DELAY_DAYS[level]
  return d === 0 ? 'immédiate' : d === 30 ? '1 mois' : d === 14 ? '2 semaines' : d === 7 ? '1 semaine' : `${d} jours`
}

export const levelName = (level: number): string =>
  level === 1 ? 'Étape 1 · création, 1re révision' : `Étape ${level} · ${levelDelayLabel(level)} après l'étape ${level - 1}`
