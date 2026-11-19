// Moteur de synchronisation bidirectionnelle, indépendant du transport.
// Le transport actuel est un fichier .studysync ; un transport réseau pourra réutiliser exactement ce moteur.
//
// Principe : fusion à trois voies par entité (dossier / carte), sans horloge :
//   L  = empreinte de ma version             R  = empreinte de la version de l'autre appareil
//   Bx = dernière version que j'ai « vue » en commun avec lui (table bases)
//   By = dernière version que LUI a vue en commun avec moi (transmise dans le fichier)
// Voir `decide` pour la table de décision et docs/SYNCHRONISATION.md.

import { db, deviceId, now, uuid } from '../db/db'
import { sha256Hex } from '../db/hash'
import type { Card, EntityKind, Folder, ReviewEvent, Session, SyncBase, SyncConflict } from '../db/types'
import { repairIntegrity } from '../domain/integrity'
import { makeZip, readZip, strFromU8 } from '../exchange/zip'
import { recomputeScheduling } from '../review/scheduling'

export const SYNC_FORMAT = 'studysync'
export const ABSENT = 'absent'

export type Entity = Folder | Card
export interface EntityRec { kind: EntityKind; id: string; hash: string; data: Entity }

export interface SyncPackage {
  format: typeof SYNC_FORMAT
  version: 1
  createdAt: number
  device: { id: string; name: string }
  entities: EntityRec[]
  /** Bases de l'expéditeur : pairId -> (kind|id -> empreinte). */
  bases: Record<string, Record<string, string>>
  events: ReviewEvent[]
  sessions: Session[]
  blobs: { hash: string; mime: string }[]
}
export interface LoadedPackage { pkg: SyncPackage; media: Map<string, Uint8Array> }

export const keyOf = (kind: EntityKind, id: string) => `${kind}|${id}`

/* ------------------------------ Empreintes ------------------------------ */

export async function entityHash(kind: EntityKind, e: Entity): Promise<string> {
  const deleted = e.deletedAt !== null
  const payload = kind === 'card'
    ? ['card', (e as Card).folderId, (e as Card).front, (e as Card).back, deleted]
    : ['folder', (e as Folder).parentId, (e as Folder).name, deleted]
  return sha256Hex(JSON.stringify(payload))
}

/* ------------------------------ Décision ------------------------------ */

export type Action = 'noop' | 'takeRemote' | 'keepLocal' | 'conflict'

export function decide(L: string, R: string, Bx: string, By: string): Action {
  if (L === R) return 'noop'
  const peerSawMine = By === L // l'autre a déjà vu ma version actuelle et l'a dépassée
  const iSawTheirs = Bx === R // j'ai déjà vu sa version actuelle et je l'ai dépassée
  if (peerSawMine && iSawTheirs) return 'conflict'
  if (peerSawMine) return 'takeRemote'
  if (iSawTheirs) return 'keepLocal'
  if (Bx === L) return 'takeRemote' // je n'ai pas bougé depuis la version commune
  if (By === R) return 'keepLocal' // il n'a pas bougé depuis la version commune
  return 'conflict'
}

/* ------------------------------ Export ------------------------------ */

async function selfInfo() {
  const id = await deviceId()
  const dev = await db.devices.get(id)
  return { id, name: dev?.name ?? 'Appareil' }
}

export async function exportSyncFile(): Promise<{ bytes: Uint8Array; name: string; counts: { entities: number; events: number } }> {
  const device = await selfInfo()
  const [folders, cards, events, sessions, blobs, bases] = await Promise.all([
    db.folders.toArray(), db.cards.toArray(), db.events.toArray(), db.sessions.toArray(), db.blobs.toArray(), db.bases.toArray(),
  ])
  const entities: EntityRec[] = []
  for (const f of folders) entities.push({ kind: 'folder', id: f.id, hash: await entityHash('folder', f), data: f })
  for (const c of cards) entities.push({ kind: 'card', id: c.id, hash: await entityHash('card', c), data: c })
  const basesOut: SyncPackage['bases'] = {}
  for (const b of bases) {
    const k = b.key.slice(b.peerId.length + 1)
    ;(basesOut[b.peerId] ??= {})[k] = b.hash
  }
  const pkg: SyncPackage = {
    format: SYNC_FORMAT, version: 1, createdAt: now(), device, entities, bases: basesOut,
    events, sessions, blobs: blobs.map((b) => ({ hash: b.hash, mime: b.mime })),
  }
  const json = JSON.stringify(pkg)
  const manifest = { format: SYNC_FORMAT, version: 1, sha256: await sha256Hex(json), deviceId: device.id, createdAt: pkg.createdAt }
  const files: Record<string, Uint8Array | string> = { 'sync.json': json, 'manifest.json': JSON.stringify(manifest) }
  for (const b of blobs) files[`media/${b.hash}`] = b.data
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
  return {
    bytes: makeZip(files),
    name: `sync-${device.name.replace(/[^\w-]+/g, '_')}-${stamp}.studysync`,
    counts: { entities: entities.length, events: events.length },
  }
}

/* ------------------------------ Lecture / vérification ------------------------------ */

export async function readSyncFile(bytes: Uint8Array): Promise<{ ok: boolean; errors: string[]; loaded?: LoadedPackage }> {
  let z: Record<string, Uint8Array>
  try { z = readZip(bytes) } catch { return { ok: false, errors: ['Ce fichier n\'est pas un fichier de synchronisation valide.'] } }
  if (!z['sync.json'] || !z['manifest.json']) return { ok: false, errors: ['Fichier incomplet (sync.json ou manifest.json manquant).'] }
  let pkg: SyncPackage
  let manifest: { sha256: string }
  try {
    pkg = JSON.parse(strFromU8(z['sync.json']))
    manifest = JSON.parse(strFromU8(z['manifest.json']))
  } catch { return { ok: false, errors: ['Contenu illisible.'] } }
  if (pkg.format !== SYNC_FORMAT || pkg.version !== 1) return { ok: false, errors: ['Format de synchronisation non reconnu.'] }
  if ((await sha256Hex(z['sync.json'])) !== manifest.sha256) {
    return { ok: false, errors: ['Le fichier est corrompu (somme de contrôle invalide). Générez-le à nouveau.'] }
  }
  const self = await deviceId()
  if (pkg.device.id === self) return { ok: false, errors: ['Ce fichier a été créé par cet appareil : importez celui de l\'autre appareil.'] }
  const media = new Map<string, Uint8Array>()
  for (const b of pkg.blobs) {
    const data = z[`media/${b.hash}`]
    if (!data || (await sha256Hex(data)) !== b.hash) return { ok: false, errors: [`Image corrompue ou manquante (${b.hash.slice(0, 8)}…).`] }
    media.set(b.hash, data)
  }
  for (const e of pkg.entities) {
    if ((await entityHash(e.kind, e.data)) !== e.hash) return { ok: false, errors: ['Une entité du fichier est incohérente (empreinte invalide).'] }
  }
  return { ok: true, errors: [], loaded: { pkg, media } }
}

/* ------------------------------ Plan ------------------------------ */

export interface PlanItem {
  key: string
  kind: EntityKind
  id: string
  action: Action
  localHash: string
  remoteHash: string
  local: Entity | null
  remote: Entity | null
}

export interface SyncPlan {
  peer: { id: string; name: string }
  items: PlanItem[] // uniquement les entités où une action est nécessaire (hors noop)
  noopHashes: Record<string, string> // entités identiques : base à mettre à jour
  newEvents: ReviewEvent[]
  newSessions: Session[]
  newBlobs: string[]
  summary: {
    newCards: number; changedCards: number; deletedCards: number
    newFolders: number; changedFolders: number; deletedFolders: number
    toSend: number; conflicts: number; newEvents: number
  }
}

export async function planImport(loaded: LoadedPackage): Promise<SyncPlan> {
  const { pkg } = loaded
  const self = await deviceId()
  const [folders, cards, baseRows] = await Promise.all([
    db.folders.toArray(), db.cards.toArray(), db.bases.where('peerId').equals(pkg.device.id).toArray(),
  ])
  const baseMap = new Map(baseRows.map((b) => [b.key.slice(b.peerId.length + 1), b.hash]))
  const theirBases = pkg.bases[self] ?? {}

  const local = new Map<string, { e: Entity; h: string }>()
  for (const f of folders) local.set(keyOf('folder', f.id), { e: f, h: await entityHash('folder', f) })
  for (const c of cards) local.set(keyOf('card', c.id), { e: c, h: await entityHash('card', c) })
  const remote = new Map(pkg.entities.map((r) => [keyOf(r.kind, r.id), r]))

  const items: PlanItem[] = []
  const noopHashes: Record<string, string> = {}
  const keys = new Set([...local.keys(), ...remote.keys()])
  for (const key of keys) {
    const l = local.get(key)
    const r = remote.get(key)
    const L = l?.h ?? ABSENT
    const R = r?.hash ?? ABSENT
    const Bx = baseMap.get(key) ?? ABSENT
    const By = theirBases[key] ?? ABSENT
    let action = decide(L, R, Bx, By)
    // Supprimé de l'autre côté alors que j'ai déjà purgé ma copie : rien à faire.
    if (!l && r && r.data.deletedAt !== null) action = 'noop'
    if (action === 'noop') { if (L !== ABSENT) noopHashes[key] = L; continue }
    const [kind, id] = key.split('|') as [EntityKind, string]
    items.push({
      key, kind, id, action, localHash: L, remoteHash: R, local: l?.e ?? null, remote: r?.data ?? null,
    })
  }

  const evIds = new Set((await db.events.toCollection().primaryKeys()) as string[])
  const newEvents = pkg.events.filter((e) => !evIds.has(e.id))
  const sIds = new Set((await db.sessions.toCollection().primaryKeys()) as string[])
  const newSessions = pkg.sessions.filter((s) => !sIds.has(s.id))
  const blobHashes = new Set((await db.blobs.toCollection().primaryKeys()) as string[])
  const newBlobs = pkg.blobs.map((b) => b.hash).filter((h) => !blobHashes.has(h))

  const s = {
    newCards: 0, changedCards: 0, deletedCards: 0, newFolders: 0, changedFolders: 0, deletedFolders: 0,
    toSend: 0, conflicts: 0, newEvents: newEvents.length,
  }
  for (const it of items) {
    if (it.action === 'keepLocal') s.toSend++
    else if (it.action === 'conflict') s.conflicts++
    else {
      const isCard = it.kind === 'card'
      if (it.remote && it.remote.deletedAt !== null) { if (isCard) s.deletedCards++; else s.deletedFolders++ }
      else if (!it.local) { if (isCard) s.newCards++; else s.newFolders++ }
      else if (isCard) s.changedCards++
      else s.changedFolders++
    }
  }
  return { peer: pkg.device, items, noopHashes, newEvents, newSessions, newBlobs, summary: s }
}

/* ------------------------------ Application ------------------------------ */

export interface ApplyResult {
  taken: number
  keptLocal: number
  conflictsResolved: number
  newEvents: number
  repaired: number
}

/**
 * Applique le plan dans UNE transaction : tout ou rien. Les versions écartées sont conservées dans `conflicts`.
 * `resolutions` : choix de l'utilisateur pour chaque conflit (clé = kind|id).
 * Aucun `await` hors Dexie à l'intérieur de la transaction (sinon IndexedDB la fermerait).
 */
export async function applyImport(
  loaded: LoadedPackage,
  plan: SyncPlan,
  resolutions: Record<string, 'local' | 'remote'>,
  opts: { failAfterWrites?: boolean } = {},
): Promise<ApplyResult> {
  for (const it of plan.items) {
    if (it.action === 'conflict' && !resolutions[it.key]) throw new Error('Tous les conflits doivent être résolus avant d\'appliquer.')
  }
  const peer = plan.peer
  const result: ApplyResult = { taken: 0, keptLocal: 0, conflictsResolved: 0, newEvents: plan.newEvents.length, repaired: 0 }
  const baseWrites: SyncBase[] = []
  const setBase = (key: string, hash: string) => baseWrites.push({ key: `${peer.id}|${key}`, peerId: peer.id, hash })
  const t = now()

  await db.transaction('rw', [db.folders, db.cards, db.events, db.scheduling, db.blobs, db.sessions, db.devices, db.bases, db.conflicts, db.meta], async () => {
    for (const [key, h] of Object.entries(plan.noopHashes)) setBase(key, h)

    for (const it of plan.items) {
      const put = async (e: Entity) => {
        if (it.kind === 'card') await db.cards.put({ ...(e as Card), rev: Math.max((it.local?.rev ?? 0), e.rev) + 1 })
        else await db.folders.put({ ...(e as Folder), rev: Math.max((it.local?.rev ?? 0), e.rev) + 1 })
      }
      const keepDiscarded = async (chosen: 'local' | 'remote') => {
        const rec: SyncConflict = {
          id: uuid(), kind: it.kind, entityId: it.id, local: it.local, remote: it.remote, peerId: peer.id, peerName: peer.name,
          createdAt: t, status: 'resolved', chosen,
        }
        await db.conflicts.add(rec)
      }
      if (it.action === 'takeRemote') {
        // Ma version avait des changements que l'autre appareil a déjà vus et dépassés : je la garde en récupération.
        if (it.remote) {
          if (it.local && it.localHash !== ABSENT) {
            const hadOwnChanges = !(await isLocalUnchanged(it, peer.id))
            if (hadOwnChanges) await keepDiscarded('remote')
          }
          await put(it.remote)
        }
        setBase(it.key, it.remoteHash)
        result.taken++
      } else if (it.action === 'keepLocal') {
        result.keptLocal++ // la base ne change pas : l'autre appareil récupérera ma version à son import
      } else if (it.action === 'conflict') {
        const choice = resolutions[it.key]
        await keepDiscarded(choice)
        if (choice === 'remote' && it.remote) await put(it.remote)
        setBase(it.key, it.remoteHash) // j'ai vu sa version : le conflit ne reviendra pas
        result.conflictsResolved++
      }
    }
    if (opts.failAfterWrites) throw new Error('Interruption simulée (test).')

    // Événements, sessions, images : union, idempotente grâce aux identifiants uniques / empreintes
    await db.events.bulkPut(plan.newEvents)
    await db.sessions.bulkPut(plan.newSessions)
    for (const h of plan.newBlobs) {
      const meta = loaded.pkg.blobs.find((b) => b.hash === h)!
      if (!(await db.blobs.get(h))) await db.blobs.put({ hash: h, mime: meta.mime, data: loaded.media.get(h)! })
    }
    await db.bases.bulkPut(baseWrites)
    await db.devices.put({ id: peer.id, name: peer.name, lastSyncAt: t, isSelf: false })

    // Cohérence : cycles / orphelins créés par la fusion
    result.repaired = await repairIntegrity()
    await recomputeScheduling([...new Set(plan.newEvents.map((e) => e.cardId))])
  })
  return result
}

/** Vrai si ma version locale est identique à la dernière version commune (aucune modification propre à protéger). */
async function isLocalUnchanged(it: PlanItem, peerId: string): Promise<boolean> {
  const b = await db.bases.get(`${peerId}|${it.key}`)
  return (b?.hash ?? ABSENT) === it.localHash
}

/* ------------------------------ Récupération d'une version écartée ------------------------------ */

export async function recoverConflict(conflictId: string): Promise<void> {
  const c = await db.conflicts.get(conflictId)
  if (!c) throw new Error('Conflit introuvable.')
  const discarded = (c.chosen === 'local' ? c.remote : c.local) as Entity | null
  if (!discarded) throw new Error('Aucune version à récupérer.')
  const dev = await deviceId()
  await db.transaction('rw', [db.folders, db.cards, db.conflicts, db.meta], async () => {
    if (c.kind === 'card') {
      const cur = await db.cards.get(c.entityId)
      await db.cards.put({ ...(discarded as Card), updatedAt: now(), rev: (cur?.rev ?? 0) + 1, deviceId: dev })
    } else {
      const cur = await db.folders.get(c.entityId)
      await db.folders.put({ ...(discarded as Folder), updatedAt: now(), rev: (cur?.rev ?? 0) + 1, deviceId: dev })
    }
    await db.conflicts.update(conflictId, { recovered: true })
    await repairIntegrity()
  })
}

/* ------------------------------ Purge des tombstones ------------------------------ */

/**
 * Supprime définitivement les suppressions logiques que TOUS les appareils connus ont confirmées
 * (leur base correspond à la version supprimée). Sans autre appareil connu, rien n'est purgé.
 */
export async function purgeTombstones(): Promise<number> {
  const peers = (await db.devices.toArray()).filter((d) => !d.isSelf)
  if (!peers.length) return 0
  const dead: { kind: EntityKind; id: string; hash: string }[] = []
  for (const f of await db.folders.toArray()) if (f.deletedAt !== null) dead.push({ kind: 'folder', id: f.id, hash: await entityHash('folder', f) })
  for (const c of await db.cards.toArray()) if (c.deletedAt !== null) dead.push({ kind: 'card', id: c.id, hash: await entityHash('card', c) })
  const bases = new Map((await db.bases.toArray()).map((b) => [b.key, b.hash]))
  let purged = 0
  await db.transaction('rw', db.folders, db.cards, db.bases, async () => {
    for (const d of dead) {
      const key = keyOf(d.kind, d.id)
      if (peers.every((p) => bases.get(`${p.id}|${key}`) === d.hash)) {
        if (d.kind === 'card') await db.cards.delete(d.id)
        else await db.folders.delete(d.id)
        for (const p of peers) await db.bases.delete(`${p.id}|${key}`)
        purged++
      }
    }
  })
  return purged
}

export async function selfName(): Promise<string> {
  return (await selfInfo()).name
}
export async function renameSelf(name: string) {
  const id = await deviceId()
  const d = await db.devices.get(id)
  await db.devices.put({ id, name: name.trim() || 'Appareil', lastSyncAt: d?.lastSyncAt ?? null, isSelf: true })
}
