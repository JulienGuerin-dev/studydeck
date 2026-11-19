import { beforeEach, describe, expect, it } from 'vitest'
import { as, newDevice } from './helpers'
import type { StudyDB } from '../src/db/db'
import { db, deviceId } from '../src/db/db'
import { createCard, createFolder, deleteCard, deleteFolder, listCards, listFolders, moveFolder, updateCard } from '../src/domain/folders'
import { applyImport, decide, exportSyncFile, planImport, purgeTombstones, readSyncFile, recoverConflict, type SyncPlan } from '../src/sync/engine'
import { answerCard, startSession } from '../src/review/service'
import { storeBlob } from '../src/domain/media'
import { checkIntegrity } from '../src/domain/integrity'
import { makeZip, readZip, strFromU8 } from '../src/exchange/zip'

let pc: StudyDB
let phone: StudyDB

/** Transfère le fichier de `from` vers `to` ; résout les conflits selon `choose`. */
async function send(from: StudyDB, to: StudyDB, choose: 'local' | 'remote' = 'remote') {
  const file = await as(from, () => exportSyncFile())
  return as(to, async () => {
    const r = await readSyncFile(file.bytes)
    if (!r.ok) throw new Error(r.errors.join())
    const plan = await planImport(r.loaded!)
    const res: Record<string, 'local' | 'remote'> = {}
    for (const it of plan.items) if (it.action === 'conflict') res[it.key] = choose
    const out = await applyImport(r.loaded!, plan, res)
    return { plan, out }
  })
}
/** Synchronisation complète par fichiers : A → B, puis B → A. */
async function fullSync(a: StudyDB, b: StudyDB, chooseOnB: 'local' | 'remote' = 'remote') {
  const first = await send(a, b, chooseOnB)
  const second = await send(b, a)
  return { first, second }
}
const front = async (d: StudyDB) => as(d, async () => (await listCards()).map((c) => c.front).sort())

beforeEach(async () => {
  pc = await newDevice('PC')
  phone = await newDevice('iPhone')
})

describe('Table de décision', () => {
  it('couvre les cas de base', () => {
    expect(decide('a', 'a', 'x', 'y')).toBe('noop')
    expect(decide('a', 'b', 'a', 'a')).toBe('takeRemote') // seul l'autre a changé
    expect(decide('b', 'a', 'a', 'a')).toBe('keepLocal') // seul moi ai changé
    expect(decide('b', 'c', 'a', 'a')).toBe('conflict') // les deux ont changé
    expect(decide('absent', 'c', 'absent', 'absent')).toBe('takeRemote') // nouveauté distante
    expect(decide('b', 'absent', 'absent', 'absent')).toBe('keepLocal') // nouveauté locale
  })
})

describe('Synchronisation bidirectionnelle', () => {
  it('transfère les nouvelles cartes et dossiers dans les deux sens', async () => {
    await as(pc, async () => { const f = await createFolder('Maths', null); await createCard(f.id, 'Carte PC', 'r') })
    await as(phone, async () => { const f = await createFolder('Histoire', null); await createCard(f.id, 'Carte iPhone', 'r') })
    const { first } = await fullSync(pc, phone)
    expect(first.plan.summary).toMatchObject({ newCards: 1, newFolders: 1, toSend: 2, conflicts: 0 })
    expect(await front(pc)).toEqual(['Carte PC', 'Carte iPhone'])
    expect(await front(phone)).toEqual(['Carte PC', 'Carte iPhone'])
    expect(await as(pc, async () => (await listFolders()).length)).toBe(2)
    // Cohérence parfaite des identifiants
    const ids = async (d: StudyDB) => as(d, async () => (await db.cards.toArray()).map((c) => c.id).sort())
    expect(await ids(pc)).toEqual(await ids(phone))
  })

  it('est idempotente : une seconde synchronisation ne change rien', async () => {
    await as(pc, async () => { const f = await createFolder('M', null); await createCard(f.id, 'a', 'b') })
    await fullSync(pc, phone)
    const again = await fullSync(pc, phone)
    expect(again.first.plan.items).toEqual([])
    expect(again.second.plan.items).toEqual([])
    expect(again.first.plan.newEvents).toEqual([])
  })

  it('propage une modification faite sur un seul appareil', async () => {
    const card = await as(pc, async () => { const f = await createFolder('M', null); return createCard(f.id, 'avant', 'v') })
    await fullSync(pc, phone)
    await as(phone, () => updateCard(card.id, { front: 'après (iPhone)' }))
    const { first, second } = await fullSync(pc, phone)
    expect(first.plan.summary.conflicts + second.plan.summary.conflicts).toBe(0)
    expect(await front(pc)).toEqual(['après (iPhone)'])
    expect(await front(phone)).toEqual(['après (iPhone)'])
  })

  it('détecte une modification simultanée, conserve les deux versions et n\'écrase rien en silence', async () => {
    const card = await as(pc, async () => { const f = await createFolder('M', null); return createCard(f.id, 'original', 'v') })
    await fullSync(pc, phone)
    await as(pc, () => updateCard(card.id, { front: 'version PC' }))
    await as(phone, () => updateCard(card.id, { front: 'version iPhone' }))

    // L'iPhone reçoit le fichier du PC : conflit signalé
    const file = await as(pc, () => exportSyncFile())
    const plan = await as(phone, async () => planImport((await readSyncFile(file.bytes)).loaded!))
    expect(plan.summary.conflicts).toBe(1)
    const c = plan.items.find((i) => i.action === 'conflict')!
    expect((c.local as { front: string }).front).toBe('version iPhone')
    expect((c.remote as { front: string }).front).toBe('version PC')
    // Appliquer sans choisir est refusé
    await expect(as(phone, async () => applyImport((await readSyncFile(file.bytes)).loaded!, plan, {}))).rejects.toThrow(/conflits/)

    // L'utilisateur garde la version iPhone
    await as(phone, async () => applyImport((await readSyncFile(file.bytes)).loaded!, plan, { [c.key]: 'local' }))
    expect(await front(phone)).toEqual(['version iPhone'])
    // La version écartée (PC) reste récupérable
    const conflicts = await as(phone, () => db.conflicts.toArray())
    expect(conflicts).toHaveLength(1)
    expect((conflicts[0].remote as { front: string }).front).toBe('version PC')

    // Retour vers le PC : il adopte le choix sans nouveau conflit, et garde sa version écartée en récupération
    const back = await send(phone, pc)
    expect(back.plan.summary.conflicts).toBe(0)
    expect(await front(pc)).toEqual(['version iPhone'])
    const pcConflicts = await as(pc, () => db.conflicts.toArray())
    expect(pcConflicts.some((x) => (x.local as { front: string }).front === 'version PC')).toBe(true)

    // Récupération manuelle de la version écartée
    await as(pc, () => recoverConflict(pcConflicts[0].id))
    expect(await front(pc)).toEqual(['version PC'])
    // … qui se propage ensuite normalement
    await fullSync(pc, phone)
    expect(await front(phone)).toEqual(['version PC'])
  })

  it('conflit résolu en faveur de l\'autre appareil : les deux finissent identiques', async () => {
    const card = await as(pc, async () => { const f = await createFolder('M', null); return createCard(f.id, 'o', 'v') })
    await fullSync(pc, phone)
    await as(pc, () => updateCard(card.id, { back: 'dos PC' }))
    await as(phone, () => updateCard(card.id, { back: 'dos iPhone' }))
    await fullSync(pc, phone, 'remote')
    const backs = async (d: StudyDB) => as(d, async () => (await listCards()).map((c) => c.back))
    expect(await backs(pc)).toEqual(await backs(phone))
    expect(await backs(pc)).toEqual(['dos PC'])
  })

  it('propage une suppression et empêche la réapparition d\'une ancienne copie', async () => {
    const card = await as(pc, async () => { const f = await createFolder('M', null); return createCard(f.id, 'à supprimer', 'v') })
    await fullSync(pc, phone)
    await as(pc, () => deleteCard(card.id))
    await fullSync(pc, phone)
    expect(await front(phone)).toEqual([])
    await fullSync(pc, phone) // l'iPhone ne ressuscite pas la carte
    expect(await front(pc)).toEqual([])
    expect(await front(phone)).toEqual([])
  })

  it('suppression d\'un côté + modification de l\'autre = conflit (jamais de suppression silencieuse)', async () => {
    const card = await as(pc, async () => { const f = await createFolder('M', null); return createCard(f.id, 'x', 'v') })
    await fullSync(pc, phone)
    await as(pc, () => deleteCard(card.id))
    await as(phone, () => updateCard(card.id, { front: 'modifiée sur iPhone' }))
    const first = await send(pc, phone, 'local') // l'utilisateur garde sa version modifiée
    expect(first.plan.summary.conflicts).toBe(1)
    await send(phone, pc)
    expect(await front(pc)).toEqual(['modifiée sur iPhone']) // la carte survit sur les deux
    expect(await front(phone)).toEqual(['modifiée sur iPhone'])
  })

  it('fusionne les historiques de révision sans double comptage et recalcule la planification', async () => {
    const card = await as(pc, async () => { const f = await createFolder('M', null); return createCard(f.id, 'q', 'r') })
    await fullSync(pc, phone)
    await as(pc, async () => { const s = await startSession(null, 'free', [card.id]); await answerCard(s, true) })
    await as(phone, async () => {
      const s = await startSession(null, 'free', [card.id])
      await answerCard(s, false) // premier essai faux
      await answerCard(s, true) // puis correct (retry)
    })
    await fullSync(pc, phone)
    await fullSync(pc, phone) // doublon volontaire
    const evCount = async (d: StudyDB) => as(d, () => db.events.count())
    expect(await evCount(pc)).toBe(3)
    expect(await evCount(phone)).toBe(3)
    const sched = async (d: StudyDB) => as(d, async () => { const s = (await db.scheduling.get(card.id))!; return [s.reps, s.interval, s.firstCount, s.ef] })
    expect(await sched(pc)).toEqual(await sched(phone)) // même calendrier sur les deux appareils
    expect((await sched(pc))[2]).toBe(2) // 2 « first » (un par appareil), la retry ne compte pas
    expect(await as(pc, () => db.sessions.count())).toBe(2)
  })

  it('transfère les images', async () => {
    const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 9, 9])
    const hash = await as(pc, async () => { const h = await storeBlob(png, 'image/png'); const f = await createFolder('M', null); await createCard(f.id, 'q', `![](media:${h})`); return h })
    await fullSync(pc, phone)
    const blob = await as(phone, () => db.blobs.get(hash))
    expect(blob?.mime).toBe('image/png')
    expect(Array.from(blob!.data)).toEqual(Array.from(png))
  })

  it('déplacements de dossiers concurrents créant un cycle : réparés sans perte', async () => {
    const [a, b] = await as(pc, async () => [await createFolder('A', null), await createFolder('B', null)])
    await as(pc, () => createCard(a.id, 'ca', 'v'))
    await as(pc, () => createCard(b.id, 'cb', 'v'))
    await fullSync(pc, phone)
    await as(pc, () => moveFolder(a.id, b.id)) // A dans B
    await as(phone, () => moveFolder(b.id, a.id)) // B dans A
    await fullSync(pc, phone, 'remote')
    await fullSync(pc, phone, 'remote')
    for (const d of [pc, phone]) {
      expect(await as(d, () => checkIntegrity())).toEqual([])
      expect(await as(d, async () => (await listCards()).length)).toBe(2)
    }
  })

  it('carte ajoutée dans un dossier supprimé ailleurs : récupérée, pas perdue', async () => {
    const f = await as(pc, () => createFolder('Dossier', null))
    await fullSync(pc, phone)
    await as(pc, () => deleteFolder(f.id))
    await as(phone, () => createCard(f.id, 'ajoutée sur iPhone', 'v'))
    await fullSync(pc, phone)
    await fullSync(pc, phone)
    expect(await front(pc)).toEqual(['ajoutée sur iPhone'])
    expect(await front(phone)).toEqual(['ajoutée sur iPhone'])
    for (const d of [pc, phone]) expect(await as(d, () => checkIntegrity())).toEqual([])
  })

  it('une interruption pendant l\'application n\'altère aucune donnée (transaction atomique)', async () => {
    await as(pc, async () => { const f = await createFolder('M', null); await createCard(f.id, 'nouvelle', 'v') })
    await as(phone, async () => { const f = await createFolder('P', null); await createCard(f.id, 'locale', 'v') })
    const file = await as(pc, () => exportSyncFile())
    await as(phone, async () => {
      const loaded = (await readSyncFile(file.bytes)).loaded!
      const plan = await planImport(loaded)
      await expect(applyImport(loaded, plan, {}, { failAfterWrites: true })).rejects.toThrow(/Interruption/)
      expect((await listCards()).map((c) => c.front)).toEqual(['locale'])
      expect(await db.bases.count()).toBe(0)
      // La reprise fonctionne ensuite normalement
      const again = await planImport(loaded)
      await applyImport(loaded, again, {})
      expect((await listCards()).length).toBe(2)
    })
  })

  it('rejette un fichier corrompu, son propre fichier, et un fichier modifié', async () => {
    await as(pc, async () => { const f = await createFolder('M', null); await createCard(f.id, 'a', 'b') })
    const file = await as(pc, () => exportSyncFile())
    const own = await as(pc, () => readSyncFile(file.bytes))
    expect(own.ok).toBe(false)
    expect(own.errors[0]).toMatch(/cet appareil/)
    const bad = new Uint8Array(file.bytes); for (let i = 30; i < 50; i++) bad[i] ^= 0xff
    expect((await as(phone, () => readSyncFile(bad))).ok).toBe(false)
    const z = readZip(file.bytes)
    const tampered = makeZip({ 'sync.json': strFromU8(z['sync.json']).replace('"a"', '"z"'), 'manifest.json': strFromU8(z['manifest.json']) })
    const t = await as(phone, () => readSyncFile(tampered))
    expect(t.ok).toBe(false)
    expect(t.errors[0]).toMatch(/corrompu/)
  })

  it('purge les tombstones seulement après confirmation par l\'autre appareil', async () => {
    const card = await as(pc, async () => { const f = await createFolder('M', null); return createCard(f.id, 'x', 'v') })
    await fullSync(pc, phone)
    await as(pc, () => deleteCard(card.id))
    expect(await as(pc, () => purgeTombstones())).toBe(0) // pas encore confirmé
    await send(pc, phone) // le téléphone applique la suppression
    expect(await as(pc, () => purgeTombstones())).toBe(0) // le PC ne le sait pas encore
    await send(phone, pc) // le PC reçoit la confirmation
    expect(await as(pc, () => purgeTombstones())).toBe(1)
    expect(await as(pc, () => db.cards.count())).toBe(0)
    // Et rien ne réapparaît ensuite
    await fullSync(pc, phone)
    expect(await front(pc)).toEqual([])
    expect(await front(phone)).toEqual([])
    void deviceId
  })

  it('après une restauration, aucune perte silencieuse : les écarts deviennent des conflits ou des ajouts', async () => {
    const card = await as(pc, async () => { const f = await createFolder('M', null); return createCard(f.id, 'v1', 'v') })
    await fullSync(pc, phone)
    await as(phone, () => updateCard(card.id, { front: 'v2 iPhone' }))
    await as(pc, async () => { await db.bases.clear() }) // équivaut à une restauration (bases effacées)
    await as(pc, () => updateCard(card.id, { front: 'v2 PC' }))
    const r = await send(phone, pc, 'local')
    expect(r.plan.summary.conflicts).toBe(1)
    expect(await front(pc)).toEqual(['v2 PC'])
  })
})
export type { SyncPlan }
