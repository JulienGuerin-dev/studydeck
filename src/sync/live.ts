// Protocole de synchronisation en direct (transport quelconque : Wire).
//   1. hello (identité) → 2. mode (test | sync) → 3. échange des deux paquets de synchronisation
//   4. l'HÔTE seul voit le plan, résout les conflits et confirme → 5. commit → l'invité applique → l'hôte applique.
// Les deux côtés réutilisent exactement le moteur de fichiers (engine.ts) ; un seul humain tranche les conflits,
// ce qui garantit que les deux bibliothèques finissent identiques.

import { deviceId } from '../db/db'
import { applyImport, exportSyncFile, planImport, purgeTombstones, readSyncFile, selfName, type ApplyResult, type SyncPlan } from './engine'
import type { Wire } from './wire'

export type Resolutions = Record<string, 'local' | 'remote'>

export interface LiveUi {
  status(text: string): void
  /** Appelé avec le plan calculé. L'hôte doit retourner les résolutions (ou null pour annuler). L'invité attend. */
  plan(plan: SyncPlan, role: 'host' | 'guest'): void
  askDecision?(plan: SyncPlan): Promise<Resolutions | null>
  beforeApply(): Promise<void>
  done(text: string, result?: ApplyResult): void
}

/** Vue de l'autre appareil : « garder le mien » devient « garder celui de l'autre », et inversement. */
export function swapResolutions(r: Resolutions): Resolutions {
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v === 'local' ? 'remote' : 'local'])) as Resolutions
}

async function hello(wire: Wire): Promise<{ id: string; name: string }> {
  wire.sendJson({ t: 'hello', v: 2, id: await deviceId(), name: await selfName() })
  const h = await wire.nextJson('hello', 15_000)
  if (h.v !== 2) throw new Error('L\'autre appareil utilise une version différente de StudyDeck. Mettez à jour les deux appareils avant de synchroniser.')
  return { id: String(h.id), name: String(h.name) }
}

export type Mode = 'test' | 'sync'

/** Point d'entrée : l'hôte impose le mode ; l'invité le découvre. */
export async function runSession(wire: Wire, role: 'host' | 'guest', ui: LiveUi, hostMode: Mode = 'sync'): Promise<void> {
  const peer = await hello(wire)
  let mode: Mode = hostMode
  if (role === 'host') wire.sendJson({ t: 'mode', mode })
  else mode = (await wire.nextJson('mode', 15_000)).mode === 'test' ? 'test' : 'sync'
  if (mode === 'test') await runTest(wire, role, ui, peer)
  else await runSync(wire, role, ui, peer)
}

async function runTest(wire: Wire, role: 'host' | 'guest', ui: LiveUi, peer: { id: string; name: string }): Promise<void> {
  if (role === 'host') {
    const t0 = performance.now()
    wire.sendJson({ t: 'ping', n: 1 })
    await wire.nextJson('pong', 10_000)
    const rtt = Math.round(performance.now() - t0)
    // Petit transfert de contrôle (200 Ko) pour vérifier les gros messages
    const blob = new Uint8Array(200_000).map((_, i) => i % 251)
    const t1 = performance.now()
    await wire.sendBytes(blob)
    await wire.nextJson('ack', 15_000)
    const ms = Math.max(1, Math.round(performance.now() - t1))
    ui.done(`Connexion réussie avec « ${peer.name} » : aller-retour ${rtt} ms, 200 Ko transférés en ${ms} ms. Vous pouvez lancer une vraie synchronisation.`)
  } else {
    await wire.nextJson('ping', 10_000)
    wire.sendJson({ t: 'pong' })
    const data = await wire.nextBytes(20_000)
    wire.sendJson({ t: 'ack', size: data.length })
    ui.done(`Connexion réussie avec « ${peer.name} ». Le test est terminé.`)
  }
}

async function runSync(wire: Wire, role: 'host' | 'guest', ui: LiveUi, peer: { id: string; name: string }): Promise<void> {
  ui.status('Préparation de vos données…')
  const mine = await exportSyncFile()
  const receiving = wire.nextBytes(180_000)
  ui.status(`Échange des données avec « ${peer.name} »…`)
  await wire.sendBytes(mine.bytes)
  const theirsBytes = await receiving

  ui.status('Vérification des données reçues…')
  const read = await readSyncFile(theirsBytes)
  if (!read.ok || !read.loaded) {
    wire.sendJson({ t: 'cancel', reason: read.errors.join(' ') })
    throw new Error(read.errors.join(' ') || 'Données reçues invalides.')
  }
  const loaded = read.loaded
  const plan = await planImport(loaded)
  ui.plan(plan, role)

  if (role === 'host') {
    const resolutions = await (ui.askDecision?.(plan) ?? Promise.resolve(null))
    if (!resolutions) {
      wire.sendJson({ t: 'cancel', reason: 'Synchronisation annulée.' })
      ui.done('Synchronisation annulée : aucune donnée n\'a été modifiée.')
      return
    }
    ui.status('Application sur l\'autre appareil…')
    wire.sendJson({ t: 'commit', resolutions })
    const reply = await wire.nextJson('applied', 120_000)
    if (!reply.ok) throw new Error(`L'autre appareil n'a pas pu appliquer la synchronisation (${String(reply.error)}). Rien n'a été modifié ici.`)
    ui.status('Application sur cet appareil…')
    await ui.beforeApply()
    const result = await applyImport(loaded, plan, resolutions)
    const purged = await purgeTombstones()
    wire.sendJson({ t: 'done' })
    ui.done(summarize(result, purged), result)
  } else {
    ui.status('En attente de la confirmation sur l\'autre appareil…')
    const m = await wire.next()
    if (m.kind !== 'json') throw new Error('Message inattendu.')
    if (m.value.t === 'cancel') { ui.done('Synchronisation annulée par l\'autre appareil : aucune donnée n\'a été modifiée.'); return }
    if (m.value.t !== 'commit') throw new Error('Message inattendu.')
    const mapped = swapResolutions(m.value.resolutions as Resolutions)
    const need = plan.items.filter((i) => i.action === 'conflict').map((i) => i.key).sort().join()
    if (Object.keys(mapped).sort().join() !== need) {
      wire.sendJson({ t: 'applied', ok: false, error: 'les deux appareils ne voient pas les mêmes conflits' })
      throw new Error('Incohérence détectée entre les deux appareils : rien n\'a été modifié. Recommencez la synchronisation.')
    }
    try {
      ui.status('Application des changements…')
      await ui.beforeApply()
      const result = await applyImport(loaded, plan, mapped)
      const purged = await purgeTombstones()
      wire.sendJson({ t: 'applied', ok: true })
      await wire.nextJson('done', 30_000).catch(() => undefined)
      ui.done(summarize(result, purged), result)
    } catch (e) {
      wire.sendJson({ t: 'applied', ok: false, error: (e as Error).message })
      throw e
    }
  }
}

export function summarize(r: ApplyResult, purged: number): string {
  return `Synchronisation terminée : ${r.taken} élément(s) reçu(s), ${r.conflictsResolved} conflit(s) résolu(s), ${r.newEvents} révision(s) fusionnée(s)${r.repaired ? `, ${r.repaired} correction(s) de structure` : ''}${purged ? `, ${purged} suppression(s) confirmée(s)` : ''}.`
}
