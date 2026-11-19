import { useRef, useState } from 'react'
import { createCard, updateCard } from '../domain/folders'
import { imageFileToStored } from '../domain/media'
import { Modal, confirmAsk, toast } from './dialogs'
import { Rich } from './Rich'
import { FolderSelect, useLibrary } from './store'
import { db } from '../db/db'
import { moveCard } from '../domain/folders'

type Field = 'front' | 'back'

const TABLE = '\n| Colonne 1 | Colonne 2 | Colonne 3 |\n| --- | --- | --- |\n| a | b | c |\n| d | e | f |\n'

export function CardEditor({ cardId, folderId, onClose, onSaved }: {
  cardId?: string; folderId?: string; onClose: () => void; onSaved?: (id: string) => void
}) {
  const lib = useLibrary()
  const existing = cardId ? lib.cards.find((c) => c.id === cardId) : undefined
  const [front, setFront] = useState(existing?.front ?? '')
  const [back, setBack] = useState(existing?.back ?? '')
  const [folder, setFolder] = useState<string | null>(existing?.folderId ?? folderId ?? null)
  const [active, setActive] = useState<Field>('front')
  const [busy, setBusy] = useState(false)
  const refs = { front: useRef<HTMLTextAreaElement>(null), back: useRef<HTMLTextAreaElement>(null) }
  const fileRef = useRef<HTMLInputElement>(null)
  const dirty = front !== (existing?.front ?? '') || back !== (existing?.back ?? '') || folder !== (existing?.folderId ?? folderId ?? null)
  const valid = front.trim() && back.trim() && folder

  const get = (f: Field) => (f === 'front' ? front : back)
  const set = (f: Field, v: string) => (f === 'front' ? setFront(v) : setBack(v))

  /** Modifie le champ actif en gardant la sélection. */
  const edit = (fn: (v: string, s: number, e: number) => { v: string; s: number; e: number }) => {
    const ta = refs[active].current
    const v = get(active)
    const r = fn(v, ta?.selectionStart ?? v.length, ta?.selectionEnd ?? v.length)
    set(active, r.v)
    requestAnimationFrame(() => { ta?.focus(); ta?.setSelectionRange(r.s, r.e) })
  }
  const wrap = (before: string, after: string, placeholder: string) =>
    edit((v, s, e) => {
      const sel = v.slice(s, e) || placeholder
      return { v: v.slice(0, s) + before + sel + after + v.slice(e), s: s + before.length, e: s + before.length + sel.length }
    })
  const linePrefix = (prefix: string | ((i: number) => string)) =>
    edit((v, s, e) => {
      const start = v.lastIndexOf('\n', s - 1) + 1
      const block = v.slice(start, e)
      const out = block.split('\n').map((l, i) => (typeof prefix === 'function' ? prefix(i) : prefix) + l).join('\n')
      return { v: v.slice(0, start) + out + v.slice(e), s: start, e: start + out.length }
    })
  const insert = (text: string) =>
    edit((v, s, e) => ({ v: v.slice(0, s) + text + v.slice(e), s: s + text.length, e: s + text.length }))

  const addImage = async (file: File) => {
    try {
      const hash = await imageFileToStored(file)
      insert(`\n![${file.name.replace(/\.[^.]+$/, '')}](media:${hash})\n`)
    } catch (e) { toast(`Image non ajoutée : ${(e as Error).message}`, 'err') }
  }

  const save = async () => {
    if (!valid || busy) return
    setBusy(true)
    try {
      let id = cardId
      if (existing) {
        await updateCard(existing.id, { front, back })
        if (folder !== existing.folderId) await moveCard(existing.id, folder!)
      } else id = (await createCard(folder!, front, back)).id
      toast('Carte enregistrée')
      onSaved?.(id!)
      onClose()
    } catch (e) { toast((e as Error).message, 'err'); setBusy(false) }
  }
  const close = async () => {
    if (!dirty || (await confirmAsk({ message: 'Fermer sans enregistrer ? Les modifications seront perdues.', okLabel: 'Fermer sans enregistrer', danger: true }))) onClose()
  }
  void db

  const onPaste = (e: React.ClipboardEvent) => {
    const f = [...e.clipboardData.files].find((x) => x.type.startsWith('image/'))
    if (f) { e.preventDefault(); void addImage(f) }
  }
  const onKey = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void save() }
  }

  const tools: [string, string, () => void][] = [
    ['Gras', 'Gras (**texte**)', () => wrap('**', '**', 'texte')],
    ['Italique', 'Italique (*texte*)', () => wrap('*', '*', 'texte')],
    ['Titre', 'Titre', () => linePrefix('## ')],
    ['Liste', 'Liste à puces', () => linePrefix('- ')],
    ['1. 2.', 'Liste numérotée', () => linePrefix((i) => `${i + 1}. `)],
    ['Tableau', 'Insérer un tableau', () => insert(TABLE)],
    ['Formule', 'Formule dans le texte ($…$)', () => wrap('$', '$', 'x^2')],
    ['Bloc', 'Formule centrée ($$…$$)', () => wrap('\n$$\n', '\n$$\n', '\\int_0^1 f(x)\\,dx')],
    ['Code', 'Bloc de code', () => wrap('\n```\n', '\n```\n', 'code')],
    ['Image', 'Insérer une image (ou coller avec Ctrl+V)', () => fileRef.current?.click()],
  ]

  return (
    <Modal wide title={existing ? 'Modifier la carte' : 'Nouvelle carte'} onClose={close}
      footer={<>
        <span className="muted grow hide-touch">Ctrl + Entrée pour enregistrer</span>
        <button onClick={close}>Annuler</button>
        <button className="primary" disabled={!valid || busy} onClick={save}>Enregistrer</button>
      </>}>
      <div className="editor">
        <label className="field inline"><span>Dossier</span><FolderSelect value={folder} onChange={setFolder} /></label>
        <div className="toolbar" role="toolbar" aria-label="Mise en forme">
          {tools.map(([label, title, fn]) => <button key={label} type="button" title={title} onClick={fn}>{label}</button>)}
          <input ref={fileRef} type="file" accept="image/*" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void addImage(f); e.target.value = '' }} />
        </div>
        <div className="editor-grid">
          {(['front', 'back'] as Field[]).map((f) => (
            <section key={f} className={active === f ? 'pane active' : 'pane'}>
              <h3>{f === 'front' ? 'Recto (question)' : 'Verso (réponse)'}</h3>
              <textarea ref={refs[f]} value={get(f)} spellCheck={false}
                onFocus={() => setActive(f)} onChange={(e) => set(f, e.target.value)} onPaste={onPaste} onKeyDown={onKey}
                placeholder={f === 'front' ? 'Ex. : Énoncer le théorème de Pythagore.' : 'Ex. : Dans un triangle rectangle, $a^2+b^2=c^2$.'} />
              <div className="preview-label">Aperçu</div>
              <div className="preview">{get(f).trim() ? <Rich text={get(f)} /> : <span className="muted">Rien à afficher.</span>}</div>
            </section>
          ))}
        </div>
        <details className="help">
          <summary>Aide à la saisie</summary>
          <p>Le contenu s'écrit en Markdown : <code>**gras**</code>, <code>*italique*</code>, <code>## Titre</code>, <code>- puce</code>, <code>1. numéro</code>.
            Les formules s'écrivent en LaTeX : <code>$\frac{'{a}{b}'}$</code> dans le texte, <code>$$ … $$</code> pour une formule centrée.</p>
        </details>
      </div>
    </Modal>
  )
}
