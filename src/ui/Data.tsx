import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, getMeta, setMeta } from '../db/db'
import type { Card, Folder, SyncConflict } from '../db/types'
import { checkIntegrity, repairIntegrity, type IntegrityIssue } from '../domain/integrity'
import { AI_PROMPT, EXAMPLE_DECK } from '../exchange/aiPrompt'
import { createBackup, restoreBackup, verifyBackup, type VerifiedBackup } from '../exchange/backup'
import {
  cloneDraft, editDraftCard, exportStudyDeck, flattenDraft, importDraft, parseStudyDeck, removeDraftCard,
  type Draft, type ImportDestination,
} from '../exchange/studydeck'
import { appInfo, autoBackup, isDesktop, openFile, saveFile, showItem } from '../platform/files'
import { applyImport, exportSyncFile, planImport, purgeTombstones, readSyncFile, recoverConflict, renameSelf, selfName, type LoadedPackage, type SyncPlan } from '../sync/engine'
import { Modal, confirmAsk, toast } from './dialogs'
import { plainPreview } from './markdown'
import { Rich } from './Rich'
import { FolderSelect, useLibrary } from './store'
import { PlanView } from './PlanView'
import { WifiSync } from './WifiSync'
import { strToU8 } from '../exchange/zip'
import { useEffect } from 'react'

type Tab = 'import' | 'export' | 'backup' | 'sync' | 'device'
const TABS: [Tab, string][] = [['import', 'Importer'], ['export', 'Exporter'], ['backup', 'Sauvegarde'], ['sync', 'Synchronisation'], ['device', 'Appareil']]
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')

export function Data() {
  const [tab, setTab] = useState<Tab>('import')
  return (
    <div className="page">
      <h1>Paramètres et données</h1>
      <div className="tabs" role="tablist">
        {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'import' && <ImportWizard />}
      {tab === 'export' && <ExportPanel />}
      {tab === 'backup' && <BackupPanel />}
      {tab === 'sync' && <SyncPanel />}
      {tab === 'device' && <DevicePanel />}
    </div>
  )
}

/* ============================ Importation ============================ */

function ImportWizard() {
  const lib = useLibrary()
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)
  const [errors, setErrors] = useState<string[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [fileName, setFileName] = useState('')
  const [parent, setParent] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [keep, setKeep] = useState(true)
  const [editing, setEditing] = useState<string | null>(null)
  const [result, setResult] = useState<{ cards: number; folders: number } | null>(null)
  const [, bump] = useState(0)

  const pick = async () => {
    const f = await openFile('Paquet StudyDeck', ['studydeck', 'json', 'zip'])
    if (!f) return
    setFileName(f.name)
    const r = await parseStudyDeck(f.data)
    setErrors(r.errors); setWarnings(r.warnings)
    if (r.ok && r.draft) { setDraft(r.draft); setNewName(r.draft.name); setStep(2) } else setDraft(null)
  }
  const reset = () => { setStep(1); setDraft(null); setErrors([]); setResult(null) }
  const all = draft ? flattenDraft(draft) : []

  const confirm = async () => {
    if (!draft) return
    const dest: ImportDestination = { parentId: parent, newFolderName: newName.trim() || undefined, keepHierarchy: keep }
    try { setResult(await importDraft(draft, dest)); setStep(4) } catch (e) { toast((e as Error).message, 'err') }
  }

  return (
    <div className="box">
      <ol className="steps">{['Fichier', 'Destination', 'Aperçu', 'Terminé'].map((s, i) => <li key={s} className={step === i + 1 ? 'on' : step > i + 1 ? 'done' : ''}>{s}</li>)}</ol>

      {step === 1 && (
        <>
          <p>Choisissez un fichier <code>.studydeck</code> (ou un fichier JSON au même format) généré par une IA ou exporté depuis StudyDeck.</p>
          <div className="actions"><button className="primary" onClick={pick}>Choisir un fichier…</button></div>
          {errors.length > 0 && (
            <div className="alert err"><strong>Le fichier « {fileName} » ne peut pas être importé :</strong>
              <ul>{errors.map((e, i) => <li key={i}>{e}</li>)}</ul></div>
          )}
          <details className="help"><summary>Faire générer un fichier par une IA</summary>
            <p>Copiez cette consigne, donnez-la à l'IA avec votre cours, puis enregistrez sa réponse dans un fichier <code>.json</code> ou <code>.studydeck</code>.</p>
            <textarea readOnly rows={10} value={AI_PROMPT} className="mono" />
            <div className="actions">
              <button onClick={async () => { await navigator.clipboard.writeText(AI_PROMPT); toast('Consigne copiée') }}>Copier la consigne</button>
              <button onClick={async () => { const p = await saveFile('exemple.studydeck', strToU8(JSON.stringify(EXAMPLE_DECK, null, 2)), 'Paquet StudyDeck', 'studydeck'); if (p) toast('Exemple enregistré') }}>Enregistrer un fichier d'exemple</button>
            </div>
          </details>
        </>
      )}

      {step === 2 && draft && (
        <>
          <p><strong>{all.length} carte(s)</strong> dans « {fileName} ».</p>
          {warnings.map((w, i) => <div key={i} className="alert warn">{w}</div>)}
          <label className="field"><span>Importer dans</span><FolderSelect value={parent} onChange={setParent} rootLabel="La racine (nouvelle matière)" /></label>
          <label className="field"><span>Créer un nouveau dossier (facultatif)</span><input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Laisser vide pour ne pas créer de dossier" /></label>
          <label className="check"><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> Conserver la hiérarchie de dossiers du fichier</label>
          {parent === null && !newName.trim() && <p className="muted small">Sans dossier de destination, un dossier « {draft.name} » sera créé à la racine.</p>}
          <div className="actions"><button onClick={reset}>Retour</button><button className="primary" onClick={() => setStep(3)}>Voir l'aperçu</button></div>
        </>
      )}

      {step === 3 && draft && (
        <>
          <p><strong>{all.length} carte(s)</strong> seront importées. Vous pouvez en modifier ou en retirer avant de valider.</p>
          <ul className="cards scroll">
            {all.map(({ card, path }) => (
              <li key={card.tempId} className="card-row">
                <div className="card-main static">
                  <span className="card-front">{plainPreview(card.front, 160)}</span>
                  <span className="card-sub">{plainPreview(card.back, 100)}</span>
                  <span className="card-path">{path.join(' / ') || '(racine du fichier)'}</span>
                </div>
                <div className="row-actions">
                  <button className="small" onClick={() => setEditing(card.tempId)}>Aperçu / Modifier</button>
                  <button className="small danger-outline" onClick={() => { removeDraftCard(draft, card.tempId); bump((x) => x + 1) }}>Retirer</button>
                </div>
              </li>
            ))}
          </ul>
          <div className="actions"><button onClick={() => setStep(2)}>Retour</button>
            <button className="primary" disabled={!all.length} onClick={confirm}>Importer {all.length} carte(s)</button></div>
          {editing && <DraftEditor draft={draft} id={editing} onClose={() => { setEditing(null); bump((x) => x + 1) }} />}
        </>
      )}

      {step === 4 && result && (
        <>
          <div className="alert ok">{result.cards} carte(s) et {result.folders} dossier(s) importés dans la bibliothèque.</div>
          <div className="actions"><button className="primary" onClick={reset}>Importer un autre fichier</button></div>
        </>
      )}
      <span hidden>{lib.cards.length}</span>
    </div>
  )
}

function DraftEditor({ draft, id, onClose }: { draft: Draft; id: string; onClose: () => void }) {
  const entry = flattenDraft(draft).find((x) => x.card.tempId === id)
  const [front, setFront] = useState(entry?.card.front ?? '')
  const [back, setBack] = useState(entry?.card.back ?? '')
  if (!entry) return null
  return (
    <Modal wide title="Aperçu de la carte" onClose={onClose} footer={<><button onClick={onClose}>Annuler</button><button className="primary" onClick={() => { editDraftCard(draft, id, front, back); onClose() }}>Appliquer</button></>}>
      <div className="editor-grid">
        <section className="pane"><h3>Recto</h3><textarea value={front} onChange={(e) => setFront(e.target.value)} /><div className="preview"><Rich text={front} media={draft.media} /></div></section>
        <section className="pane"><h3>Verso</h3><textarea value={back} onChange={(e) => setBack(e.target.value)} /><div className="preview"><Rich text={back} media={draft.media} /></div></section>
      </div>
    </Modal>
  )
}

/* ============================ Exportation ============================ */

function ExportPanel() {
  const [scope, setScope] = useState<string | null>(null)
  const go = async () => {
    try {
      const r = await exportStudyDeck(scope)
      const p = await saveFile(`${r.name.replace(/[^\w\- ]+/g, '_')}.studydeck`, r.bytes, 'Paquet StudyDeck', 'studydeck')
      if (p) toast(`${r.cards} carte(s) exportée(s)`)
    } catch (e) { toast((e as Error).message, 'err') }
  }
  return (
    <div className="box">
      <p>Exporte des cartes au format <code>.studydeck</code> (contenu et images, sans statistiques) pour les partager ou les réimporter ailleurs. Pour tout conserver, y compris l'historique, utilisez la <em>Sauvegarde</em>.</p>
      <label className="field"><span>Périmètre</span><FolderSelect value={scope} onChange={setScope} rootLabel="Toute la bibliothèque" /></label>
      <div className="actions"><button className="primary" onClick={go}>Exporter…</button></div>
    </div>
  )
}

/* ============================ Sauvegarde ============================ */

function BackupPanel() {
  const [pending, setPending] = useState<{ v: VerifiedBackup; name: string } | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [issues, setIssues] = useState<IntegrityIssue[] | null>(null)
  const [dir, setDir] = useState('')
  useEffect(() => { void appInfo().then((i) => setDir(i.backupsDir)) }, [])

  const create = async () => {
    const { bytes, counts } = await createBackup()
    const p = await saveFile(`studydeck-sauvegarde-${stamp()}.studybackup`, bytes, 'Sauvegarde StudyDeck', 'studybackup')
    if (p) toast(`Sauvegarde créée : ${counts.cards} cartes, ${counts.events} révisions, ${counts.blobs} image(s)`)
  }
  const pick = async () => {
    const f = await openFile('Sauvegarde StudyDeck', ['studybackup', 'zip'])
    if (!f) return
    const v = await verifyBackup(f.data)
    if (v.ok) { setErrors([]); setPending({ v, name: f.name }) } else { setPending(null); setErrors(v.errors) }
  }
  const restore = async () => {
    if (!pending) return
    const c = pending.v.counts!
    const ok = await confirmAsk({
      title: 'Restaurer cette sauvegarde ?', danger: true, okLabel: 'Remplacer ma bibliothèque',
      message: `Votre bibliothèque ACTUELLE sera entièrement remplacée par la sauvegarde du ${new Date(pending.v.createdAt!).toLocaleString('fr-FR')} (${c.cards} cartes, ${c.events} révisions).\n\nUne copie de sécurité de l'état actuel sera enregistrée automatiquement avant la restauration.`,
    })
    if (!ok) return
    try {
      const safety = await createBackup()
      const where = await autoBackup(`avant-restauration-${stamp()}.studybackup`, safety.bytes)
      if (!where && isDesktop()) throw new Error('Copie de sécurité impossible : restauration annulée.')
      await restoreBackup(pending.v)
      setPending(null)
      toast('Bibliothèque restaurée')
    } catch (e) { toast((e as Error).message, 'err') }
  }
  const check = async () => setIssues(await checkIntegrity())
  const fix = async () => { const n = await repairIntegrity(); toast(`${n} correction(s) effectuée(s)`); setIssues(await checkIntegrity()) }

  return (
    <>
      <div className="box">
        <h2>Sauvegarde complète</h2>
        <p>Un seul fichier contenant matières, dossiers, cartes, images, statistiques et historique. Conservez-le sur une clé USB ou un disque externe. La synchronisation ne remplace pas une sauvegarde.</p>
        <div className="actions"><button className="primary" onClick={create}>Créer une sauvegarde…</button></div>
        {dir && <p className="muted small">Des copies de sécurité automatiques sont aussi créées avant chaque restauration et chaque synchronisation : <button className="link" onClick={() => showItem(dir)}>ouvrir le dossier</button></p>}
      </div>
      <div className="box">
        <h2>Restauration</h2>
        <div className="actions"><button onClick={pick}>Choisir une sauvegarde…</button></div>
        {errors.length > 0 && <div className="alert err"><strong>Sauvegarde invalide :</strong><ul>{errors.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
        {pending && (
          <div className="alert ok">
            <p><strong>Sauvegarde vérifiée</strong> ({pending.name}) — créée le {new Date(pending.v.createdAt!).toLocaleString('fr-FR')} : {pending.v.counts!.cards} cartes, {pending.v.counts!.folders} dossiers, {pending.v.counts!.events} révisions, {pending.v.counts!.blobs} image(s).</p>
            {pending.v.warnings.map((w, i) => <p key={i}>{w}</p>)}
            <button className="danger" onClick={restore}>Restaurer…</button>
          </div>
        )}
      </div>
      <div className="box">
        <h2>Cohérence des données</h2>
        <div className="actions"><button onClick={check}>Vérifier la bibliothèque</button></div>
        {issues && (issues.length === 0 ? <div className="alert ok">Aucun problème détecté.</div> : (
          <div className="alert warn"><ul>{issues.slice(0, 10).map((i, k) => <li key={k}>{i.detail}</li>)}</ul>
            <button onClick={fix}>Réparer (rattacher au dossier « Récupéré »)</button></div>
        ))}
      </div>
    </>
  )
}

/* ============================ Synchronisation ============================ */

function SyncPanel() {
  const lib = useLibrary()
  const devices = useLiveQuery(() => db.devices.toArray(), [], [])
  const conflicts = useLiveQuery(() => db.conflicts.orderBy('createdAt').reverse().toArray(), [], [] as SyncConflict[])
  const [loaded, setLoaded] = useState<LoadedPackage | null>(null)
  const [plan, setPlan] = useState<SyncPlan | null>(null)
  const [choice, setChoice] = useState<Record<string, 'local' | 'remote'>>({})
  const [errors, setErrors] = useState<string[]>([])
  const [done, setDone] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [email, setEmail] = useState('')
  useEffect(() => { void getMeta<string>('syncEmail').then((v) => setEmail(v ?? '')) }, [])

  /** Mode « e-mail » : enregistre le fichier puis ouvre un brouillon adressé à l'adresse mémorisée. */
  const exportAndMail = async () => {
    await setMeta('syncEmail', email.trim())
    const f = await exportSyncFile()
    const p = await saveFile(f.name, f.bytes, 'Fichier de synchronisation', 'studysync')
    if (!p) return
    if (isDesktop()) {
      const body = `Fichier de synchronisation StudyDeck.\n\nJoignez le fichier enregistré ici : ${p}`
      window.open(`mailto:${encodeURIComponent(email.trim())}?subject=${encodeURIComponent('Synchronisation StudyDeck')}&body=${encodeURIComponent(body)}`)
      toast('Brouillon ouvert : joignez le fichier enregistré, puis envoyez.')
    } else toast('Choisissez « Mail » dans la feuille de partage' + (email.trim() ? ` et envoyez à ${email.trim()}` : ''))
  }

  const exportFile = async () => {
    const f = await exportSyncFile()
    const p = await saveFile(f.name, f.bytes, 'Fichier de synchronisation', 'studysync')
    if (p) toast('Fichier de synchronisation enregistré')
  }
  const importFile = async () => {
    const f = await openFile('Fichier de synchronisation', ['studysync', 'zip'])
    if (!f) return
    setDone(null)
    const r = await readSyncFile(f.data)
    if (!r.ok || !r.loaded) { setErrors(r.errors); setPlan(null); return }
    setErrors([])
    setLoaded(r.loaded); setPlan(await planImport(r.loaded)); setChoice({})
  }
  const conflictItems = plan?.items.filter((i) => i.action === 'conflict') ?? []
  const unresolved = conflictItems.filter((i) => !choice[i.key]).length
  const s = plan?.summary

  const apply = async () => {
    if (!loaded || !plan) return
    setBusy(true)
    try {
      const safety = await createBackup()
      await autoBackup(`avant-synchronisation-${stamp()}.studybackup`, safety.bytes)
      const r = await applyImport(loaded, plan, choice)
      const purged = await purgeTombstones()
      setDone(`Synchronisation appliquée : ${r.taken} élément(s) reçus, ${r.conflictsResolved} conflit(s) résolu(s), ${r.newEvents} révision(s) fusionnée(s)${r.repaired ? `, ${r.repaired} correction(s) de structure` : ''}${purged ? `, ${purged} suppression(s) définitivement confirmée(s)` : ''}.`)
      setPlan(null); setLoaded(null)
    } catch (e) { toast(`Rien n'a été modifié : ${(e as Error).message}`, 'err') }
    setBusy(false)
  }

  return (
    <>
      <WifiSync />

      <div className="box">
        <h2>Secours : synchroniser par fichier</h2>
        <p>La synchronisation est à la demande et sans cloud. Elle fusionne dans les deux sens : nouvelles cartes, modifications, suppressions et historique de révision. Rien n'est écrasé sans que vous le sachiez.</p>
        <ol className="how">
          <li>Sur l'appareil A : <strong>Créer mon fichier de synchronisation</strong>.</li>
          <li>Transférez le fichier vers l'appareil B (clé USB, messagerie…), puis sur B : <strong>Importer le fichier de l'autre appareil</strong>, vérifiez le résumé et confirmez.</li>
          <li>Sur B, créez à son tour votre fichier de synchronisation et importez-le sur A pour terminer l'échange.</li>
        </ol>
        <div className="actions"><button className="primary" onClick={exportFile}>Créer mon fichier de synchronisation…</button><button onClick={importFile}>Importer le fichier de l'autre appareil…</button></div>
        <details className="help"><summary>Préparer l'envoi par e-mail</summary>
          <p className="muted small">Un logiciel ne peut pas envoyer seul un fichier en pièce jointe sans stocker le mot de passe de votre messagerie, et le fichier contient toute votre bibliothèque (non chiffrée par e-mail). StudyDeck prépare donc le message : il enregistre le fichier et ouvre un brouillon adressé à l'adresse ci-dessous ; vous n'avez plus qu'à joindre le fichier et envoyer. Sur iPhone, la feuille de partage propose « Mail » avec le fichier déjà joint.</p>
          <label className="field"><span>Adresse e-mail de destination (facultatif)</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => void setMeta('syncEmail', email.trim())} placeholder="mon.adresse@exemple.fr" /></label>
          <div className="actions"><button onClick={exportAndMail}>Créer le fichier et préparer l'e-mail…</button></div>
        </details>
        <p className="muted small">Ce mode utilise exactement le même moteur que la synchronisation Wi-Fi ; il sert si les deux appareils ne peuvent pas communiquer directement.</p>
        {errors.length > 0 && <div className="alert err">{errors.map((e, i) => <div key={i}>{e}</div>)}</div>}
        {done && <div className="alert ok">{done}<div className="actions"><button onClick={exportFile}>Créer ma réponse pour l'autre appareil…</button></div></div>}
      </div>

      {plan && s && (
        <Modal wide title={`Synchronisation avec « ${plan.peer.name} »`} onClose={() => setPlan(null)}
          footer={<><span className="muted grow">{unresolved ? `${unresolved} conflit(s) à résoudre` : 'Prêt à appliquer'}</span><button onClick={() => setPlan(null)}>Annuler</button><button className="primary" disabled={unresolved > 0 || busy} onClick={apply}>Appliquer la synchronisation</button></>}>
          <PlanView plan={plan} choice={choice} setChoice={setChoice} />
        </Modal>
      )}

      <div className="box">
        <h2>Appareils connus</h2>
        <ul className="plain">{devices.map((d) => <li key={d.id}>{d.name}{d.isSelf && ' (cet appareil)'} <span className="muted">— {d.lastSyncAt ? `dernière synchronisation le ${new Date(d.lastSyncAt).toLocaleString('fr-FR')}` : 'jamais synchronisé'}</span></li>)}</ul>
      </div>

      <div className="box">
        <h2>Versions écartées lors de conflits</h2>
        {conflicts.length === 0 ? <p className="muted">Aucune.</p> : (
          <ul className="plain">
            {conflicts.slice(0, 30).map((c) => {
              const dis = (c.chosen === 'local' ? c.remote : c.local) as Folder | Card | null
              const text = dis ? (c.kind === 'card' ? plainPreview((dis as Card).front, 90) : (dis as Folder).name) : '—'
              return (
                <li key={c.id}>
                  {new Date(c.createdAt).toLocaleDateString('fr-FR')} · {c.kind === 'card' ? 'Carte' : 'Dossier'} · version {c.chosen === 'local' ? `de « ${c.peerName} »` : 'de cet appareil'} écartée : « {text} »{' '}
                  {c.recovered ? <span className="tag ok">Restaurée</span> : <button className="small" onClick={async () => { try { await recoverConflict(c.id); toast('Version restaurée') } catch (e) { toast((e as Error).message, 'err') } }}>Restaurer cette version</button>}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </>
  )
}

/* ============================ Appareil ============================ */

function DevicePanel() {
  const [name, setName] = useState('')
  const [info, setInfo] = useState<{ version: string; userData: string } | null>(null)
  useEffect(() => { void selfName().then(setName); void appInfo().then(setInfo) }, [])
  return (
    <div className="box">
      <h2>Cet appareil</h2>
      <label className="field"><span>Nom affiché lors des synchronisations</span><input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => renameSelf(name).then(() => toast('Nom enregistré'))} /></label>
      {info && <dl className="kv"><dt>Version</dt><dd>{info.version}</dd>{info.userData && <><dt>Données</dt><dd className="mono">{info.userData}</dd></>}</dl>}
      <p className="muted small">Toutes vos données restent sur cet appareil. Aucun compte, aucun service en ligne.</p>
    </div>
  )
}
