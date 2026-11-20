import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { deleteCard } from '../domain/folders'
import { LEVELS } from '../review/levels'
import { answerCard, cardsInScope, dueCardsInScope, endSession, scopeLabel, startSession, undoLast, type LiveSession } from '../review/service'
import { CardEditor } from './Editor'
import { Rich } from './Rich'
import { FolderSelect, useLibrary } from './store'
import { confirmAsk, toast } from './dialogs'

type Phase = 'setup' | 'run' | 'summary'
interface Summary { selected: number; correct: number; incorrect: number; attempts: number; consulted: number; rate: number; ms: number; label: string; finished: boolean; archived: string[] }

const fmtDur = (ms: number) => {
  const s = Math.round(ms / 1000)
  return s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s` : `${s} s`
}

export function Review({ initialScope, autoStart, onDone }: { initialScope?: string | null; autoStart?: 'due' | null; onDone: () => void }) {
  const lib = useLibrary()
  const [phase, setPhase] = useState<Phase>('setup')
  const [scope, setScope] = useState<string | null>(initialScope ?? null)
  const [session, setSession] = useState<LiveSession | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [label, setLabel] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [, force] = useReducer((x: number) => x + 1, 0)
  const lock = useRef(false)
  // Geste tactile : glisser vers la droite = correct, vers la gauche = incorrect
  const [dx, setDx] = useState(0)
  const drag = useRef<{ x: number; y: number; horizontal: boolean | null; dx: number } | null>(null)
  const SWIPE_MIN = 120

  const scopeCards = lib.cards.filter((c) => {
    if (scope === null) return true
    let cur = lib.byId.get(c.folderId)
    let g = 0
    while (cur && g++ < 100) { if (cur.id === scope) return true; cur = cur.parentId ? lib.byId.get(cur.parentId) : undefined }
    return false
  })
  const learningCards = scopeCards.filter((c) => lib.stats.cards.get(c.id)?.kind === 'learning')
  const dueCount = scopeCards.filter((c) => lib.stats.cards.get(c.id)?.due).length
  const otherCount = scopeCards.length - learningCards.length

  const begin = useCallback(async (mode: 'due' | 'free') => {
    const cards = mode === 'due' ? await dueCardsInScope(scope) : await cardsInScope(scope)
    if (!cards.length) { toast('Aucune carte à réviser dans ce périmètre.', 'err'); return }
    try {
      const s = await startSession(scope, mode, cards.map((c) => c.id))
      setLabel(await scopeLabel(scope))
      setSession(s); setRevealed(false); setPhase('run')
    } catch (e) { toast((e as Error).message, 'err') }
  }, [scope])

  const auto = useRef(false)
  useEffect(() => {
    if (autoStart && !auto.current && lib.ready) { auto.current = true; void begin(autoStart) }
  }, [autoStart, lib.ready, begin])

  const finish = useCallback(async (s: LiveSession, finished: boolean) => {
    const { session: rec, archived } = await endSession(s)
    if (archived.length) toast(`Bravo ! « ${archived.join(', ')} » : toutes les étapes sont réussies, la matière passe en archive.`)
    setSummary({
      selected: s.logic.selected, correct: s.logic.correct, incorrect: s.logic.incorrect, attempts: s.logic.attempts,
      consulted: s.logic.consulted, rate: s.logic.successRate, ms: (rec?.endedAt ?? Date.now()) - s.startedAt, label, finished, archived,
    })
    setPhase('summary')
  }, [label])

  const answer = useCallback(async (correct: boolean) => {
    if (!session || lock.current) return
    lock.current = true
    setBusy(true)
    try {
      await answerCard(session, correct)
      setRevealed(false)
      if (session.logic.finished) await finish(session, true)
      else force()
    } catch (e) { toast((e as Error).message, 'err') }
    lock.current = false
    setBusy(false)
  }, [session, finish])

  /** Retour à la carte précédente (annule la dernière réponse). */
  const undo = useCallback(async () => {
    if (!session || lock.current || !session.logic.canUndo) return
    lock.current = true
    setBusy(true)
    try { if (await undoLast(session)) { setRevealed(true); force() } } catch (e) { toast((e as Error).message, 'err') }
    lock.current = false
    setBusy(false)
  }, [session])

  const quit = async () => {
    if (!session) return
    if (session.logic.attempts === 0 || (await confirmAsk({ title: 'Arrêter la session ?', message: 'Vos réponses déjà données sont conservées. Les cartes restantes ne seront pas comptées.', okLabel: 'Arrêter la session' }))) {
      await finish(session, false)
    }
  }

  const pres = session?.logic.current()
  const card = pres ? lib.cards.find((c) => c.id === pres.cardId) : undefined

  const remove = async () => {
    if (!session || !card) return
    if (!(await confirmAsk({ title: 'Supprimer cette carte ?', message: 'La carte est supprimée de la bibliothèque et retirée de la session.', danger: true, okLabel: 'Supprimer' }))) return
    await deleteCard(card.id)
    session.logic.skipCurrent()
    setRevealed(false)
    if (session.logic.finished) await finish(session, true)
    else force()
  }

  // Raccourcis clavier (ignorés pendant la saisie de texte ou l'édition)
  useEffect(() => {
    if (phase !== 'run' || editing) return
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
      if (document.querySelector('.overlay')) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key.toLowerCase() === 'z') { e.preventDefault(); void undo(); return }
      if (!revealed) {
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setRevealed(true) }
      } else if (pres && !pres.graded) {
        if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Enter') { e.preventDefault(); void answer(true) }
      } else if (e.key === 'ArrowRight') { e.preventDefault(); void answer(true) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); void answer(false) }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [phase, revealed, answer, undo, editing, pres])

  useEffect(() => {
    // Carte supprimée ailleurs pendant la session : on la passe sans l'enregistrer
    if (session && pres && !card && lib.ready) {
      session.logic.skipCurrent()
      if (session.logic.finished) void finish(session, true)
      else force()
    }
  }, [session, pres, card, lib.ready, finish])

  /* ------------------------------ Configuration ------------------------------ */
  if (phase === 'setup') {
    return (
      <div className="page narrow">
        <h1>Révision</h1>
        <div className="box">
          <label className="field"><span>Périmètre</span>
            <FolderSelect value={scope} onChange={setScope} rootLabel="Toute la bibliothèque" />
          </label>
          <p className="muted">Les cartes des sous-dossiers sont incluses automatiquement.</p>
          <div className="figures">
            <div><b>{scopeCards.length}</b><span>cartes</span></div>
            <div><b>{dueCount}</b><span>à réviser</span></div>
            <div><b>{learningCards.filter((c) => !lib.stats.cards.get(c.id)?.reviewed).length}</b><span>jamais révisées</span></div>
          </div>
          <div className="actions">
            <button className="primary big" disabled={!dueCount} onClick={() => begin('due')}>Réviser les cartes dues ({dueCount})</button>
            <button className="big" disabled={!scopeCards.length} onClick={() => begin('free')}>Révision libre ({scopeCards.length})</button>
          </div>
          <p className="muted small">« Dues » : cartes en apprentissage jamais révisées ou dont l'échéance est arrivée. « Libre » : toutes les cartes du périmètre ; une révision anticipée est enregistrée mais ne fait pas avancer l'étape de la carte.{otherCount > 0 && ` ${otherCount} carte(s) en Loisir/Archive sont simplement consultées, sans notation.`}</p>
        </div>
      </div>
    )
  }

  /* ------------------------------ Bilan ------------------------------ */
  if (phase === 'summary' && summary) {
    return (
      <div className="page narrow">
        <h1>{summary.finished ? 'Session terminée' : 'Session arrêtée'}</h1>
        <p className="muted">{summary.label}</p>
        <div className="box">
          {summary.archived.length > 0 && <div className="alert ok">🎉 « {summary.archived.join(', ')} » : toutes les étapes sont réussies. La matière passe en archive.</div>}
          <div className="figures">
            <div><b>{summary.selected}</b><span>cartes sélectionnées</span></div>
            <div><b>{summary.attempts}</b><span>tentatives</span></div>
            <div><b className="okc">{summary.correct}</b><span>correctes</span></div>
            <div><b className="badc">{summary.incorrect}</b><span>incorrectes</span></div>
            <div><b>{summary.attempts ? `${Math.round(summary.rate * 100)} %` : '—'}</b><span>taux de réussite</span></div>
            {summary.consulted > 0 && <div><b>{summary.consulted}</b><span>consultées (sans notation)</span></div>}
            <div><b>{fmtDur(summary.ms)}</b><span>durée</span></div>
          </div>
          <p className="muted">Vos résultats ont été enregistrés et l'étape de chaque carte a été mise à jour.</p>
          <div className="actions">
            <button className="primary" onClick={() => { setSession(null); setSummary(null); setPhase('setup') }}>Nouvelle session</button>
            <button onClick={onDone}>Retour à l'accueil</button>
          </div>
        </div>
      </div>
    )
  }

  /* ------------------------------ Session ------------------------------ */
  if (!session || !pres || !card) return <div className="page"><p className="muted">Chargement…</p></div>
  const L = session.logic
  const progress = L.selected ? (L.completed / L.selected) * 100 : 0
  const cs = lib.stats.cards.get(card.id)

  return (
    <div className="run">
      <div className="run-top">
        <div className="grow">
          <div className="run-title">{label}</div>
          <div className="progress" role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${progress}%` }} /></div>
          <div className="muted small">{L.completed} / {L.selected} terminées · {L.remainingNew} à voir · {L.remainingRetry} à reprendre{pres.kind === 'retry' && ' · reprise d\'une carte manquée'}</div>
        </div>
        <button onClick={quit}>Arrêter</button>
      </div>

      <div className="run-tools">
        <button className="small" disabled={!L.canUndo || busy} onClick={undo} title="Annuler la dernière réponse (touche Z)">← Carte précédente</button>
        <button className="small" onClick={() => setEditing(card.id)}>Modifier</button>
        <button className="small danger-outline" onClick={remove}>Supprimer</button>
        <span className="grow" />
        {pres.graded
          ? <span className="tag" title="Étape d'apprentissage de la carte">Étape {Math.min(LEVELS, cs?.level ?? 1)}/{LEVELS}</span>
          : <span className="tag">Consultation · sans notation</span>}
      </div>

      <div
        className={`flash ${revealed ? 'revealed' : ''} ${dx > 40 ? 'swipe-ok' : dx < -40 ? 'swipe-bad' : ''}`}
        style={dx ? { transform: `translateX(${dx}px) rotate(${dx / 40}deg)` } : undefined}
        onPointerDown={(e) => { if (revealed && !busy && e.pointerType !== 'mouse') drag.current = { x: e.clientX, y: e.clientY, horizontal: null, dx: 0 } }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          const mx = e.clientX - d.x, my = e.clientY - d.y
          if (d.horizontal === null && (Math.abs(mx) > 12 || Math.abs(my) > 12)) d.horizontal = Math.abs(mx) > Math.abs(my) * 1.5
          if (d.horizontal) { d.dx = mx; setDx(mx) }
        }}
        onPointerUp={() => {
          const d = drag.current; drag.current = null
          setDx(0)
          if (d?.horizontal && Math.abs(d.dx) >= SWIPE_MIN) void answer(pres.graded ? d.dx > 0 : true)
        }}
        onPointerCancel={() => { drag.current = null; setDx(0) }}
      >
        {pres.graded && dx > 40 && <div className="swipe-label ok">Correct</div>}
        {pres.graded && dx < -40 && <div className="swipe-label bad">Incorrect</div>}
        <div className="face-label">Recto</div>
        <div className="face big-face"><Rich text={card.front} /></div>
        {revealed && (<>
          <div className="face-label sep">Verso</div>
          <div className="face big-face answer"><Rich text={card.back} /></div>
        </>)}
        {revealed && pres.graded && <div className="muted small swipe-hint">Glissez la carte vers la droite (correct) ou la gauche (incorrect), ou utilisez les boutons.</div>}
      </div>

      <div className="run-actions">
        {!revealed ? (
          <button className="primary big" onClick={() => setRevealed(true)}>Afficher la réponse <kbd>Espace</kbd></button>
        ) : pres.graded ? (
          <>
            <button className="bad big" disabled={busy} onClick={() => answer(false)}>Incorrect <kbd>←</kbd></button>
            <button className="good big" disabled={busy} onClick={() => answer(true)}>Correct <kbd>→</kbd></button>
          </>
        ) : (
          <button className="primary big" disabled={busy} onClick={() => answer(true)}>Suivant <kbd>→</kbd></button>
        )}
      </div>

      {editing && <CardEditor cardId={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
