import { describe, expect, it } from 'vitest'
import { DAY, DELAY_DAYS, NEVER, effectiveEvents, replayCard, replaySchedule, startOfDay } from '../src/review/levels'
import type { ReviewEvent } from '../src/db/types'

const base = new Date(2026, 0, 1, 10, 0).getTime()
const day = (n: number, h = 0) => base + n * DAY + h * 3_600_000
let n = 0
const ev = (at: number, correct: boolean, o: Partial<ReviewEvent> = {}): ReviewEvent =>
  ({ id: `e${String(++n).padStart(4, '0')}`, cardId: 'c', deviceId: 'd', sessionId: 's', at, correct, kind: 'first', mode: 'due', ...o })
const state = (events: ReviewEvent[]) => replayCard(events).state

describe('Étapes d\'apprentissage', () => {
  it('suit les 6 étapes avec les délais 2 / 4 / 7 / 14 / 30 jours puis la carte est terminée', () => {
    const run: [number, number, number][] = [ // [jour de la révision, étape attendue ensuite, délai avant la suivante]
      [0, 2, 2], [2, 3, 4], [6, 4, 7], [13, 5, 14], [27, 6, 30],
    ]
    const events: ReviewEvent[] = []
    for (const [d, lvl, delay] of run) {
      events.push(ev(day(d), true))
      const s = state(events)
      expect(s.level).toBe(lvl)
      expect(s.nextReviewAt).toBe(startOfDay(day(d)) + delay * DAY)
      expect(DELAY_DAYS[lvl]).toBe(delay)
    }
    events.push(ev(day(57), true))
    const end = state(events)
    expect(end.graduated).toBe(true)
    expect(end.nextReviewAt).toBe(NEVER)
  })
  it('une carte neuve est à l\'étape 1 et due immédiatement (aucune planification)', () => {
    expect(replaySchedule('c', [])).toBeNull()
    expect(state([]).level).toBe(1)
  })
  it('un échec laisse la carte à la même étape, avec le même délai ; la réussite suivante la fait monter', () => {
    const s1 = state([ev(day(0), true), ev(day(2), false)])
    expect(s1.level).toBe(2)
    expect(s1.failStreak).toBe(1)
    expect(s1.nextReviewAt).toBe(startOfDay(day(2)) + 2 * DAY) // pas de retour « demain »
    const s2 = state([ev(day(0), true), ev(day(2), false), ev(day(4), true)])
    expect(s2.level).toBe(3)
    expect(s2.failStreak).toBe(0)
  })
  it('deux échecs consécutifs à la même étape font descendre d\'une étape (jamais sous 1)', () => {
    const up = [ev(day(0), true), ev(day(2), true)] // étape 3
    const s = state([...up, ev(day(6), false), ev(day(10), false)])
    expect(s.level).toBe(2)
    expect(s.failStreak).toBe(0)
    expect(state([ev(day(0), false), ev(day(1), false), ev(day(2), false)]).level).toBe(1)
  })
  it('un échec isolé est « pardonné » : échec puis réussite puis échec ne fait pas descendre', () => {
    const s = state([ev(day(0), true), ev(day(2), false), ev(day(4), true), ev(day(8), false)])
    expect(s.level).toBe(3)
    expect(s.failStreak).toBe(1)
  })
  it('le retard n\'est pas pénalisé : après 2 semaines sans réviser, une réussite fait monter d\'une seule étape', () => {
    const s = state([ev(day(0), true), ev(day(16), true)])
    expect(s.level).toBe(3)
    expect(s.nextReviewAt).toBe(startOfDay(day(16)) + 4 * DAY)
  })
  it('une révision faite avant l\'échéance (libre) est enregistrée mais ne fait pas avancer la carte', () => {
    const events = [ev(day(0), true), ev(day(1), true, { mode: 'free' })]
    const r = replayCard(events)
    expect(r.state.level).toBe(2)
    expect(r.state.nextReviewAt).toBe(startOfDay(day(0)) + 2 * DAY)
    expect(r.transitions[1].eligible).toBe(false)
  })
  it('les répétitions immédiates (retry) n\'influencent pas l\'étape', () => {
    const s = state([ev(day(0), false), ev(day(0, 1), false, { kind: 'retry' }), ev(day(0, 2), true, { kind: 'retry' })])
    expect(s.level).toBe(1)
    expect(s.failStreak).toBe(1)
  })
  it('un changement manuel d\'étape place la carte à cette étape, due tout de suite', () => {
    const s = state([ev(day(0), true), ev(day(1), true, { kind: 'set-level', level: 4 })])
    expect(s.level).toBe(4)
    expect(s.nextReviewAt).toBe(day(1))
    expect(state([ev(day(0), true, { kind: 'set-level', level: 99 })]).level).toBe(6) // borné
  })
  it('l\'annulation (undo) supprime l\'effet de la réponse sans modifier l\'historique', () => {
    const a = ev(day(0), true)
    const b = ev(day(2), false)
    const undo = ev(day(2, 1), true, { kind: 'undo', undoes: b.id })
    expect(effectiveEvents([a, b, undo]).map((e) => e.id)).toEqual([a.id])
    const s = state([a, b, undo])
    expect(s.level).toBe(2)
    expect(s.failStreak).toBe(0)
  })
  it('le résultat est identique quel que soit l\'ordre de réception des événements (fusion de synchronisation)', () => {
    const events = [ev(day(0), true), ev(day(2), false), ev(day(4), false), ev(day(8), true), ev(day(9), true, { kind: 'retry' })]
    const ref = replaySchedule('c', events)
    for (let i = 0; i < 6; i++) {
      const shuffled = [...events].sort(() => Math.random() - 0.5)
      expect(replaySchedule('c', shuffled)).toEqual(ref)
    }
  })
  it('une carte terminée ne bouge plus', () => {
    const events = [0, 2, 6, 13, 27, 57].map((d) => ev(day(d), true))
    events.push(ev(day(100), false))
    expect(state(events).graduated).toBe(true)
  })
})
