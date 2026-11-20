import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { createBackup } from '../exchange/backup'
import { autoBackup } from '../platform/files'
import { decodePairing, DECODE_MESSAGES, extractCode, formatCode, normalizeCode, shareText } from '../sync/pairing'
import { describePath, joinHost, startHost, type GuestHandle, type HostHandle } from '../sync/rtc'
import { runSession, type LiveUi, type Mode, type Resolutions } from '../sync/live'
import { Wire } from '../sync/wire'
import type { SyncPlan } from '../sync/engine'
import { PlanView } from './PlanView'
import { QrScanner } from './QrScanner'
import { toast } from './dialogs'

type Phase = 'idle' | 'host-code' | 'guest-input' | 'guest-code' | 'linking' | 'running' | 'review' | 'done' | 'error'
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text) } catch {
    const ta = document.createElement('textarea')
    ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove()
  }
  toast('Code copié : collez-le dans une messagerie')
}

function CodeActions({ code }: { code: string }) {
  const canShare = typeof navigator.share === 'function'
  return (
    <div className="actions">
      <button className="primary" onClick={() => copyText(shareText(code))}>Copier le code</button>
      {canShare && <button onClick={() => navigator.share({ text: shareText(code) }).catch(() => undefined)}>Partager…</button>}
    </div>
  )
}

function CodeBlock({ code }: { code: string }) {
  const groups = formatCode(code).split('-')
  return <div className="code-groups" aria-label="Code à saisir">{groups.map((g, i) => <span key={i}>{g}</span>)}</div>
}

export function WifiSync() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [mode, setMode] = useState<Mode>('sync')
  const [role, setRole] = useState<'host' | 'guest'>('host')
  const [code, setCode] = useState('')
  const [qr, setQr] = useState('')
  const [typed, setTyped] = useState('')
  const [scan, setScan] = useState(false)
  const [scanError, setScanError] = useState('')
  const [status, setStatus] = useState('')
  const [plan, setPlan] = useState<SyncPlan | null>(null)
  const [choice, setChoice] = useState<Resolutions>({})
  const [result, setResult] = useState('')
  const [error, setError] = useState('')
  const [path, setPath] = useState('')
  const [deadline, setDeadline] = useState(0)
  const [tick, setTick] = useState(0)

  const hostRef = useRef<HostHandle | null>(null)
  const guestRef = useRef<GuestHandle | null>(null)
  const wireRef = useRef<Wire | null>(null)
  const releaseCam = useRef<(() => void) | null>(null)
  const decision = useRef<((r: Resolutions | null) => void) | null>(null)
  const busy = useRef(false)

  const cleanup = () => {
    hostRef.current?.cancel(); guestRef.current?.cancel(); wireRef.current?.close()
    releaseCam.current?.(); releaseCam.current = null
    hostRef.current = guestRef.current = wireRef.current = null
    decision.current?.(null); decision.current = null
    busy.current = false
  }
  useEffect(() => cleanup, [])
  useEffect(() => {
    if (phase !== 'guest-code') return
    const t = setInterval(() => setTick((x) => x + 1), 1000)
    return () => clearInterval(t)
  }, [phase])
  const reset = () => { cleanup(); setPhase('idle'); setCode(''); setQr(''); setTyped(''); setScan(false); setScanError(''); setPlan(null); setChoice({}); setResult(''); setError(''); setStatus(''); setPath('') }
  const fail = (e: unknown) => { cleanup(); setError((e as Error).message || String(e)); setPhase('error') }

  const ui: LiveUi = {
    status: setStatus,
    plan: (p) => { setPlan(p); setChoice({}); setPhase('review') },
    askDecision: (p) => new Promise<Resolutions | null>((resolve) => { decision.current = resolve; void p }),
    beforeApply: async () => {
      const b = await createBackup()
      await autoBackup(`avant-synchronisation-${stamp()}.studybackup`, b.bytes)
    },
    done: (text) => { setResult(text); setPhase('done'); releaseCam.current?.(); wireRef.current?.close() },
  }

  /** Lance le protocole une fois le canal ouvert. */
  const launch = async (wire: Wire, pc: RTCPeerConnection, r: 'host' | 'guest') => {
    wireRef.current = wire
    setPath(await describePath(pc))
    setPhase('running'); setStatus('Connexion établie. Identification de l\'autre appareil…')
    try { await runSession(wire, r, ui, mode) } catch (e) { fail(e) }
  }

  /* ---------------------------- Hôte ---------------------------- */
  const startAsHost = async () => {
    setRole('host'); setError('')
    try {
      const h = await startHost()
      hostRef.current = h
      setCode(h.code)
      setQr(await QRCode.toDataURL(h.code, { errorCorrectionLevel: 'L', margin: 2, width: 360 }))
      setPhase('host-code')
    } catch (e) { fail(e) }
  }
  const onAnswerTyped = (text: string) => {
    setTyped(text)
    const code = extractCode(text)
    const r = decodePairing(code)
    if (r.ok && r.info.role === 'answer' && hostRef.current && !busy.current) {
      busy.current = true
      setPhase('linking'); setStatus('Connexion en cours…')
      hostRef.current.accept(code).then(({ channel, pc }) => launch(new Wire(channel), pc, 'host')).catch(fail)
    }
  }

  /* ---------------------------- Invité ---------------------------- */
  const joinWith = async (text: string) => {
    if (busy.current) return
    busy.current = true
    setRole('guest'); setError(''); setPhase('linking'); setStatus('Préparation de la réponse…')
    try {
      const g = await joinHost(text)
      guestRef.current = g
      setCode(g.code); setScan(false)
      releaseCam.current?.(); releaseCam.current = null // la caméra n'est plus nécessaire
      setDeadline(Date.now() + 180_000); setPhase('guest-code')
      const { channel, pc } = await g.connected()
      await launch(new Wire(channel), pc, 'guest')
    } catch (e) { fail(e) }
  }
  const onOfferTyped = (text: string) => {
    setTyped(text)
    const code = extractCode(text)
    const r = decodePairing(code)
    if (r.ok && r.info.role === 'offer') void joinWith(code)
  }
  const paste = async (apply: (t: string) => void) => {
    try { apply(await navigator.clipboard.readText()) } catch { toast('Collez le code dans la zone avec un appui long (ou Ctrl+V).', 'err') }
  }
  // Retour sur la fenêtre : si le presse-papiers contient un code de réponse valide, on le prend automatiquement
  const answerRef = useRef(onAnswerTyped)
  answerRef.current = onAnswerTyped
  useEffect(() => {
    if (phase !== 'host-code') return
    const onFocus = () => {
      navigator.clipboard.readText().then((t) => {
        const r = decodePairing(extractCode(t))
        if (r.ok && r.info.role === 'answer') answerRef.current(t)
      }).catch(() => undefined)
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [phase])

  const typedCode = extractCode(typed)
  const typedState = typed ? decodePairing(typedCode) : null
  const typedMsg = typedState && !typedState.ok ? DECODE_MESSAGES[typedState.error] : ''

  const confirm = () => { decision.current?.(choice); decision.current = null; setPhase('running'); setStatus('Application…') }
  const cancelDecision = () => { decision.current?.(null); decision.current = null }
  const unresolved = plan ? plan.items.filter((i) => i.action === 'conflict' && !choice[i.key]).length : 0

  return (
    <div className="box">
      <h2>Synchronisation Wi-Fi directe</h2>

      {phase === 'idle' && (
        <>
          <p>Les deux appareils échangent directement leurs données, sans Internet ni serveur : sur le même Wi-Fi, ou sur le <strong>partage de connexion de l'iPhone</strong> auquel le PC est connecté. Rien ne part vers un service extérieur.</p>
          <div className="wifi-roles">
            <div className="role-card">
              <h3>1. Démarrer</h3>
              <p className="muted small">À faire sur l'appareil qui décide (le PC). Il affiche un QR code et un code.</p>
              <label className="field"><span>Action</span>
                <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
                  <option value="sync">Synchroniser les bibliothèques</option>
                  <option value="test">Tester la connexion seulement</option>
                </select></label>
              <button className="primary" onClick={startAsHost}>Afficher le code</button>
            </div>
            <div className="role-card">
              <h3>2. Rejoindre</h3>
              <p className="muted small">À faire sur l'autre appareil (l'iPhone) : scanner le QR ou saisir le code.</p>
              <div className="actions">
                <button className="primary" onClick={() => { setRole('guest'); setScan(true); setScanError(''); setTyped(''); setPhase('guest-input') }}>Scanner le QR code</button>
                <button onClick={() => { setRole('guest'); setScan(false); setTyped(''); setPhase('guest-input') }}>Saisir le code</button>
              </div>
            </div>
          </div>
        </>
      )}

      {phase === 'host-code' && (
        <>
          <p><strong>Étape 1.</strong> Sur l'autre appareil, choisissez « Rejoindre », puis scannez ce QR code (ou saisissez le code en dessous).</p>
          <div className="qr-wrap"><img src={qr} alt="QR code de connexion" width={260} height={260} /></div>
          <details><summary>Code à saisir si le scan est impossible</summary><CodeBlock code={code} /></details>
          <p><strong>Étape 2.</strong> L'autre appareil affiche alors un <strong>code de réponse</strong>. Tapez-le ici, ou copiez le message reçu et cliquez sur « Coller » (le code est aussi détecté automatiquement quand vous revenez sur cette fenêtre) :</p>
          <textarea className="mono code-input" rows={3} value={typed} autoFocus placeholder="K7QP-2MXA-…" spellCheck={false} autoCapitalize="characters"
            onChange={(e) => onAnswerTyped(e.target.value)} />
          <div className="muted small">{typed && (typedState?.ok ? (typedState.info.role === 'answer' ? 'Code valide.' : 'Ceci est le code de départ : saisissez le code de RÉPONSE affiché par l\'autre appareil.') : `${typedMsg} (${normalizeCode(typedCode).length} caractères saisis)`)}</div>
          <div className="actions"><button className="primary" onClick={() => paste(onAnswerTyped)}>Coller le code</button><button onClick={reset}>Annuler</button></div>
        </>
      )}

      {phase === 'guest-input' && (
        <>
          {scan ? (
            <>
              <p>Pointez la caméra vers le QR code affiché sur l'autre appareil.</p>
              <QrScanner onCode={(c, release) => { releaseCam.current = release; void joinWith(c) }} onError={(m) => { setScanError(m); setScan(false) }} />
            </>
          ) : (
            <>
              {scanError && <div className="alert warn">{scanError}</div>}
              <p>Saisissez le code affiché sur l'autre appareil (sous le QR code, « Code à saisir »).</p>
              <textarea className="mono code-input" rows={3} value={typed} autoFocus placeholder="K7QP-2MXA-…" spellCheck={false} autoCapitalize="characters"
                onChange={(e) => onOfferTyped(e.target.value)} />
              <div className="muted small">{typed && (typedState?.ok ? (typedState.info.role === 'offer' ? 'Code valide.' : 'Ceci est un code de réponse : saisissez le code de DÉPART.') : `${typedMsg} (${normalizeCode(typedCode).length} caractères saisis)`)}</div>
            </>
          )}
          <div className="actions">
            {!scan && <button className="primary" onClick={() => paste(onOfferTyped)}>Coller le code</button>}
            {scan && <button onClick={() => { releaseCam.current?.(); setScan(false) }}>Saisir le code à la main</button>}
            <button onClick={reset}>Annuler</button>
          </div>
        </>
      )}

      {phase === 'guest-code' && (
        <>
          <p><strong>Code de réponse :</strong> envoyez-le à l'autre appareil (zone « Étape 2 ») : copiez-le puis collez-le dans une messagerie, ou tapez-le. La connexion démarre dès qu'il est correctement reçu.</p>
          <CodeActions code={code} />
          <CodeBlock code={code} />
          {(() => { void tick; const left = Math.max(0, Math.round((deadline - Date.now()) / 1000)); return <p className="muted">{left > 0 ? `En attente de l'autre appareil… il reste ${Math.floor(left / 60)} min ${String(left % 60).padStart(2, '0')} s.` : 'Délai dépassé : recommencez.'}</p> })()}
          <div className="actions"><button onClick={reset}>Annuler</button></div>
        </>
      )}

      {phase === 'linking' && <p className="muted">{status || 'Connexion…'}</p>}

      {phase === 'running' && (
        <>
          <p>{status}</p>
          {path && <p className="muted small">Chemin réseau : {path}</p>}
          <div className="actions"><button onClick={reset}>Interrompre</button></div>
        </>
      )}

      {phase === 'review' && plan && (
        <>
          <div className="alert ok">Données reçues de « {plan.peer.name} ». {role === 'host' ? 'Vérifiez le résumé, résolvez les conflits éventuels, puis confirmez.' : 'En attente de la confirmation sur l\'autre appareil (c\'est lui qui tranche les conflits).'}</div>
          <PlanView plan={plan} choice={choice} setChoice={setChoice} readOnly={role === 'guest'} />
          {role === 'host' ? (
            <div className="actions">
              <button className="primary" disabled={unresolved > 0} onClick={confirm}>Appliquer la synchronisation sur les deux appareils</button>
              <button onClick={() => { cancelDecision(); toast('Synchronisation annulée') }}>Annuler</button>
              {unresolved > 0 && <span className="muted small">{unresolved} conflit(s) à résoudre</span>}
            </div>
          ) : <div className="actions"><span className="muted">{status}</span><button onClick={reset}>Interrompre</button></div>}
        </>
      )}

      {phase === 'done' && (
        <>
          <div className="alert ok">{result}</div>
          <div className="actions"><button className="primary" onClick={reset}>Terminer</button></div>
        </>
      )}

      {phase === 'error' && (
        <>
          <div className="alert err"><strong>La synchronisation n'a pas abouti.</strong><div>{error}</div>
            <div className="muted small">Vos données n'ont pas été modifiées par cette tentative (ou l'ont été de façon complète et cohérente).</div></div>
          <div className="actions"><button className="primary" onClick={reset}>Recommencer</button></div>
        </>
      )}
    </div>
  )
}
