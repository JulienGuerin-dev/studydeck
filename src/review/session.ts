// Logique pure d'une session de révision (aucune dépendance à la base ou à l'interface).
//
// Règles :
//  - ordre aléatoire pour la première présentation de chaque carte ;
//  - une carte correcte quitte la session ;
//  - une carte incorrecte rejoint la file de répétition ;
//  - quand toutes les cartes ont été vues une fois, la file de répétition est reprise
//    jusqu'à ce que chaque carte ait été répondue correctement.

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
}

export class ReviewSession {
  readonly selected: number
  private firstQueue: string[]
  private retryQueue: string[] = []
  correct = 0
  incorrect = 0
  attempts = 0
  private done = new Set<string>()

  constructor(cardIds: string[], rng: Rng = Math.random) {
    const unique = [...new Set(cardIds)]
    this.selected = unique.length
    this.firstQueue = shuffle(unique, rng)
  }

  current(): Presentation | null {
    if (this.firstQueue.length) return { cardId: this.firstQueue[0], kind: 'first' }
    if (this.retryQueue.length) return { cardId: this.retryQueue[0], kind: 'retry' }
    return null
  }

  /** Enregistre la réponse à la carte courante et retourne la présentation qui vient d'être validée. */
  answer(correct: boolean): Presentation {
    const cur = this.current()
    if (!cur) throw new Error('La session est terminée.')
    if (cur.kind === 'first') this.firstQueue.shift()
    else this.retryQueue.shift()
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

  get finished(): boolean {
    return this.firstQueue.length === 0 && this.retryQueue.length === 0
  }
  get remainingNew(): number { return this.firstQueue.length }
  get remainingRetry(): number { return this.retryQueue.length }
  /** Cartes validées correctement (sorties de la session). */
  get completed(): number { return this.done.size }
  get successRate(): number { return this.attempts ? this.correct / this.attempts : 0 }
}
