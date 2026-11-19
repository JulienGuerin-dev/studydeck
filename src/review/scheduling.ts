import { db } from '../db/db'
import { replaySchedule } from './sm2'

/** Recalcule (ou supprime) la planification des cartes données à partir de leur historique. */
export async function recomputeScheduling(cardIds: string[]) {
  const unique = [...new Set(cardIds)]
  for (const id of unique) {
    const evs = await db.events.where('cardId').equals(id).toArray()
    const s = replaySchedule(id, evs)
    if (s) await db.scheduling.put(s)
    else await db.scheduling.delete(id)
  }
}

export async function recomputeAllScheduling() {
  const ids = (await db.events.orderBy('cardId').uniqueKeys()) as string[]
  await db.scheduling.clear()
  await recomputeScheduling(ids)
}
