import { db, deviceId, now, uuid } from '../db/db'
import type { Folder } from '../db/types'

export interface IntegrityIssue {
  kind: 'card-orphan' | 'folder-orphan' | 'folder-cycle' | 'missing-media'
  id: string
  detail: string
}

const MEDIA_RE = /media:([0-9a-f]{64})/g

/** Vérifie la cohérence : dossiers parents, dossiers des cartes, cycles, images manquantes. */
export async function checkIntegrity(): Promise<IntegrityIssue[]> {
  const issues: IntegrityIssue[] = []
  const folders = (await db.folders.toArray()).filter((f) => f.deletedAt === null)
  const byId = new Map(folders.map((f) => [f.id, f]))

  for (const f of folders) {
    if (f.parentId && !byId.has(f.parentId)) {
      issues.push({ kind: 'folder-orphan', id: f.id, detail: `Le dossier « ${f.name} » pointe vers un parent inexistant.` })
    }
  }
  for (const f of findCycleMembers(folders)) {
    issues.push({ kind: 'folder-cycle', id: f.id, detail: `Le dossier « ${f.name} » fait partie d'une boucle.` })
  }
  const blobHashes = new Set((await db.blobs.toCollection().primaryKeys()) as string[])
  for (const c of await db.cards.toArray()) {
    if (c.deletedAt !== null) continue
    if (!byId.has(c.folderId)) {
      issues.push({ kind: 'card-orphan', id: c.id, detail: 'Une carte est rattachée à un dossier inexistant ou supprimé.' })
    }
    for (const m of (c.front + '\n' + c.back).matchAll(MEDIA_RE)) {
      if (!blobHashes.has(m[1])) issues.push({ kind: 'missing-media', id: c.id, detail: 'Une image référencée est absente.' })
    }
  }
  return issues
}

/** Dossiers appartenant à un cycle de parenté. */
function findCycleMembers(folders: Folder[]): Folder[] {
  const byId = new Map(folders.map((f) => [f.id, f]))
  const bad: Folder[] = []
  for (const f of folders) {
    const seen = new Set<string>([f.id])
    let cur = f.parentId ? byId.get(f.parentId) : undefined
    while (cur) {
      if (cur.id === f.id) { bad.push(f); break }
      if (seen.has(cur.id)) break
      seen.add(cur.id)
      cur = cur.parentId ? byId.get(cur.parentId) : undefined
    }
  }
  return bad
}

async function rescueFolder(): Promise<Folder> {
  const existing = (await db.folders.toArray()).find((f) => f.deletedAt === null && f.parentId === null && f.name === 'Récupéré')
  if (existing) return existing
  const t = now()
  const f: Folder = { id: uuid(), parentId: null, name: 'Récupéré', createdAt: t, updatedAt: t, deletedAt: null, rev: 1, deviceId: await deviceId() }
  await db.folders.add(f)
  return f
}

/**
 * Répare les incohérences structurelles en rattachant les éléments à un dossier racine « Récupéré ».
 * À appeler à l'intérieur d'une transaction si nécessaire (n'utilise que des opérations Dexie).
 * Retourne le nombre de corrections.
 */
export async function repairIntegrity(): Promise<number> {
  let fixed = 0
  const dev = await deviceId()
  const t = now()
  let folders = (await db.folders.toArray()).filter((f) => f.deletedAt === null)
  let byId = new Map(folders.map((f) => [f.id, f]))
  let rescue: Folder | null = null
  const getRescue = async () => (rescue ??= await rescueFolder())

  // 1. Cycles : on détache un membre du cycle à la racine.
  for (let guard = 0; guard < 50; guard++) {
    const cyc = findCycleMembers(folders)
    if (!cyc.length) break
    const victim = cyc.sort((a, b) => b.updatedAt - a.updatedAt)[0]
    await db.folders.put({ ...victim, parentId: null, updatedAt: t, rev: victim.rev + 1, deviceId: dev })
    fixed++
    folders = (await db.folders.toArray()).filter((f) => f.deletedAt === null)
    byId = new Map(folders.map((f) => [f.id, f]))
  }
  // 2. Dossiers orphelins
  for (const f of folders) {
    if (f.parentId && !byId.has(f.parentId)) {
      const r = await getRescue()
      await db.folders.put({ ...f, parentId: r.id, updatedAt: t, rev: f.rev + 1, deviceId: dev })
      fixed++
    }
  }
  // 3. Cartes orphelines
  folders = (await db.folders.toArray()).filter((f) => f.deletedAt === null)
  byId = new Map(folders.map((f) => [f.id, f]))
  for (const c of await db.cards.toArray()) {
    if (c.deletedAt === null && !byId.has(c.folderId)) {
      const r = await getRescue()
      await db.cards.put({ ...c, folderId: r.id, updatedAt: t, rev: c.rev + 1, deviceId: dev })
      fixed++
    }
  }
  return fixed
}
