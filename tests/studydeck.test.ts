import { beforeEach, describe, expect, it } from 'vitest'
import { newDevice } from './helpers'
import { db } from '../src/db/db'
import { sha256Hex } from '../src/db/hash'
import { createCard, createFolder, listCards, listFolders } from '../src/domain/folders'
import { exportStudyDeck, flattenDraft, importDraft, parseStudyDeck, removeDraftCard, editDraftCard } from '../src/exchange/studydeck'
import { createBackup, restoreBackup, verifyBackup } from '../src/exchange/backup'
import { makeZip } from '../src/exchange/zip'
import { storeBlob } from '../src/domain/media'
import { answerCard, startSession } from '../src/review/service'

const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o))
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4])

const deck = {
  format: 'studydeck', version: 1, name: 'Cours',
  folders: [{
    name: 'Analyse', cards: [{ front: 'Dérivée ?', back: '$f\'(x)=\\lim_{h\\to0}\\frac{f(x+h)-f(x)}{h}$' }],
    folders: [{ name: 'Suites', cards: [{ front: 'Suite ?', back: '![schéma](media/schema.png)' }] }],
  }],
  cards: [{ front: 'Carte racine', back: 'Réponse' }],
}

beforeEach(async () => { await newDevice('PC') })

describe('Import .studydeck', () => {
  it('accepte un JSON simple et un ZIP avec images, et conserve la hiérarchie', async () => {
    const r = await parseStudyDeck(makeZip({ 'deck.json': JSON.stringify(deck), 'media/schema.png': PNG }))
    expect(r.ok).toBe(true)
    expect(flattenDraft(r.draft!).length).toBe(3)
    const hash = await sha256Hex(PNG)
    expect(flattenDraft(r.draft!).some((x) => x.card.back.includes(`media:${hash}`))).toBe(true)

    const parent = await createFolder('Mathématiques', null)
    const res = await importDraft(r.draft!, { parentId: parent.id, keepHierarchy: true })
    expect(res.cards).toBe(3)
    const folders = await listFolders()
    expect(folders.map((f) => f.name).sort()).toEqual(['Analyse', 'Mathématiques', 'Suites'].sort())
    expect(folders.find((f) => f.name === 'Suites')!.parentId).toBe(folders.find((f) => f.name === 'Analyse')!.id)
    expect(await db.blobs.get(hash)).toBeTruthy() // image conservée

    const simple = await parseStudyDeck(enc({ format: 'studydeck', version: 1, cards: [{ front: 'a', back: 'b' }] }))
    expect(simple.ok).toBe(true)
  })
  it('crée un nouveau dossier à l\'import et sait aplatir la hiérarchie', async () => {
    const r = await parseStudyDeck(makeZip({ 'deck.json': JSON.stringify(deck), 'media/schema.png': PNG }))
    const res = await importDraft(r.draft!, { parentId: null, newFolderName: 'Import plat', keepHierarchy: false })
    expect(res.folders).toBe(1)
    const root = (await listFolders())[0]
    expect((await listCards()).every((c) => c.folderId === root.id)).toBe(true)
    expect((await listCards()).length).toBe(3)
  })
  it('permet de modifier ou retirer des cartes avant validation', async () => {
    const r = await parseStudyDeck(makeZip({ 'deck.json': JSON.stringify(deck), 'media/schema.png': PNG }))
    const d = r.draft!
    const all = flattenDraft(d)
    removeDraftCard(d, all[0].card.tempId)
    editDraftCard(d, all[1].card.tempId, 'Recto modifié', 'Verso modifié')
    await importDraft(d, { parentId: null, newFolderName: 'X', keepHierarchy: true })
    const cards = await listCards()
    expect(cards.length).toBe(2)
    expect(cards.some((c) => c.front === 'Recto modifié')).toBe(true)
  })
  it('signale clairement les erreurs', async () => {
    const bad = async (o: unknown) => (await parseStudyDeck(enc(o)))
    expect((await parseStudyDeck(new Uint8Array([1, 2, 3, 255, 254]))).errors[0]).toMatch(/illisible/)
    expect((await bad({ format: 'autre', version: 1 })).errors[0]).toMatch(/format/)
    expect((await bad({ format: 'studydeck', version: 9, cards: [] })).errors[0]).toMatch(/Version/)
    expect((await bad({ format: 'studydeck', version: 1, cards: [{ front: 'a' }] })).errors.join()).toMatch(/verso/)
    expect((await bad({ format: 'studydeck', version: 1, folders: [{ cards: [] }] })).errors.join()).toMatch(/name/)
    expect((await bad({ format: 'studydeck', version: 1 })).errors.join()).toMatch(/aucune carte/)
    const missing = await parseStudyDeck(makeZip({ 'deck.json': JSON.stringify(deck) }))
    expect(missing.ok).toBe(false)
    expect(missing.errors.join()).toMatch(/schema\.png/)
    expect((await parseStudyDeck(makeZip({ 'x.txt': 'a' }))).errors[0]).toMatch(/deck\.json/)
  })
  it('exporte puis réimporte sans perte (formules, images, hiérarchie)', async () => {
    const parent = await createFolder('Physique', null)
    const sub = await createFolder('Optique', parent.id)
    const hash = await storeBlob(PNG, 'image/png')
    await createCard(sub.id, 'Loi de Snell ?', `$n_1\\sin\\theta_1=n_2\\sin\\theta_2$ ![](media:${hash})`)
    const { bytes, cards } = await exportStudyDeck(parent.id)
    expect(cards).toBe(1)
    const r = await parseStudyDeck(bytes)
    expect(r.ok).toBe(true)
    await newDevice('Autre')
    const res = await importDraft(r.draft!, { parentId: null, keepHierarchy: true })
    expect(res.cards).toBe(1)
    const c = (await listCards())[0]
    expect(c.back).toContain(`media:${hash}`)
    expect(c.back).toContain('\\sin')
    expect(await db.blobs.get(hash)).toBeTruthy()
    expect((await listFolders()).map((f) => f.name).sort()).toEqual(['Optique', 'Physique'])
  })
})

describe('Sauvegarde et restauration', () => {
  it('restaure intégralement bibliothèque, images, historique et planification', async () => {
    const f = await createFolder('Maths', null)
    const hash = await storeBlob(PNG, 'image/png')
    const c = await createCard(f.id, 'Q', `R ![](media:${hash})`)
    const s = await startSession(null, 'due', [c.id])
    await answerCard(s, true)
    const { bytes, counts } = await createBackup()
    expect(counts).toMatchObject({ folders: 1, cards: 1, events: 1, blobs: 1 })

    const v = await verifyBackup(bytes)
    expect(v.ok).toBe(true)

    await newDevice('Neuf')
    await createFolder('Sera effacé', null)
    await restoreBackup(v)
    expect((await listFolders()).map((x) => x.name)).toEqual(['Maths'])
    expect(await db.events.count()).toBe(1)
    expect(await db.blobs.get(hash)).toBeTruthy()
    expect(await db.scheduling.get(c.id)).toBeTruthy() // recalculée
  })
  it('refuse une sauvegarde corrompue ou modifiée', async () => {
    const f = await createFolder('Maths', null)
    await createCard(f.id, 'Q', 'R')
    const { bytes } = await createBackup()
    const corrupted = new Uint8Array(bytes)
    for (let i = 40; i < 60; i++) corrupted[i] ^= 0xff
    expect((await verifyBackup(corrupted)).ok).toBe(false)
    expect((await verifyBackup(new Uint8Array([1, 2, 3]))).ok).toBe(false)
    // modification volontaire du contenu avec manifeste inchangé
    const { readZip, strFromU8 } = await import('../src/exchange/zip')
    const z = readZip(bytes)
    const tampered = strFromU8(z['backup.json']).replace('"Q"', '"Piraté"')
    const v = await verifyBackup(makeZip({ 'backup.json': tampered, 'manifest.json': strFromU8(z['manifest.json']) }))
    expect(v.ok).toBe(false)
    expect(v.errors.join()).toMatch(/somme de contrôle/)
    await expect(restoreBackup(v)).rejects.toThrow()
    expect((await listCards()).length).toBe(1) // base intacte
  })
})
