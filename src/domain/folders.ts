import { db, deviceId, now, uuid } from '../db/db'
import type { Card, Folder } from '../db/types'

const live = <T extends { deletedAt: number | null }>(x: T) => x.deletedAt === null

export async function listFolders(): Promise<Folder[]> {
  return (await db.folders.toArray()).filter(live)
}

export async function createFolder(name: string, parentId: string | null): Promise<Folder> {
  const clean = name.trim()
  if (!clean) throw new Error('Le nom ne peut pas être vide.')
  if (parentId) {
    const p = await db.folders.get(parentId)
    if (!p || p.deletedAt !== null) throw new Error('Le dossier parent est introuvable.')
  }
  const t = now()
  const f: Folder = {
    id: uuid(), parentId, name: clean, createdAt: t, updatedAt: t, deletedAt: null, rev: 1, deviceId: await deviceId(),
  }
  await db.folders.add(f)
  return f
}

export async function renameFolder(id: string, name: string) {
  const clean = name.trim()
  if (!clean) throw new Error('Le nom ne peut pas être vide.')
  const f = await db.folders.get(id)
  if (!f || f.deletedAt !== null) throw new Error('Dossier introuvable.')
  await db.folders.put({ ...f, name: clean, updatedAt: now(), rev: f.rev + 1, deviceId: await deviceId() })
}

/** Identifiants du dossier et de tous ses descendants (non supprimés). */
export async function descendantIds(id: string): Promise<string[]> {
  const all = await listFolders()
  const children = new Map<string, string[]>()
  for (const f of all) {
    if (f.parentId) children.set(f.parentId, [...(children.get(f.parentId) ?? []), f.id])
  }
  const out: string[] = []
  const stack = [id]
  const seen = new Set<string>()
  while (stack.length) {
    const cur = stack.pop()!
    if (seen.has(cur)) continue
    seen.add(cur)
    out.push(cur)
    for (const c of children.get(cur) ?? []) stack.push(c)
  }
  return out
}

export async function moveFolder(id: string, newParentId: string | null) {
  const f = await db.folders.get(id)
  if (!f || f.deletedAt !== null) throw new Error('Dossier introuvable.')
  if (newParentId === f.parentId) return
  if (newParentId) {
    const p = await db.folders.get(newParentId)
    if (!p || p.deletedAt !== null) throw new Error('Destination introuvable.')
    const desc = await descendantIds(id)
    if (desc.includes(newParentId)) throw new Error('Impossible de déplacer un dossier dans lui-même ou dans l\'un de ses sous-dossiers.')
  }
  await db.folders.put({ ...f, parentId: newParentId, updatedAt: now(), rev: f.rev + 1, deviceId: await deviceId() })
}

export async function countInside(id: string): Promise<{ folders: number; cards: number }> {
  const ids = await descendantIds(id)
  const set = new Set(ids)
  const cards = (await db.cards.toArray()).filter((c) => live(c) && set.has(c.folderId)).length
  return { folders: ids.length - 1, cards }
}

/** Suppression logique en cascade (sous-dossiers et cartes), dans une seule transaction. */
export async function deleteFolder(id: string): Promise<{ folders: number; cards: number }> {
  const ids = new Set(await descendantIds(id))
  const dev = await deviceId()
  const t = now()
  let cards = 0
  await db.transaction('rw', db.folders, db.cards, async () => {
    for (const fid of ids) {
      const f = await db.folders.get(fid)
      if (f && f.deletedAt === null) await db.folders.put({ ...f, deletedAt: t, updatedAt: t, rev: f.rev + 1, deviceId: dev })
    }
    const cs = (await db.cards.toArray()).filter((c) => live(c) && ids.has(c.folderId))
    for (const c of cs) {
      await db.cards.put({ ...c, deletedAt: t, updatedAt: t, rev: c.rev + 1, deviceId: dev })
      cards++
    }
  })
  return { folders: ids.size - 1, cards }
}

/** Chemin lisible « Mathématiques / Analyse / Suites ». */
export function folderPath(id: string | null, folders: Folder[]): string {
  const byId = new Map(folders.map((f) => [f.id, f]))
  const parts: string[] = []
  let cur = id ? byId.get(id) : undefined
  let guard = 0
  while (cur && guard++ < 200) {
    parts.unshift(cur.name)
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
  return parts.join(' / ')
}

export function subjectOf(id: string, folders: Folder[]): Folder | undefined {
  const byId = new Map(folders.map((f) => [f.id, f]))
  let cur = byId.get(id)
  let guard = 0
  while (cur?.parentId && guard++ < 200) cur = byId.get(cur.parentId)
  return cur
}

/* ---------------- Cartes ---------------- */

export async function listCards(): Promise<Card[]> {
  return (await db.cards.toArray()).filter(live)
}

export async function createCard(folderId: string, front: string, back: string): Promise<Card> {
  const f = await db.folders.get(folderId)
  if (!f || f.deletedAt !== null) throw new Error('Le dossier de destination est introuvable.')
  const t = now()
  const c: Card = {
    id: uuid(), folderId, front, back, createdAt: t, updatedAt: t, deletedAt: null, rev: 1, deviceId: await deviceId(),
  }
  await db.cards.add(c)
  return c
}

export async function updateCard(id: string, patch: { front?: string; back?: string }) {
  const c = await db.cards.get(id)
  if (!c || c.deletedAt !== null) throw new Error('Carte introuvable.')
  await db.cards.put({
    ...c,
    front: patch.front ?? c.front,
    back: patch.back ?? c.back,
    updatedAt: now(),
    rev: c.rev + 1,
    deviceId: await deviceId(),
  })
}

export async function moveCard(id: string, folderId: string) {
  const c = await db.cards.get(id)
  const f = await db.folders.get(folderId)
  if (!c || c.deletedAt !== null) throw new Error('Carte introuvable.')
  if (!f || f.deletedAt !== null) throw new Error('Destination introuvable.')
  if (c.folderId === folderId) return
  await db.cards.put({ ...c, folderId, updatedAt: now(), rev: c.rev + 1, deviceId: await deviceId() })
}

export async function deleteCard(id: string) {
  const c = await db.cards.get(id)
  if (!c || c.deletedAt !== null) return
  const t = now()
  await db.cards.put({ ...c, deletedAt: t, updatedAt: t, rev: c.rev + 1, deviceId: await deviceId() })
}

export async function duplicateCard(id: string): Promise<Card> {
  const c = await db.cards.get(id)
  if (!c || c.deletedAt !== null) throw new Error('Carte introuvable.')
  return createCard(c.folderId, c.front, c.back)
}
