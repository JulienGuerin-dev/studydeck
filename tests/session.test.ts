import { describe, expect, it } from 'vitest'
import { ReviewSession } from '../src/review/session'

describe('Session de révision', () => {
  it('reproduit l\'exemple du cahier des charges (A✓ B✗ C✓ D✗ E✓ puis B✓ D✗ puis D✓)', () => {
    const s = new ReviewSession(['A', 'B', 'C', 'D', 'E'], () => 0.5)
    const plan: Record<string, boolean[]> = { A: [true], B: [false, true], C: [true], D: [false, false, true], E: [true] }
    const seen: string[] = []
    const kinds: string[] = []
    while (!s.finished) {
      const cur = s.current()!
      seen.push(cur.cardId)
      kinds.push(cur.kind)
      s.answer(plan[cur.cardId].shift()!)
    }
    // Les 5 premières présentations sont des « first », les suivantes des « retry »
    expect(kinds.slice(0, 5).every((k) => k === 'first')).toBe(true)
    expect(kinds.slice(5).every((k) => k === 'retry')).toBe(true)
    const retries = seen.slice(5)
    expect(new Set(retries)).toEqual(new Set(['B', 'D']))
    expect(retries.filter((c) => c === 'D').length).toBe(2)
    expect(s.attempts).toBe(8)
    expect(s.correct).toBe(5)
    expect(s.incorrect).toBe(3)
    expect(s.completed).toBe(5)
    expect(s.selected).toBe(5)
  })
  it('chaque carte est présentée une fois avant toute répétition', () => {
    const s = new ReviewSession(['1', '2', '3', '4'])
    const firsts = new Set<string>()
    for (let i = 0; i < 4; i++) {
      const cur = s.current()!
      expect(cur.kind).toBe('first')
      firsts.add(cur.cardId)
      s.answer(false) // tout est faux
    }
    expect(firsts.size).toBe(4)
    expect(s.current()!.kind).toBe('retry')
  })
  it('l\'ordre est aléatoire (mélange effectif) et sans doublon', () => {
    const ids = Array.from({ length: 30 }, (_, i) => String(i))
    const a = new ReviewSession(ids)
    const order: string[] = []
    while (!a.finished) { order.push(a.current()!.cardId); a.answer(true) }
    expect(new Set(order).size).toBe(30)
    expect(order.join(',')).not.toBe(ids.join(','))
  })
  it('dédoublonne les identifiants et refuse de répondre une fois terminée', () => {
    const s = new ReviewSession(['x', 'x'])
    expect(s.selected).toBe(1)
    s.answer(true)
    expect(s.finished).toBe(true)
    expect(() => s.answer(true)).toThrow()
  })
})
