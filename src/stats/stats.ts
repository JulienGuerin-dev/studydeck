import type { Card, Folder, ReviewEvent, Scheduling, SubjectKind } from '../db/types'
import { kindOf, rootOf } from '../domain/subjects'
import { DAY, DELAY_DAYS, LEVELS, effectiveEvents, replayCard } from '../review/levels'

/** Règles de classement (documentées dans docs/GUIDE_UTILISATION.md). */
export const DIFFICULT_MIN_ATTEMPTS = 3
export const DIFFICULT_MAX_RATE = 0.6

export interface CardStats {
  cardId: string
  kind: SubjectKind
  attempts: number // toutes les tentatives (première présentation + répétitions immédiates)
  correct: number
  incorrect: number
  retries: number
  rate: number | null
  reviewed: boolean
  lastReviewAt: number | null
  nextReviewAt: number | null
  level: number // étape courante (1 à 6)
  graduated: boolean
  due: boolean
  mastered: boolean // 6 étapes réussies, ou carte d'une matière archivée
  difficult: boolean
  results: boolean[] // résultats des premières présentations
}

export interface Agg {
  cards: number
  learning: number // cartes en matières « apprentissage »
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
  cards: 0, learning: 0, reviewed: 0, neverReviewed: 0, due: 0, mastered: 0, difficult: 0, attempts: 0, correct: 0, rate: null,
})

const answers = (events: ReviewEvent[]) => effectiveEvents(events).filter((e) => e.kind === 'first' || e.kind === 'retry')

export function cardStats(card: Card, events: ReviewEvent[], sched: Scheduling | undefined, at: number, kind: SubjectKind = 'learning'): CardStats {
  const evs = answers(events.filter((e) => e.cardId === card.id)).sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
  const firsts = evs.filter((e) => e.kind === 'first')
  const correct = evs.filter((e) => e.correct).length
  const attempts = evs.length
  const rate = attempts ? correct / attempts : null
  const learning = kind === 'learning'
  const graduated = sched?.graduated ?? false
  return {
    cardId: card.id,
    kind,
    attempts,
    correct,
    incorrect: attempts - correct,
    retries: evs.filter((e) => e.kind === 'retry').length,
    rate,
    reviewed: firsts.length > 0,
    lastReviewAt: sched?.lastReviewAt ?? null,
    nextReviewAt: sched && !sched.graduated ? sched.nextReviewAt : null,
    level: sched?.level ?? 1,
    graduated,
    due: learning && !graduated && (!sched || sched.nextReviewAt <= at),
    mastered: kind === 'archive' || (learning && graduated),
    difficult: learning && attempts >= DIFFICULT_MIN_ATTEMPTS && rate !== null && rate < DIFFICULT_MAX_RATE,
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
  const byId = new Map(liveFolders.map((f) => [f.id, f]))
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
    if (s.kind === 'learning') a.learning++
    if (s.reviewed) a.reviewed++
    else a.neverReviewed++
    if (s.due) a.due++
    if (s.mastered) a.mastered++
    if (s.difficult) a.difficult++
    a.attempts += s.attempts
    a.correct += s.correct
  }
  for (const c of cards) {
    if (c.deletedAt !== null || !byId.has(c.folderId)) continue
    const kind = kindOf(rootOf(c.folderId, byId))
    const s = cardStats(c, evBy.get(c.id) ?? [], schedBy.get(c.id), at, kind)
    cardMap.set(c.id, s)
    add(global, s)
    const a = own.get(c.folderId) ?? emptyAgg()
    add(a, s)
    own.set(c.folderId, a)
  }
  const byFolder = new Map<string, Agg>()
  const children = new Map<string | null, Folder[]>()
  for (const f of liveFolders) {
    const p = f.parentId && byId.has(f.parentId) ? f.parentId : null
    children.set(p, [...(children.get(p) ?? []), f])
  }
  const visit = (f: Folder, depth = 0): Agg => {
    const total = { ...(own.get(f.id) ?? emptyAgg()) }
    if (depth < 200) {
      for (const ch of children.get(f.id) ?? []) {
        const c = visit(ch, depth + 1)
        total.cards += c.cards; total.learning += c.learning; total.reviewed += c.reviewed; total.neverReviewed += c.neverReviewed
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

/* ---------------------- Statistiques par étape de mémorisation ---------------------- */

export type Verdict = 'insufficient' | 'too-long' | 'ok' | 'could-extend'

export interface LevelRow {
  level: number
  delayDays: number
  attempts: number // révisions de cette étape ayant compté
  successes: number
  failures: number
  rate: number | null
  avgTries: number | null // nombre moyen d'essais nécessaires pour réussir cette étape
  avgLateDays: number | null // retard moyen par rapport à l'échéance
  cardsHere: number
  verdict: Verdict
}

export const VERDICT_MIN_ATTEMPTS = 15
export const VERDICT_TOO_LONG_BELOW = 0.75
export const VERDICT_EXTEND_ABOVE = 0.92

export interface LevelStats { rows: LevelRow[]; graduated: number; totalLearning: number }

/** Statistiques par étape, sur les cartes des matières en apprentissage (la planification est rejouée depuis l'historique). */
export function levelStats(folders: Folder[], cards: Card[], events: ReviewEvent[]): LevelStats {
  const byId = new Map(folders.filter((f) => f.deletedAt === null).map((f) => [f.id, f]))
  const evBy = new Map<string, ReviewEvent[]>()
  for (const e of events) evBy.set(e.cardId, [...(evBy.get(e.cardId) ?? []), e])

  const rows = Array.from({ length: LEVELS }, (_, i) => ({
    level: i + 1, attempts: 0, successes: 0, tries: [] as number[], late: [] as number[], cardsHere: 0,
  }))
  let graduated = 0
  let total = 0
  for (const c of cards) {
    if (c.deletedAt !== null || !byId.has(c.folderId)) continue
    if (kindOf(rootOf(c.folderId, byId)) !== 'learning') continue
    total++
    const { state, transitions } = replayCard(evBy.get(c.id) ?? [])
    if (state.graduated) graduated++
    else rows[state.level - 1].cardsHere++
    let tries = 0
    let lvl = 1
    for (const t of transitions) {
      if (!t.eligible) continue
      const r = rows[t.levelBefore - 1]
      if (t.levelBefore !== lvl) { tries = 0; lvl = t.levelBefore }
      r.attempts++
      tries++
      if (t.lateDays > 0 || t.levelBefore > 1) r.late.push(t.lateDays)
      if (t.correct) { r.successes++; r.tries.push(tries); tries = 0 }
      else if (t.levelAfter < t.levelBefore) tries = 0
    }
  }
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null)
  return {
    graduated, totalLearning: total,
    rows: rows.map((r): LevelRow => {
      const rate = r.attempts ? r.successes / r.attempts : null
      const verdict: Verdict = r.attempts < VERDICT_MIN_ATTEMPTS || rate === null ? 'insufficient'
        : rate < VERDICT_TOO_LONG_BELOW ? 'too-long' : rate > VERDICT_EXTEND_ABOVE ? 'could-extend' : 'ok'
      return {
        level: r.level, delayDays: DELAY_DAYS[r.level], attempts: r.attempts, successes: r.successes, failures: r.attempts - r.successes,
        rate, avgTries: mean(r.tries), avgLateDays: mean(r.late), cardsHere: r.cardsHere, verdict,
      }
    }),
  }
}

/** Nombre de réponses par jour sur les `days` derniers jours (du plus ancien au plus récent). */
export function reviewsPerDay(events: ReviewEvent[], days: number, at: number) {
  const end = new Date(at); end.setHours(0, 0, 0, 0)
  const start = end.getTime() - (days - 1) * DAY
  const out = Array.from({ length: days }, (_, i) => ({ day: start + i * DAY, total: 0, correct: 0 }))
  for (const e of answers(events)) {
    const idx = Math.floor((new Date(e.at).setHours(0, 0, 0, 0) - start) / DAY)
    if (idx >= 0 && idx < days) {
      out[idx].total++
      if (e.correct) out[idx].correct++
    }
  }
  return out
}
