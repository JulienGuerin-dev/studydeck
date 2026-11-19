import Dexie, { type Table } from 'dexie'
import type {
  BlobRec, Card, DeviceRec, Folder, MetaRec, ReviewEvent, Scheduling, Session, SyncBase, SyncConflict,
} from './types'

export class StudyDB extends Dexie {
  folders!: Table<Folder, string>
  cards!: Table<Card, string>
  events!: Table<ReviewEvent, string>
  scheduling!: Table<Scheduling, string>
  blobs!: Table<BlobRec, string>
  sessions!: Table<Session, string>
  devices!: Table<DeviceRec, string>
  bases!: Table<SyncBase, string>
  conflicts!: Table<SyncConflict, string>
  meta!: Table<MetaRec, string>

  constructor(name = 'studydeck') {
    super(name)
    this.version(1).stores({
      folders: 'id, parentId, deletedAt',
      cards: 'id, folderId, deletedAt, updatedAt',
      events: 'id, cardId, sessionId, at',
      scheduling: 'cardId, nextReviewAt',
      blobs: 'hash',
      sessions: 'id, startedAt',
      devices: 'id',
      bases: 'key, peerId',
      conflicts: 'id, status, createdAt',
      meta: 'key',
    })
  }
}

/** Base active. Les tests remplacent cette base pour simuler deux appareils. */
export let db: StudyDB = new StudyDB()

export function useDb(next: StudyDB) {
  db = next
}

export const allTables = () => [
  db.folders, db.cards, db.events, db.scheduling, db.blobs, db.sessions, db.devices, db.bases, db.conflicts, db.meta,
]

export const uuid = (): string => crypto.randomUUID()
export const now = (): number => Date.now()

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined
}
export async function setMeta(key: string, value: unknown) {
  await db.meta.put({ key, value })
}

/** Identité de cet appareil (créée au premier lancement). */
export async function initDevice(defaultName = 'PC Windows'): Promise<DeviceRec> {
  let id = await getMeta<string>('deviceId')
  if (!id) {
    id = uuid()
    await setMeta('deviceId', id)
  }
  const dev = await db.devices.get(id)
  if (!dev) {
    const d: DeviceRec = { id, name: defaultName, lastSyncAt: null, isSelf: true }
    await db.devices.put(d)
    return d
  }
  return dev
}

export async function deviceId(): Promise<string> {
  const id = await getMeta<string>('deviceId')
  if (id) return id
  return (await initDevice()).id
}
