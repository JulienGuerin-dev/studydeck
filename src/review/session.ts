// Logique pure d'une session de révision (aucune dépendance à la base ou à l'interface).
//
// Règles :
//  - ordre aléatoire pour la première présentation de chaque carte ;
//  - une carte correcte quitte la session ; une carte incorrecte rejoint la file de reprise ;
//  - quand toutes les cartes ont été vues une fois, la file de reprise est reprise jusqu'à ce que chaque carte
//    ait été répondue correctement ;
//  - les cartes « sans notation » (matières Loisir / Archive) sont simplement consultées, une fois, sans résultat ;
//  - on peut revenir en arrière (undo) autant de fois que nécessaire.

export type Rng = () => number

export function shuffle<T>(items: T[], rng: Rng = Math.random): T[] {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export interface Presentation {
  cardId: string
  kind: 'first' | 'retry'
  graded: boolean
}

interface Snapshot {
  first: string[]
  retry: string[]
  correct: number
  incorrect: number
  attempts: number
  done: string[]
  viewed: string[]
  answered: Presentation
}

export class ReviewSession {
  readonly selected: number
  private firstQueue: string[]
  private retryQueue: string[] = []
  private ungraded: Set<string>
  private history: Snapshot[] = []
  correct = 0
  incorrect = 0
  attempts = 0
  skipped = 0
  private done = new Set<string>()
  private viewed = new Set<string>()

  constructor(cardIds: string[], rng: Rng = Math.random, ungraded: Iterable<string> = []) {
    const unique = [...new Set(cardIds)]
    this.selected = unique.length
    this.ungraded = new Set(ungraded)
    this.firstQueue = shuffle(unique, rng)
  }

  current(): Presentation | null {
    const id = this.firstQueue[0]
    if (id !== undefined) return { cardId: id, kind: 'first', graded: !this.ungraded.has(id) }
    const r = this.retryQueue[0]
    if (r !== undefined) return { cardId: r, kind: 'retry', graded: true }
    return null
  }

  /** Enregistre la réponse à la carte courante. Pour une carte sans notation, `correct` est ignoré. */
  answer(correct: boolean): Presentation {
    const cur = this.current()
    if (!cur) throw new Error('La session est terminée.')
    this.history.push({
      first: [...this.firstQueue], retry: [...this.retryQueue], correct: this.correct, incorrect: this.incorrect,
      attempts: this.attempts, done: [...this.done], viewed: [...this.viewed], answered: cur,
    })
    if (cur.kind === 'first') this.firstQueue.shift()
    else this.retryQueue.shift()
    if (!cur.graded) {
      this.viewed.add(cur.cardId)
      return cur
    }
    this.attempts++
    if (correct) {
      this.correct++
      this.done.add(cur.cardId)
    } else {
      this.incorrect++
      this.retryQueue.push(cur.cardId)
    }
    return cur
  }

  get canUndo(): boolean { return this.history.length > 0 }

  /** Annule la dernière réponse : la carte redevient la carte courante. Retourne la présentation annulée. */
  undo(): Presentation | null {
    const s = this.history.pop()
    if (!s) return null
    this.firstQueue = s.first
    this.retryQueue = s.retry
    this.correct = s.correct
    this.incorrect = s.incorrect
    this.attempts = s.attempts
    this.done = new Set(s.done)
    this.viewed = new Set(s.viewed)
    return s.answered
  }

  /** Retire la carte courante sans enregistrer de résultat (carte supprimée pendant la session). */
  skipCurrent(): Presentation | null {
    const cur = this.current()
    if (!cur) return null
    if (cur.kind === 'first') this.firstQueue.shift()
    else this.retryQueue.shift()
    this.skipped++
    return cur
  }

  get finished(): boolean { return this.firstQueue.length === 0 && this.retryQueue.length === 0 }
  get remainingNew(): number { return this.firstQueue.length }
  get remainingRetry(): number { return this.retryQueue.length }
  /** Cartes terminées dans la session (réussies, ou simplement consultées). */
  get completed(): number { return this.done.size + this.viewed.size }
  get consulted(): number { return this.viewed.size }
  get successRate(): number { return this.attempts ? this.correct / this.attempts : 0 }
}
