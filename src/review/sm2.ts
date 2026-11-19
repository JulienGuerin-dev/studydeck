// Algorithme SM-2 (SuperMemo 2) adapté à des réponses binaires.
// Correct → note 4, Incorrect → note 1. Détails dans docs/GUIDE_UTILISATION.md.

import type { ReviewEvent, Scheduling } from '../db/types'

export const DAY = 86_400_000
export const GRADE_CORRECT = 4
export const GRADE_INCORRECT = 1
export const MIN_EF = 1.3
export const INITIAL_EF = 2.5

export interface Sm2State {
  reps: number
  ef: number
  interval: number // jours
}

export const INITIAL_STATE: Sm2State = { reps: 0, ef: INITIAL_EF, interval: 0 }

export function sm2Step(prev: Sm2State, correct: boolean): Sm2State {
  const q = correct ? GRADE_CORRECT : GRADE_INCORRECT
  const ef = Math.max(MIN_EF, prev.ef + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
  if (!correct) return { reps: 0, ef, interval: 1 }
  const reps = prev.reps + 1
  let interval: number
  if (reps === 1) interval = 1
  else if (reps === 2) interval = 6
  else interval = Math.max(1, Math.round(prev.interval * ef))
  return { reps, ef, interval }
}

/** Minuit local du jour de `t`. Une carte revue à 18 h avec un intervalle de 1 jour est due demain matin. */
export function startOfDay(t: number): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * Recalcule la planification d'une carte en rejouant ses événements « first » dans l'ordre chronologique.
 * Fusionner deux historiques donne donc toujours le même résultat sur les deux appareils.
 */
export function replaySchedule(cardId: string, events: ReviewEvent[]): Scheduling | null {
  const firsts = events
    .filter((e) => e.cardId === cardId && e.kind === 'first')
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
  if (!firsts.length) return null
  let st = INITIAL_STATE
  for (const e of firsts) st = sm2Step(st, e.correct)
  const last = firsts[firsts.length - 1]
  return {
    cardId,
    reps: st.reps,
    ef: st.ef,
    interval: st.interval,
    lastReviewAt: last.at,
    nextReviewAt: startOfDay(last.at) + st.interval * DAY,
    firstCount: firsts.length,
  }
}
