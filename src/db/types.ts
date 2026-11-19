// Modèle de données de StudyDeck. Une « matière » est un dossier racine (parentId = null).

export interface Folder {
  id: string
  parentId: string | null
  name: string
  createdAt: number
  updatedAt: number
  deletedAt: number | null // tombstone (suppression logique, nécessaire à la synchronisation)
  rev: number // compteur de modifications locales
  deviceId: string // appareil de la dernière modification
}

export interface Card {
  id: string
  folderId: string
  front: string // Markdown + LaTeX ($...$ et $$...$$)
  back: string
  createdAt: number
  updatedAt: number
  deletedAt: number | null
  rev: number
  deviceId: string
}

/** Événement de révision : immuable, jamais modifié ni supprimé. */
export interface ReviewEvent {
  id: string
  cardId: string
  deviceId: string
  sessionId: string
  at: number
  correct: boolean
  kind: 'first' | 'retry' // first = première présentation dans la session (compte pour SM-2)
  mode: 'due' | 'free'
}

/** Planification SM-2, calculée en rejouant les événements « first ». Jamais synchronisée. */
export interface Scheduling {
  cardId: string
  reps: number
  ef: number
  interval: number // jours
  nextReviewAt: number
  lastReviewAt: number
  firstCount: number
}

export interface BlobRec {
  hash: string // SHA-256 hex du contenu
  mime: string
  data: Uint8Array
}

export interface Session {
  id: string
  startedAt: number
  endedAt: number | null
  scopeFolderId: string | null
  scopeLabel: string
  mode: 'due' | 'free'
  selected: number
  correct: number
  incorrect: number
  attempts: number
  deviceId: string
}

export interface DeviceRec {
  id: string
  name: string
  lastSyncAt: number | null
  isSelf: boolean
}

/** Dernière version « connue en commun » d'une entité avec un appareil donné. */
export interface SyncBase {
  key: string // `${peerId}|${kind}|${entityId}`
  peerId: string
  hash: string
}

export type EntityKind = 'folder' | 'card'

export interface SyncConflict {
  id: string
  kind: EntityKind
  entityId: string
  local: Folder | Card | null
  remote: Folder | Card | null
  peerId: string
  peerName: string
  createdAt: number
  status: 'resolved'
  chosen: 'local' | 'remote'
  recovered?: boolean
}

export interface MetaRec {
  key: string
  value: unknown
}
