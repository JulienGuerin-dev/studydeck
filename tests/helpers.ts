import 'fake-indexeddb/auto'
import { StudyDB, initDevice, useDb } from '../src/db/db'

let n = 0
/** Crée un « appareil » (base indépendante) et le rend actif. */
export async function newDevice(name: string): Promise<StudyDB> {
  const d = new StudyDB(`test-${name}-${n++}-${Math.random().toString(36).slice(2)}`)
  useDb(d)
  await initDevice(name)
  return d
}

/** Exécute `fn` en tant que l'appareil `d`. */
export async function as<T>(d: StudyDB, fn: () => Promise<T>): Promise<T> {
  useDb(d)
  return fn()
}
