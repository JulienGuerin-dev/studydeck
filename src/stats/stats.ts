import type { Card, Folder, ReviewEvent, Scheduling } from '../db/types'
import { DAY } from '../review/sm2'

/** Règles de classement (documentées dans docs/GUIDE_UTILISATION.md). */
export const MASTERY_MIN_STREAK = 3 // 3 dernières présentations « first » correctes
export const MASTERY_MIN_INTERVAL = 21 // jours
export const DIFFICULT_MIN_ATTEMPTS = 3
export const DIFFICULT_MAX_RATE = 0.6

export interface CardStats {
  cardId: string
  attempts: number // toutes les tentatives (first + retry)
  correct: number
  incorrect: number
  retries: number
  rate: number | null
  reviewed: boolean
  lastReviewAt: number | null
  nextReviewAt: number | null
  interval: number
  ef: number | null
  due: boolean
  mastered: boolean
  difficult: boolean
  results: boolean[] // résultats « first » successifs
}

export interface Agg {
  cards: number
  reviewed: number
  neverReviewed: number
  due: number
  mastered: number
  difficult: number
  attempts: number
  correct: number
  rate: number | null
}

const emptyAgg = (): Agg => ({
  cards: 0, reviewed: 0, neverReviewed: 0, due: 0, mastered: 0, difficult: 0, attempts: 0, correct: 0, rate: null,
})

export function cardStats(card: Card, events: ReviewEvent[], sched: Scheduling | undefined, at: number): CardStats {
  const evs = events.filter((e) => e.cardId === card.id).sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
  const firsts = evs.filter((e) => e.kind === 'first')
  const correct = evs.filter((e) => e.correct).length
  const attempts = evs.length
  const rate = attempts ? correct / attempts : null
  const streakOk =
    firsts.length >= MASTERY_MIN_STREAK && firsts.slice(-MASTERY_MIN_STREAK).every((e) => e.correct)
  const mastered = !!sched && streakOk && sched.interval >= MASTERY_MIN_INTERVAL
  const difficult = attempts >= DIFFICULT_MIN_ATTEMPTS && rate !== null && rate < DIFFICULT_MAX_RATE
  return {
    cardId: card.id,
    attempts,
    correct,
    incorrect: attempts - correct,
    retries: evs.filter((e) => e.kind === 'retry').length,
    rate,
    reviewed: firsts.length > 0,
    lastReviewAt: sched?.lastReviewAt ?? null,
    nextReviewAt: sched?.nextReviewAt ?? null,
    interval: sched?.interval ?? 0,
    ef: sched?.ef ?? null,
    due: !sched || sched.nextReviewAt <= at,
    mastered,
    difficult,
    results: firsts.map((e) => e.correct),
  }
}

export interface StatsBundle {
  global: Agg
  byFolder: Map<string, Agg> // cumul incluant les sous-dossiers
  cards: Map<string, CardStats>
}

/** Calcule toutes les statistiques en une passe, puis cumule le long de l'arbre des dossiers. */
export function buildStats(
  folders: Folder[], cards: Card[], events: ReviewEvent[], scheds: Scheduling[], at: number,
): StatsBundle {
  const liveFolders = folders.filter((f) => f.deletedAt === null)
  const folderIds = new Set(liveFolders.map((f) => f.id))
  const schedBy = new Map(scheds.map((s) => [s.cardId, s]))
  const evBy = new Map<string, ReviewEvent[]>()
  for (const e of events) {
    const a = evBy.get(e.cardId)
    if (a) a.push(e)
    else evBy.set(e.cardId, [e])
  }
  const own = new Map<string, Agg>()
  const cardMap = new Map<string, CardStats>()
  const global = emptyAgg()
  const add = (a: Agg, s: CardStats) => {
    a.cards++
    if (s.reviewed) a.reviewed++
    else a.neverReviewed++
    if (s.due) a.due++
    if (s.mastered) a.mastered++
    if (s.difficult) a.difficult++
    a.attempts += s.attempts
    a.correct += s.correct
  }
  for (const c of cards) {
    if (c.deletedAt !== null || !folderIds.has(c.folderId)) continue
    const s = cardStats(c, evBy.get(c.id) ?? [], schedBy.get(c.id), at)
    cardMap.set(c.id, s)
    add(global, s)
    const a = own.get(c.folderId) ?? emptyAgg()
    add(a, s)
    own.set(c.folderId, a)
  }
  const byFolder = new Map<string, Agg>()
  const children = new Map<string | null, Folder[]>()
  for (const f of liveFolders) {
    const p = f.parentId && folderIds.has(f.parentId) ? f.parentId : null
    children.set(p, [...(children.get(p) ?? []), f])
  }
  const visit = (f: Folder, depth = 0): Agg => {
    const total = { ...(own.get(f.id) ?? emptyAgg()) }
    if (depth < 200) {
      for (const ch of children.get(f.id) ?? []) {
        const c = visit(ch, depth + 1)
        total.cards += c.cards; total.reviewed += c.reviewed; total.neverReviewed += c.neverReviewed
        total.due += c.due; total.mastered += c.mastered; total.difficult += c.difficult
        total.attempts += c.attempts; total.correct += c.correct
      }
    }
    total.rate = total.attempts ? total.correct / total.attempts : null
    byFolder.set(f.id, total)
    return total
  }
  for (const root of children.get(null) ?? []) visit(root)
  global.rate = global.attempts ? global.correct / global.attempts : null
  return { global, byFolder, cards: cardMap }
}

/** Nombre de réponses par jour sur les `days` derniers jours (du plus ancien au plus récent). */
export function reviewsPerDay(events: ReviewEvent[], days: number, at: number) {
  const end = new Date(at); end.setHours(0, 0, 0, 0)
  const start = end.getTime() - (days - 1) * DAY
  const out = Array.from({ length: days }, (_, i) => ({ day: start + i * DAY, total: 0, correct: 0 }))
  for (const e of events) {
    const idx = Math.floor((new Date(e.at).setHours(0, 0, 0, 0) - start) / DAY)
    if (idx >= 0 && idx < days) {
      out[idx].total++
      if (e.correct) out[idx].correct++
    }
  }
  return out
}
