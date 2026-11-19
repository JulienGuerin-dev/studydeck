// Sauvegarde complète (.studybackup) : archive ZIP avec backup.json, media/ et manifest.json (somme SHA-256).

import { db } from '../db/db'
import { sha256Hex } from '../db/hash'
import { referencedHashes } from '../domain/media'
import { recomputeAllScheduling } from '../review/scheduling'
import { makeZip, readZip, strFromU8 } from './zip'
import type { Card, Folder, ReviewEvent, Session, SyncConflict } from '../db/types'

export const BACKUP_FORMAT = 'studydeck-backup'

interface BackupData {
  format: string
  version: 1
  createdAt: number
  deviceId: string | undefined
  folders: Folder[]
  cards: Card[]
  events: ReviewEvent[]
  sessions: Session[]
  conflicts: SyncConflict[]
  blobs: { hash: string; mime: string }[]
}

export interface BackupCounts { folders: number; cards: number; events: number; blobs: number }

export async function createBackup(): Promise<{ bytes: Uint8Array; counts: BackupCounts }> {
  const [folders, cards, events, sessions, conflicts, blobs, meta] = await Promise.all([
    db.folders.toArray(), db.cards.toArray(), db.events.toArray(), db.sessions.toArray(),
    db.conflicts.toArray(), db.blobs.toArray(), db.meta.get('deviceId'),
  ])
  const data: BackupData = {
    format: BACKUP_FORMAT, version: 1, createdAt: Date.now(), deviceId: meta?.value as string | undefined,
    folders, cards, events, sessions, conflicts, blobs: blobs.map((b) => ({ hash: b.hash, mime: b.mime })),
  }
  const json = JSON.stringify(data)
  const counts: BackupCounts = { folders: folders.length, cards: cards.length, events: events.length, blobs: blobs.length }
  const manifest = { format: BACKUP_FORMAT, version: 1, sha256: await sha256Hex(json), counts, createdAt: data.createdAt }
  const files: Record<string, Uint8Array | string> = { 'backup.json': json, 'manifest.json': JSON.stringify(manifest, null, 2) }
  for (const b of blobs) files[`media/${b.hash}`] = b.data
  return { bytes: makeZip(files), counts }
}

export interface VerifiedBackup {
  ok: boolean
  errors: string[]
  warnings: string[]
  data?: BackupData
  media?: Map<string, Uint8Array>
  counts?: BackupCounts
  createdAt?: number
}

/** Vérifie l'intégrité d'une sauvegarde : somme de contrôle, compteurs, références, images. */
export async function verifyBackup(bytes: Uint8Array): Promise<VerifiedBackup> {
  const errors: string[] = []
  const warnings: string[] = []
  let z: Record<string, Uint8Array>
  try { z = readZip(bytes) } catch { return { ok: false, errors: ['Ce fichier n\'est pas une archive de sauvegarde valide.'], warnings } }
  if (!z['backup.json'] || !z['manifest.json']) return { ok: false, errors: ['Archive incomplète : backup.json ou manifest.json manquant.'], warnings }
  let manifest: { sha256: string; counts: BackupCounts; format: string }
  let data: BackupData
  try {
    manifest = JSON.parse(strFromU8(z['manifest.json']))
    data = JSON.parse(strFromU8(z['backup.json']))
  } catch { return { ok: false, errors: ['Le contenu de la sauvegarde est illisible.'], warnings } }
  if (manifest.format !== BACKUP_FORMAT || data.format !== BACKUP_FORMAT) return { ok: false, errors: ['Ce fichier n\'est pas une sauvegarde StudyDeck.'], warnings }
  if ((await sha256Hex(z['backup.json'])) !== manifest.sha256) errors.push('La somme de contrôle ne correspond pas : la sauvegarde est corrompue ou a été modifiée.')
  const counts: BackupCounts = { folders: data.folders.length, cards: data.cards.length, events: data.events.length, blobs: data.blobs.length }
  for (const k of Object.keys(counts) as (keyof BackupCounts)[]) {
    if (counts[k] !== manifest.counts[k]) errors.push(`Nombre de ${k} incohérent (${counts[k]} au lieu de ${manifest.counts[k]}).`)
  }
  const folderIds = new Set(data.folders.map((f) => f.id))
  for (const f of data.folders) if (f.parentId && !folderIds.has(f.parentId)) errors.push(`Dossier « ${f.name} » : parent inexistant.`)
  for (const c of data.cards) if (!folderIds.has(c.folderId)) errors.push('Une carte référence un dossier inexistant.')
  const media = new Map<string, Uint8Array>()
  for (const b of data.blobs) {
    const content = z[`media/${b.hash}`]
    if (!content) { errors.push(`Image manquante dans l'archive (${b.hash.slice(0, 8)}…).`); continue }
    if ((await sha256Hex(content)) !== b.hash) { errors.push(`Image corrompue (${b.hash.slice(0, 8)}…).`); continue }
    media.set(b.hash, content)
  }
  const used = referencedHashes(...data.cards.filter((c) => c.deletedAt === null).flatMap((c) => [c.front, c.back]))
  if (used.some((h) => !media.has(h))) warnings.push('Certaines cartes référencent des images absentes de la sauvegarde.')
  return { ok: errors.length === 0, errors: errors.slice(0, 20), warnings, data, media, counts, createdAt: data.createdAt }
}

/** Remplace TOUTE la bibliothèque par le contenu de la sauvegarde (le nom et l'identité de l'appareil sont conservés). */
export async function restoreBackup(v: VerifiedBackup): Promise<void> {
  if (!v.ok || !v.data || !v.media) throw new Error('Sauvegarde invalide : restauration refusée.')
  const d = v.data
  const media = v.media
  await db.transaction('rw', [db.folders, db.cards, db.events, db.scheduling, db.blobs, db.sessions, db.conflicts, db.bases], async () => {
    await Promise.all([
      db.folders.clear(), db.cards.clear(), db.events.clear(), db.scheduling.clear(),
      db.blobs.clear(), db.sessions.clear(), db.conflicts.clear(),
      db.bases.clear(), // les points de synchronisation ne sont plus fiables après une restauration
    ])
    await db.folders.bulkAdd(d.folders)
    await db.cards.bulkAdd(d.cards)
    await db.events.bulkAdd(d.events)
    await db.sessions.bulkAdd(d.sessions ?? [])
    await db.conflicts.bulkAdd(d.conflicts ?? [])
    await db.blobs.bulkAdd(d.blobs.map((b) => ({ hash: b.hash, mime: b.mime, data: media.get(b.hash)! })))
  })
  await recomputeAllScheduling()
}
