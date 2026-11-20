import { db, getMeta, setMeta } from '../db/db'
import { replaySchedule } from './levels'

export const SCHEDULE_VERSION = 2

/** Recalcule (ou supprime) la planification des cartes données à partir de leur historique. */
export async function recomputeScheduling(cardIds: string[]) {
  for (const id of [...new Set(cardIds)]) {
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

/** À l'ouverture : si la méthode de planification a changé, tout est recalculé depuis l'historique (rien n'est perdu). */
export async function ensureScheduleVersion() {
  if ((await getMeta<number>('scheduleVersion')) !== SCHEDULE_VERSION) {
    await recomputeAllScheduling()
    await setMeta('scheduleVersion', SCHEDULE_VERSION)
  }
}
