import { describe, expect, it } from 'vitest'
import { as, newDevice } from './helpers'
import { db } from '../src/db/db'
import { createCard, createFolder, listCards, updateCard } from '../src/domain/folders'
import { applyImport, exportSyncFile, planImport, readSyncFile } from '../src/sync/engine'
import { swapResolutions } from '../src/sync/live'
import { memoryChannelPair, Wire } from '../src/sync/wire'
import { answerCard, startSession } from '../src/review/service'

describe('Wire : messages et blocs binaires', () => {
  it('transmet JSON et gros blocs (3 Mo, découpés) avec vérification', async () => {
    const [a, b] = memoryChannelPair()
    const wa = new Wire(a), wb = new Wire(b)
    const data = new Uint8Array(3_000_000).map((_, i) => (i * 7) % 256)
    wa.sendJson({ t: 'x', n: 1 })
    await wa.sendBytes(data)
    expect((await wb.nextJson('x')).n).toBe(1)
    const bytes = await wb.nextBytes()
    expect(bytes.length).toBe(data.length)
    expect(bytes[123456]).toBe(data[123456])
  })
  it('signale une coupure de connexion', async () => {
    const [a, b] = memoryChannelPair()
    const wb = new Wire(b); new Wire(a)
    const p = wb.next()
    a.close()
    await expect(p).rejects.toThrow(/interrompue/)
  })
  it('expire si l\'autre appareil ne répond pas', async () => {
    const [, b] = memoryChannelPair()
    await expect(new Wire(b).next(30)).rejects.toThrow(/Délai/)
  })
})

describe('Synchronisation simultanée : un seul décideur, résultat identique des deux côtés', () => {
  it('l\'hôte tranche un conflit ; l\'invité applique le choix inversé ; fusion complète', async () => {
    const pc = await newDevice('PC'); const phone = await newDevice('iPhone')
    const card = await as(pc, async () => { const f = await createFolder('M', null); return createCard(f.id, 'original', 'v') })
    // synchronisation initiale par fichier pour établir l'état commun
    const f0 = await as(pc, () => exportSyncFile())
    await as(phone, async () => { const l = (await readSyncFile(f0.bytes)).loaded!; await applyImport(l, await planImport(l), {}) })
    const f1 = await as(phone, () => exportSyncFile())
    await as(pc, async () => { const l = (await readSyncFile(f1.bytes)).loaded!; await applyImport(l, await planImport(l), {}) })

    await as(pc, async () => { await updateCard(card.id, { front: 'version PC' }); await createCard(card.folderId, 'nouvelle PC', 'v'); const s = await startSession(null, 'free', [card.id]); await answerCard(s, true) })
    await as(phone, async () => { await updateCard(card.id, { front: 'version iPhone' }); await createCard(card.folderId, 'nouvelle iPhone', 'v') })

    // Échange simultané des paquets (avant toute fusion)
    const pkgPc = await as(pc, () => exportSyncFile())
    const pkgPhone = await as(phone, () => exportSyncFile())
    const pcLoaded = await as(pc, async () => (await readSyncFile(pkgPhone.bytes)).loaded!)
    const phoneLoaded = await as(phone, async () => (await readSyncFile(pkgPc.bytes)).loaded!)
    const pcPlan = await as(pc, () => planImport(pcLoaded))
    const phonePlan = await as(phone, () => planImport(phoneLoaded))

    const keys = (p: typeof pcPlan) => p.items.filter((i) => i.action === 'conflict').map((i) => i.key).sort()
    expect(keys(pcPlan)).toEqual(keys(phonePlan)) // les deux côtés voient les mêmes conflits
    expect(keys(pcPlan)).toHaveLength(1)

    // L'hôte (PC) choisit la version de l'iPhone
    const res = Object.fromEntries(keys(pcPlan).map((k) => [k, 'remote' as const]))
    await as(phone, () => applyImport(phoneLoaded, phonePlan, swapResolutions(res)))
    await as(pc, () => applyImport(pcLoaded, pcPlan, res))

    const fronts = async (d: typeof pc) => as(d, async () => (await listCards()).map((c) => c.front).sort())
    expect(await fronts(pc)).toEqual(['nouvelle PC', 'nouvelle iPhone', 'version iPhone'].sort())
    expect(await fronts(phone)).toEqual(await fronts(pc))
    expect(await as(pc, () => db.events.count())).toBe(await as(phone, () => db.events.count()))
    // une seconde passe ne trouve plus rien à faire
    const phoneAfter = await as(phone, () => exportSyncFile())
    const again = await as(pc, async () => planImport((await readSyncFile(phoneAfter.bytes)).loaded!))
    expect(again.items.filter((i) => i.action !== 'keepLocal')).toEqual([])
  })
  it('swapResolutions inverse les choix', () => {
    expect(swapResolutions({ a: 'local', b: 'remote' })).toEqual({ a: 'remote', b: 'local' })
  })
})
