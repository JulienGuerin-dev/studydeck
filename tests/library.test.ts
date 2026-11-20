import { beforeEach, describe, expect, it } from 'vitest'
import { newDevice } from './helpers'
import { db } from '../src/db/db'
import {
  countInside, createCard, createFolder, deleteCard, deleteFolder, descendantIds, duplicateCard, listCards, listFolders,
  moveCard, moveFolder, renameFolder, updateCard,
} from '../src/domain/folders'
import { checkIntegrity, repairIntegrity } from '../src/domain/integrity'
import { answerCard, cardsInScope, dueCardsInScope, endSession, startSession } from '../src/review/service'
import { buildStats } from '../src/stats/stats'
import { DAY, startOfDay } from '../src/review/levels'

async function buildTree() {
  const maths = await createFolder('Mathématiques', null)
  const analyse = await createFolder('Analyse', maths.id)
  const suites = await createFolder('Suites', analyse.id)
  const limites = await createFolder('Limites', analyse.id)
  const algebre = await createFolder('Algèbre', maths.id)
  const c1 = await createCard(suites.id, 'Suite de Cauchy ?', 'Définition…')
  const c2 = await createCard(limites.id, 'Limite de $1/n$ ?', '$0$')
  const c3 = await createCard(algebre.id, 'Matrice inversible ?', 'det ≠ 0')
  return { maths, analyse, suites, limites, algebre, c1, c2, c3 }
}

beforeEach(async () => { await newDevice('PC') })

describe('Dossiers et cartes', () => {
  it('gère une hiérarchie à plusieurs niveaux et les descendants', async () => {
    const t = await buildTree()
    const ids = await descendantIds(t.analyse.id)
    expect(new Set(ids)).toEqual(new Set([t.analyse.id, t.suites.id, t.limites.id]))
    expect((await cardsInScope(t.analyse.id)).map((c) => c.id).sort()).toEqual([t.c1.id, t.c2.id].sort())
    expect((await cardsInScope(null)).length).toBe(3)
  })
  it('renomme, déplace un dossier et refuse les cycles', async () => {
    const t = await buildTree()
    await renameFolder(t.suites.id, 'Suites numériques')
    expect((await db.folders.get(t.suites.id))!.name).toBe('Suites numériques')
    await expect(moveFolder(t.analyse.id, t.suites.id)).rejects.toThrow(/lui-même|sous-dossiers/)
    await expect(moveFolder(t.analyse.id, t.analyse.id)).rejects.toThrow()
    await moveFolder(t.suites.id, t.algebre.id)
    expect((await descendantIds(t.algebre.id))).toContain(t.suites.id)
    await moveFolder(t.suites.id, null) // devient une matière
    expect((await db.folders.get(t.suites.id))!.parentId).toBeNull()
  })
  it('déplace, modifie, duplique et supprime une carte en conservant son identité', async () => {
    const t = await buildTree()
    await moveCard(t.c1.id, t.algebre.id)
    await updateCard(t.c1.id, { front: 'Nouveau recto' })
    const c = (await db.cards.get(t.c1.id))!
    expect(c.id).toBe(t.c1.id)
    expect(c.folderId).toBe(t.algebre.id)
    expect(c.front).toBe('Nouveau recto')
    expect(c.back).toBe('Définition…') // le verso reste indépendant
    expect(c.rev).toBe(3)
    const copy = await duplicateCard(c.id)
    expect(copy.id).not.toBe(c.id)
    await deleteCard(c.id)
    expect((await listCards()).map((x) => x.id)).not.toContain(c.id)
    expect((await db.cards.get(c.id))!.deletedAt).not.toBeNull() // tombstone conservé
  })
  it('supprime un dossier en cascade après comptage', async () => {
    const t = await buildTree()
    expect(await countInside(t.maths.id)).toEqual({ folders: 4, cards: 3 })
    const r = await deleteFolder(t.analyse.id)
    expect(r).toEqual({ folders: 2, cards: 2 })
    expect((await listFolders()).length).toBe(2) // Mathématiques + Algèbre
    expect((await listCards()).length).toBe(1)
  })
  it('refuse un nom vide ou un parent inexistant', async () => {
    await expect(createFolder('  ', null)).rejects.toThrow()
    await expect(createFolder('x', 'inconnu')).rejects.toThrow()
    await expect(createCard('inconnu', 'a', 'b')).rejects.toThrow()
  })
  it('détecte et répare cycles, dossiers et cartes orphelins', async () => {
    const t = await buildTree()
    // Corruption volontaire
    await db.folders.put({ ...t.analyse, parentId: t.suites.id }) // cycle analyse ↔ suites
    await db.folders.put({ ...t.algebre, parentId: 'fantome' })
    await db.cards.put({ ...t.c3, folderId: 'fantome' })
    const issues = await checkIntegrity()
    expect(issues.some((i) => i.kind === 'folder-cycle')).toBe(true)
    expect(issues.some((i) => i.kind === 'folder-orphan')).toBe(true)
    expect(issues.some((i) => i.kind === 'card-orphan')).toBe(true)
    expect(await repairIntegrity()).toBeGreaterThan(0)
    expect(await checkIntegrity()).toEqual([])
    expect((await listCards()).length).toBe(3) // rien n'a été perdu
  })
})

describe('Révision, planification et statistiques', () => {
  it('enregistre les événements, planifie SM-2 et cumule les statistiques par dossier', async () => {
    const t = await buildTree()
    const s = await startSession(null, 'free', [t.c1.id, t.c2.id, t.c3.id])
    // Réponses : c1 ✓ ; c2 ✗ puis ✓ ; c3 ✓ (selon l'ordre aléatoire, on pilote par carte)
    const script: Record<string, boolean[]> = { [t.c1.id]: [true], [t.c2.id]: [false, true], [t.c3.id]: [true] }
    while (!s.logic.finished) {
      const id = s.logic.current()!.cardId
      await answerCard(s, script[id].shift()!)
    }
    const { session: rec } = await endSession(s)
    expect(rec).toMatchObject({ selected: 3, attempts: 4, correct: 3, incorrect: 1 })
    expect(rec!.endedAt).not.toBeNull()
    expect(await db.events.count()).toBe(4)
    expect((await db.events.toArray()).filter((e) => e.kind === 'retry').length).toBe(1)

    const sc1 = (await db.scheduling.get(t.c1.id))! // réussite → étape 2, prochaine révision dans 2 jours
    expect(sc1.level).toBe(2)
    expect(sc1.nextReviewAt).toBe(startOfDay(Date.now()) + 2 * DAY)
    const sc2 = (await db.scheduling.get(t.c2.id))! // premier essai faux : la reprise immédiate ne compte pas
    expect(sc2.level).toBe(1)
    expect(sc2.failStreak).toBe(1)

    const st = buildStats(await listFolders(), await listCards(), await db.events.toArray(), await db.scheduling.toArray(), Date.now())
    expect(st.global).toMatchObject({ cards: 3, reviewed: 3, attempts: 4, correct: 3 })
    const analyse = st.byFolder.get(t.analyse.id)!
    expect(analyse.cards).toBe(2) // inclut Suites et Limites
    expect(analyse.attempts).toBe(3) // c1 (1) + c2 (2)
    expect(st.byFolder.get(t.maths.id)!.cards).toBe(3)
    expect(st.byFolder.get(t.algebre.id)!.cards).toBe(1)
    expect(st.cards.get(t.c2.id)!.retries).toBe(1)
  })
  it('« à réviser » = jamais vues + échues ; une carte réussie n\'est plus due avant son échéance', async () => {
    const t = await buildTree()
    expect((await dueCardsInScope(null)).length).toBe(3)
    const s = await startSession(t.limites.id, 'due', [t.c2.id])
    await answerCard(s, true)
    expect((await dueCardsInScope(null)).map((c) => c.id)).not.toContain(t.c2.id)
    expect((await dueCardsInScope(null, Date.now() + 3 * DAY)).map((c) => c.id)).toContain(t.c2.id)
  })
  it('une carte réussie une fois n\'est pas « maîtrisée » ; les 6 étapes réussies la terminent', async () => {
    const t = await buildTree()
    const base = Date.now() - 100 * DAY
    for (const [i, d] of [0, 2, 6, 13, 27, 57].entries()) {
      await db.events.add({ id: `e${i}`, cardId: t.c1.id, deviceId: 'd', sessionId: 's', at: base + d * DAY, correct: true, kind: 'first', mode: 'due' })
    }
    const { recomputeScheduling } = await import('../src/review/scheduling')
    await recomputeScheduling([t.c1.id])
    const st = buildStats(await listFolders(), await listCards(), await db.events.toArray(), await db.scheduling.toArray(), Date.now())
    expect(st.cards.get(t.c1.id)!.mastered).toBe(true)
    expect(st.cards.get(t.c1.id)!.graduated).toBe(true)
    expect(st.cards.get(t.c1.id)!.due).toBe(false)
    expect(st.cards.get(t.c2.id)!.mastered).toBe(false)
    expect(st.byFolder.get(t.analyse.id)!.mastered).toBe(1)
  })
  it('marque une carte comme « en difficulté » sous 60 % après 3 tentatives', async () => {
    const t = await buildTree()
    const res = [false, false, true]
    for (let i = 0; i < 3; i++) {
      await db.events.add({ id: `d${i}`, cardId: t.c1.id, deviceId: 'd', sessionId: 's', at: 1000 + i, correct: res[i], kind: 'first', mode: 'due' })
    }
    const st = buildStats(await listFolders(), await listCards(), await db.events.toArray(), [], Date.now())
    expect(st.cards.get(t.c1.id)!.difficult).toBe(true)
    expect(st.byFolder.get(t.suites.id)!.difficult).toBe(1)
  })
})
