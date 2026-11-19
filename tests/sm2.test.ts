import { describe, expect, it } from 'vitest'
import { DAY, INITIAL_STATE, replaySchedule, sm2Step, startOfDay } from '../src/review/sm2'
import type { ReviewEvent } from '../src/db/types'

const ev = (id: string, at: number, correct: boolean, kind: 'first' | 'retry' = 'first'): ReviewEvent =>
  ({ id, cardId: 'c', deviceId: 'd', sessionId: 's', at, correct, kind, mode: 'due' })

describe('SM-2', () => {
  it('suit la progression 1 jour, 6 jours, puis interval × EF', () => {
    let s = sm2Step(INITIAL_STATE, true)
    expect([s.reps, s.interval]).toEqual([1, 1])
    s = sm2Step(s, true)
    expect([s.reps, s.interval]).toEqual([2, 6])
    s = sm2Step(s, true)
    expect(s.interval).toBe(15) // 6 × 2.5
    s = sm2Step(s, true)
    expect(s.interval).toBe(38) // 15 × 2.5 = 37.5 → 38
  })
  it('un échec remet à zéro les répétitions, réduit le facteur de facilité et ramène l\'intervalle à 1 jour', () => {
    let s = sm2Step(sm2Step(sm2Step(INITIAL_STATE, true), true), true)
    s = sm2Step(s, false)
    expect(s.reps).toBe(0)
    expect(s.interval).toBe(1)
    expect(s.ef).toBeCloseTo(1.96, 2)
  })
  it('le facteur de facilité ne descend jamais sous 1,3', () => {
    let s = INITIAL_STATE
    for (let i = 0; i < 20; i++) s = sm2Step(s, false)
    expect(s.ef).toBe(1.3)
  })
  it('replaySchedule ignore les répétitions immédiates et est indépendant de l\'ordre des événements', () => {
    const t0 = new Date(2026, 0, 1, 18, 0).getTime()
    const events = [
      ev('a', t0, false), ev('b', t0 + 1000, true, 'retry'),
      ev('c', t0 + 2 * DAY, true), ev('d', t0 + 9 * DAY, true),
    ]
    const s1 = replaySchedule('c', events)!
    const s2 = replaySchedule('c', [...events].reverse())!
    expect(s1).toEqual(s2)
    expect(s1.firstCount).toBe(3)
    expect(s1.reps).toBe(2)
    expect(s1.interval).toBe(6)
    expect(s1.nextReviewAt).toBe(startOfDay(t0 + 9 * DAY) + 6 * DAY)
  })
  it('retourne null sans événement « first »', () => {
    expect(replaySchedule('c', [ev('x', 1, true, 'retry')])).toBeNull()
  })
})
