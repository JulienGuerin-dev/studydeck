import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import './helpers'
import { flattenDraft, parseStudyDeck } from '../src/exchange/studydeck'
import { AI_PROMPT, EXAMPLE_DECK } from '../src/exchange/aiPrompt'

describe('Fichiers d\'exemple livrés', () => {
  it('exemple.studydeck (ZIP avec image) est valide', async () => {
    const r = await parseStudyDeck(new Uint8Array(fs.readFileSync('examples/exemple.studydeck')))
    expect(r.errors).toEqual([])
    expect(flattenDraft(r.draft!).length).toBe(5)
    expect(r.draft!.media.size).toBe(1)
  })
  it('exemple.json (sans image) est valide', async () => {
    const r = await parseStudyDeck(new Uint8Array(fs.readFileSync('examples/exemple.json')))
    expect(r.ok).toBe(true)
  })
  it('l\'exemple intégré à l\'application et la consigne IA sont cohérents', async () => {
    const r = await parseStudyDeck(new TextEncoder().encode(JSON.stringify(EXAMPLE_DECK)))
    expect(r.ok).toBe(true)
    expect(AI_PROMPT).toContain('studydeck')
  })
})
