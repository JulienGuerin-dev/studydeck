// Modèle de données de StudyDeck. Une « matière » est un dossier racine (parentId = null).

/** Type d'une matière (dossier racine). Absent = « learning ». */
export type SubjectKind = 'hobbit' | 'learning' | 'archive'

export interface Folder {
  id: string
  parentId: string | null
  name: string
  createdAt: number
  updatedAt: number
  deletedAt: number | null // tombstone (suppression logique, nécessaire à la synchronisation)
  rev: number // compteur de modifications locales
  deviceId: string // appareil de la dernière modification
  kind?: SubjectKind // significatif seulement pour une matière (racine)
  emoji?: string // personnalisation (accueil)
  color?: string // personnalisation (accueil), ex. « #7c9cff »
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
  /**
   * first    = première présentation de la carte dans la session (fait avancer ses étapes)
   * retry    = répétition immédiate (statistiques seulement)
   * undo     = annule l'événement `undoes` (l'historique n'est jamais modifié)
   * set-level = changement manuel d'étape (`level`)
   */
  kind: 'first' | 'retry' | 'undo' | 'set-level'
  mode: 'due' | 'free'
  undoes?: string
  level?: number
}

/** Étape d'apprentissage, calculée en rejouant les événements. Jamais synchronisée. */
export interface Scheduling {
  cardId: string
  level: number // étape courante, 1 à 6
  graduated: boolean // les 6 étapes sont réussies
  failStreak: number // 0 ou 1 : échecs consécutifs à cette étape
  nextReviewAt: number
  lastReviewAt: number | null
  reviews: number // révisions ayant compté pour la progression
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
