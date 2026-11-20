import { useEffect, useRef, useState } from 'react'
import { LEVELS, levelName } from '../review/levels'
import { FolderSelect } from './store'

type Req =
  | { kind: 'level'; title: string; message: string; initial: number; okLabel: string; resolve: (v: number | null) => void }
  | { kind: 'confirm'; title: string; message: string; okLabel: string; danger: boolean; resolve: (v: boolean) => void }
  | { kind: 'prompt'; title: string; label: string; initial: string; okLabel: string; resolve: (v: string | null) => void }
  | { kind: 'folder'; title: string; rootLabel?: string; exclude?: string; initial: string | null; okLabel: string; resolve: (v: { id: string | null } | null) => void }

let push: ((r: Req) => void) | null = null
let toastPush: ((m: string, kind: 'ok' | 'err') => void) | null = null

export const confirmAsk = (o: { title?: string; message: string; okLabel?: string; danger?: boolean }) =>
  new Promise<boolean>((resolve) => push?.({ kind: 'confirm', title: o.title ?? 'Confirmation', message: o.message, okLabel: o.okLabel ?? 'Confirmer', danger: !!o.danger, resolve }))

export const promptAsk = (o: { title: string; label?: string; initial?: string; okLabel?: string }) =>
  new Promise<string | null>((resolve) => push?.({ kind: 'prompt', title: o.title, label: o.label ?? 'Nom', initial: o.initial ?? '', okLabel: o.okLabel ?? 'Valider', resolve }))

/** Retourne { id } (id = null pour la racine) ou null si annulé. */
export const folderAsk = (o: { title: string; rootLabel?: string; exclude?: string; initial?: string | null; okLabel?: string }) =>
  new Promise<{ id: string | null } | null>((resolve) => push?.({ kind: 'folder', title: o.title, rootLabel: o.rootLabel, exclude: o.exclude, initial: o.initial ?? null, okLabel: o.okLabel ?? 'Choisir', resolve }))

/** Choix d'une étape d'apprentissage (1 à 6) ; null si annulé. */
export const levelAsk = (o: { title: string; message?: string; initial?: number; okLabel?: string }) =>
  new Promise<number | null>((resolve) => push?.({ kind: 'level', title: o.title, message: o.message ?? '', initial: o.initial ?? 1, okLabel: o.okLabel ?? 'Valider', resolve }))

export const toast = (message: string, kind: 'ok' | 'err' = 'ok') => toastPush?.(message, kind)

export function Modal({ title, children, onClose, wide, footer }: {
  title: string; children: React.ReactNode; onClose?: () => void; wide?: boolean; footer?: React.ReactNode
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && onClose) onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.() }}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head"><h2>{title}</h2>{onClose && <button className="ghost" onClick={onClose} aria-label="Fermer">✕</button>}</header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  )
}

export function DialogHost() {
  const [queue, setQueue] = useState<Req[]>([])
  const [toasts, setToasts] = useState<{ id: number; m: string; kind: 'ok' | 'err' }[]>([])
  const [text, setText] = useState('')
  const [folder, setFolder] = useState<string | null>(null)
  const [level, setLevel] = useState(1)
  const idRef = useRef(0)

  useEffect(() => {
    push = (r) => setQueue((q) => [...q, r])
    toastPush = (m, kind) => {
      const id = ++idRef.current
      setToasts((t) => [...t, { id, m, kind }])
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'err' ? 7000 : 3500)
    }
    return () => { push = null; toastPush = null }
  }, [])

  const cur = queue[0]
  useEffect(() => {
    if (!cur) return
    if (cur.kind === 'prompt') setText(cur.initial)
    if (cur.kind === 'folder') setFolder(cur.initial)
    if (cur.kind === 'level') setLevel(cur.initial)
  }, [cur])
  const done = () => setQueue((q) => q.slice(1))

  return (
    <>
      {cur?.kind === 'confirm' && (
        <Modal title={cur.title} onClose={() => { cur.resolve(false); done() }}
          footer={<>
            <button onClick={() => { cur.resolve(false); done() }}>Annuler</button>
            <button className={cur.danger ? 'danger' : 'primary'} autoFocus onClick={() => { cur.resolve(true); done() }}>{cur.okLabel}</button>
          </>}>
          <p className="pre">{cur.message}</p>
        </Modal>
      )}
      {cur?.kind === 'prompt' && (
        <Modal title={cur.title} onClose={() => { cur.resolve(null); done() }}
          footer={<>
            <button onClick={() => { cur.resolve(null); done() }}>Annuler</button>
            <button className="primary" disabled={!text.trim()} onClick={() => { cur.resolve(text.trim()); done() }}>{cur.okLabel}</button>
          </>}>
          <label className="field"><span>{cur.label}</span>
            <input autoFocus value={text} onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) { cur.resolve(text.trim()); done() } }} />
          </label>
        </Modal>
      )}
      {cur?.kind === 'level' && (
        <Modal title={cur.title} onClose={() => { cur.resolve(null); done() }}
          footer={<>
            <button onClick={() => { cur.resolve(null); done() }}>Annuler</button>
            <button className="primary" onClick={() => { cur.resolve(level); done() }}>{cur.okLabel}</button>
          </>}>
          {cur.message && <p className="pre">{cur.message}</p>}
          <label className="field"><span>Étape d'apprentissage</span>
            <select value={level} onChange={(e) => setLevel(Number(e.target.value))}>
              {Array.from({ length: LEVELS }, (_, i) => i + 1).map((l) => <option key={l} value={l}>{levelName(l)}</option>)}
            </select>
          </label>
        </Modal>
      )}
      {cur?.kind === 'folder' && (
        <Modal title={cur.title} onClose={() => { cur.resolve(null); done() }}
          footer={<>
            <button onClick={() => { cur.resolve(null); done() }}>Annuler</button>
            <button className="primary" disabled={folder === null && cur.rootLabel === undefined} onClick={() => { cur.resolve({ id: folder }); done() }}>{cur.okLabel}</button>
          </>}>
          <label className="field"><span>Destination</span>
            <FolderSelect value={folder} onChange={setFolder} rootLabel={cur.rootLabel} excludeSubtreeOf={cur.exclude} />
          </label>
        </Modal>
      )}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.m}</div>)}
      </div>
    </>
  )
}
