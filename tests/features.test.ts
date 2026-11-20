import { beforeEach, describe, expect, it } from 'vitest'
import { as, newDevice } from './helpers'
import { db } from '../src/db/db'
import { createCard, createFolder, deleteCard, listFolders } from '../src/domain/folders'
import { autoArchive, setCardLevel, setFolderStyle, setSubjectKind } from '../src/domain/subjects'
import { ReviewSession } from '../src/review/session'
import { answerCard, dueCardsInScope, endSession, startSession, undoLast } from '../src/review/service'
import { buildStats, levelStats } from '../src/stats/stats'
import { DAY } from '../src/review/levels'
import { applyImport, entityHash, exportSyncFile, planImport, readSyncFile } from '../src/sync/engine'

beforeEach(async () => { await newDevice('PC') })
const stats = async () => buildStats(await listFolders(), (await db.cards.toArray()).filter((c) => !c.deletedAt), await db.events.toArray(), await db.scheduling.toArray(), Date.now())

describe('Session : retour arrière, cartes sans notation, suppression', () => {
  it('undo restaure la carte, les files et les compteurs (plusieurs fois)', () => {
    const s = new ReviewSession(['A', 'B', 'C'], () => 0.5)
    const order = [s.current()!.cardId]
    s.answer(false); order.push(s.current()!.cardId)
    s.answer(true); order.push(s.current()!.cardId)
    expect(s.attempts).toBe(2)
    expect(s.undo()!.cardId).toBe(order[1])
    expect(s.current()!.cardId).toBe(order[1])
    expect(s.attempts).toBe(1)
    s.undo() // retour sur la première carte, sortie de la file de reprise
    expect(s.current()!.cardId).toBe(order[0])
    expect(s.remainingRetry).toBe(0)
    expect(s.incorrect).toBe(0)
    expect(s.undo()).toBeNull()
    expect(s.canUndo).toBe(false)
  })
  it('les cartes sans notation sont consultées une fois, sans résultat', () => {
    const s = new ReviewSession(['L', 'H'], () => 0.5, ['H'])
    while (!s.finished) { const p = s.current()!; s.answer(p.graded ? true : false) }
    expect(s.attempts).toBe(1)
    expect(s.consulted).toBe(1)
    expect(s.incorrect).toBe(0)
    expect(s.completed).toBe(2)
  })
  it('skipCurrent retire une carte supprimée sans compter de tentative', () => {
    const s = new ReviewSession(['A', 'B'], () => 0.5)
    s.skipCurrent()
    expect(s.attempts).toBe(0)
    expect(s.remainingNew).toBe(1)
  })
})

describe('Retour arrière en base', () => {
  it('annule l\'événement par un événement « undo » et restaure l\'étape de la carte', async () => {
    const f = await createFolder('M', null)
    const c = await createCard(f.id, 'q', 'r')
    const s = await startSession(null, 'due', [c.id])
    await answerCard(s, true)
    expect((await db.scheduling.get(c.id))!.level).toBe(2)
    expect(await undoLast(s)).toBe(c.id)
    expect(await db.scheduling.get(c.id)).toBeUndefined() // retour à « jamais révisée »
    expect(await db.events.count()).toBe(2) // l'historique n'est pas effacé : réponse + annulation
    await answerCard(s, false)
    expect((await db.scheduling.get(c.id))!.failStreak).toBe(1)
    const st = await stats()
    expect(st.cards.get(c.id)!.attempts).toBe(1) // la réponse annulée n'est pas comptée
    expect(st.cards.get(c.id)!.correct).toBe(0)
  })
})

describe('Types de matières : apprentissage, loisir, archive', () => {
  it('une matière « loisir » n\'est jamais due, ses cartes sont consultées sans aucun événement', async () => {
    const f = await createFolder('Cuisine', null)
    const c = await createCard(f.id, 'q', 'r')
    await setSubjectKind(f.id, 'hobbit')
    expect(await dueCardsInScope(null)).toEqual([])
    const s = await startSession(null, 'free', [c.id])
    expect(s.logic.current()!.graded).toBe(false)
    await answerCard(s, true)
    expect(await db.events.count()).toBe(0)
    const st = await stats()
    expect(st.global).toMatchObject({ cards: 1, learning: 0, due: 0, attempts: 0 })
  })
  it('loisir → apprentissage avec choix de l\'étape : toutes les cartes de la matière y sont placées', async () => {
    const f = await createFolder('Langues', null)
    const sub = await createFolder('Verbes', f.id)
    const c1 = await createCard(f.id, 'a', 'b'), c2 = await createCard(sub.id, 'c', 'd')
    await setSubjectKind(f.id, 'hobbit')
    expect(await setSubjectKind(f.id, 'learning', 3)).toBe(2)
    expect((await db.scheduling.get(c1.id))!.level).toBe(3)
    expect((await db.scheduling.get(c2.id))!.level).toBe(3)
    expect((await dueCardsInScope(null)).length).toBe(2) // due immédiatement à cette étape
  })
  it('l\'étape d\'une carte peut être corrigée à la main', async () => {
    const f = await createFolder('M', null)
    const c = await createCard(f.id, 'q', 'r')
    await setCardLevel(c.id, 5)
    expect((await db.scheduling.get(c.id))!.level).toBe(5)
    await setCardLevel(c.id, 2)
    expect((await db.scheduling.get(c.id))!.level).toBe(2)
  })
  it('une matière dont toutes les cartes ont terminé les 6 étapes passe en archive', async () => {
    const f = await createFolder('Histoire', null)
    const c1 = await createCard(f.id, 'a', 'b'), c2 = await createCard(f.id, 'c', 'd')
    await setCardLevel(c1.id, 6); await setCardLevel(c2.id, 6)
    expect(await autoArchive([f.id])).toEqual([]) // pas encore terminées
    const s = await startSession(null, 'due', [c1.id, c2.id])
    while (!s.logic.finished) await answerCard(s, true)
    const end = await endSession(s)
    expect(end.archived).toEqual(['Histoire'])
    expect((await db.folders.get(f.id))!.kind).toBe('archive')
    expect(await dueCardsInScope(null)).toEqual([])
    expect((await stats()).global.mastered).toBe(2)
  })
})

describe('Statistiques par étape', () => {
  it('compte tentatives, réussites et essais moyens par étape ; ignore les révisions anticipées', async () => {
    const f = await createFolder('M', null)
    const c = await createCard(f.id, 'q', 'r')
    const t0 = Date.now() - 40 * DAY
    const add = (i: number, d: number, ok: boolean) => db.events.add({ id: `e${i}`, cardId: c.id, deviceId: 'd', sessionId: 's', at: t0 + d * DAY, correct: ok, kind: 'first', mode: 'due' })
    await add(1, 0, false) // étape 1 : échec
    await add(2, 1, true) // étape 1 : réussite au 2e essai → étape 2
    await add(3, 1.2, true) // anticipée : ignorée
    await add(4, 4, true) // étape 2 : réussite → étape 3
    const ls = levelStats(await listFolders(), [(await db.cards.get(c.id))!], await db.events.toArray())
    expect(ls.rows[0]).toMatchObject({ level: 1, attempts: 2, successes: 1, failures: 1, avgTries: 2, delayDays: 0 })
    expect(ls.rows[1]).toMatchObject({ level: 2, attempts: 1, successes: 1, avgTries: 1, delayDays: 2 })
    expect(ls.rows[2].cardsHere).toBe(1)
    expect(ls.rows[0].verdict).toBe('insufficient') // trop peu de données
  })
})

describe('Personnalisation et synchronisation des dossiers', () => {
  it('« learning » et type absent ont la même empreinte ; emoji et couleur la modifient', async () => {
    const f = await createFolder('M', null)
    const h0 = await entityHash('folder', f)
    expect(await entityHash('folder', { ...f, kind: 'learning' })).toBe(h0)
    expect(await entityHash('folder', { ...f, kind: 'archive' })).not.toBe(h0)
    await setFolderStyle(f.id, { emoji: '🦊', color: '#7c9cff' })
    const g = (await db.folders.get(f.id))!
    expect(g.emoji).toBe('🦊')
    expect(await entityHash('folder', g)).not.toBe(h0)
    await setFolderStyle(f.id, { emoji: '', color: '' })
    expect(await entityHash('folder', (await db.folders.get(f.id))!)).toBe(h0)
  })
  it('type, emoji et étapes se synchronisent entre appareils', async () => {
    const pc = await newDevice('PC2'); const phone = await newDevice('iPhone2')
    const { f, c } = await as(pc, async () => { const f = await createFolder('Maths', null); const c = await createCard(f.id, 'q', 'r'); return { f, c } })
    const file0 = await as(pc, () => exportSyncFile())
    await as(phone, async () => { const l = (await readSyncFile(file0.bytes)).loaded!; await applyImport(l, await planImport(l), {}) })
    await as(pc, async () => { await setFolderStyle(f.id, { emoji: '🧮' }); await setSubjectKind(f.id, 'hobbit'); await setSubjectKind(f.id, 'learning', 4) })
    const file1 = await as(pc, () => exportSyncFile())
    await as(phone, async () => {
      const l = (await readSyncFile(file1.bytes)).loaded!
      const plan = await planImport(l)
      expect(plan.summary.conflicts).toBe(0)
      await applyImport(l, plan, {})
      expect((await db.folders.get(f.id))!.emoji).toBe('🧮')
      expect((await db.scheduling.get(c.id))!.level).toBe(4)
    })
  })
  it('refuse un fichier d\'une version différente (ancien modèle de données)', async () => {
    const pc = await newDevice('PC3'); const phone = await newDevice('iPhone3')
    const file = await as(pc, () => exportSyncFile())
    const { readZip, makeZip, strFromU8 } = await import('../src/exchange/zip')
    const { sha256Hex } = await import('../src/db/hash')
    const z = readZip(file.bytes)
    const old = JSON.parse(strFromU8(z['sync.json'])); delete old.schema
    const json = JSON.stringify(old)
    const bad = makeZip({ 'sync.json': json, 'manifest.json': JSON.stringify({ sha256: await sha256Hex(json) }) })
    const r = await as(phone, () => readSyncFile(bad))
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toMatch(/version différente/)
    void deleteCard
  })
})

import { ensureScheduleVersion } from '../src/review/scheduling'
describe('Migration depuis la version SM-2', () => {
  it('recalcule la planification des anciennes données depuis l\'historique, une seule fois', async () => {
    const f = await createFolder('Ancien', null)
    const c = await createCard(f.id, 'q', 'r')
    const t = Date.now() - 5 * DAY
    await db.events.bulkAdd([
      { id: 'o1', cardId: c.id, deviceId: 'd', sessionId: 's', at: t, correct: true, kind: 'first', mode: 'due' },
      { id: 'o2', cardId: c.id, deviceId: 'd', sessionId: 's', at: t + 3 * DAY, correct: true, kind: 'first', mode: 'due' },
    ])
    // ancienne ligne de planification au format SM-2
    await db.scheduling.put({ cardId: c.id, reps: 2, ef: 2.5, interval: 6, nextReviewAt: 1, lastReviewAt: 1, firstCount: 2 } as never)
    await ensureScheduleVersion()
    const s = (await db.scheduling.get(c.id))!
    expect(s.level).toBe(3)
    expect((s as unknown as { ef?: number }).ef).toBeUndefined()
    await db.scheduling.delete(c.id)
    await ensureScheduleVersion() // déjà migré : ne refait rien
    expect(await db.scheduling.get(c.id)).toBeUndefined()
  })
})
