import type { Card, Folder } from '../db/types'
import type { SyncPlan } from '../sync/engine'
import { Rich } from './Rich'
import { pathOf, useLibrary } from './store'

function describe(e: Folder | Card | null, lib: ReturnType<typeof useLibrary>, kind: 'card' | 'folder') {
  if (!e) return <span className="muted">(absent)</span>
  const deleted = e.deletedAt !== null
  if (kind === 'card') {
    const c = e as Card
    return <div>{deleted && <div className="tag bad">Supprimée</div>}<div className="face"><Rich text={c.front} /></div><div className="face"><Rich text={c.back} /></div><div className="muted small">Dossier : {pathOf(lib, c.folderId) || '(inconnu)'}</div></div>
  }
  const f = e as Folder
  return <div>{deleted && <div className="tag bad">Supprimé</div>}<strong>{f.name}</strong><div className="muted small">Dans : {f.parentId ? pathOf(lib, f.parentId) || '(inconnu)' : 'racine'}</div></div>
}

/** Résumé d'une synchronisation et résolution des conflits (partagé par le mode Wi-Fi et le mode fichier). */
export function PlanView({ plan, choice, setChoice, readOnly = false }: {
  plan: SyncPlan
  choice: Record<string, 'local' | 'remote'>
  setChoice: (c: Record<string, 'local' | 'remote'>) => void
  readOnly?: boolean
}) {
  const lib = useLibrary()
  const s = plan.summary
  const conflictItems = plan.items.filter((i) => i.action === 'conflict')
  return (
    <>
      <h3>Résumé</h3>
      <ul className="sumlist">
        <li><b>{s.newCards}</b> nouvelle(s) carte(s) reçue(s), <b>{s.changedCards}</b> modifiée(s), <b>{s.deletedCards}</b> supprimée(s)</li>
        <li><b>{s.newFolders}</b> nouveau(x) dossier(s), <b>{s.changedFolders}</b> modifié(s), <b>{s.deletedFolders}</b> supprimé(s)</li>
        <li><b>{s.newEvents}</b> révision(s) à fusionner</li>
        <li><b>{s.toSend}</b> élément(s) propres à cet appareil (envoyés à l'autre)</li>
        <li><b>{s.conflicts}</b> conflit(s)</li>
      </ul>
      <p className="muted small">Une copie de sécurité est enregistrée avant l'application (sur PC). L'opération est atomique : en cas d'interruption, rien n'est modifié.</p>
      {conflictItems.length > 0 && (
        <>
          <h3>{readOnly ? 'Conflits (à trancher sur l\'autre appareil)' : 'Conflits : choisissez la version à conserver'}</h3>
          {!readOnly && (
            <div className="actions">
              <button className="small" onClick={() => setChoice(Object.fromEntries(conflictItems.map((i) => [i.key, 'local'])))}>Tout garder : cet appareil</button>
              <button className="small" onClick={() => setChoice(Object.fromEntries(conflictItems.map((i) => [i.key, 'remote'])))}>Tout garder : l'autre appareil</button>
            </div>
          )}
          {conflictItems.map((it) => (
            <div key={it.key} className="conflict">
              <div className={`side ${choice[it.key] === 'local' ? 'picked' : ''}`}>
                <label><input type="radio" disabled={readOnly} name={it.key} checked={choice[it.key] === 'local'} onChange={() => setChoice({ ...choice, [it.key]: 'local' })} /> Cet appareil</label>
                {describe(it.local, lib, it.kind)}
              </div>
              <div className={`side ${choice[it.key] === 'remote' ? 'picked' : ''}`}>
                <label><input type="radio" disabled={readOnly} name={it.key} checked={choice[it.key] === 'remote'} onChange={() => setChoice({ ...choice, [it.key]: 'remote' })} /> {plan.peer.name}</label>
                {describe(it.remote, lib, it.kind)}
              </div>
            </div>
          ))}
          <p className="muted small">La version non retenue reste récupérable dans « Versions écartées ».</p>
        </>
      )}
    </>
  )
}
