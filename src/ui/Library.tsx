import { useMemo, useState } from 'react'
import {
  countInside, createFolder, deleteCard, deleteFolder, duplicateCard, moveCard, moveFolder, renameFolder,
} from '../domain/folders'
import { exportStudyDeck } from '../exchange/studydeck'
import { saveFile } from '../platform/files'
import { descendantIds } from '../domain/folders'
import type { Card, Folder } from '../db/types'
import type { CardStats } from '../stats/stats'
import { CardEditor } from './Editor'
import { Modal, confirmAsk, folderAsk, promptAsk, toast } from './dialogs'
import { plainPreview } from './markdown'
import { Rich } from './Rich'
import { useLibrary, pathOf, FolderSelect, type Library as Lib } from './store'
import { LEVELS, levelName } from '../review/levels'
import { KIND_LABEL, kindOf, setCardLevel } from '../domain/subjects'
import type { SubjectKind } from '../db/types'
import { StyleEditor, askChangeKind } from './StyleEditor'

const fmtDate = (t: number | null) => (t ? new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)} %`)

function statusOf(s?: CardStats): { label: string; cls: string } {
  if (!s) return { label: '', cls: 'tag' }
  if (s.kind === 'hobbit') return { label: 'Loisir', cls: 'tag' }
  if (s.kind === 'archive') return { label: 'Archivée', cls: 'tag ok' }
  if (s.graduated) return { label: 'Terminée', cls: 'tag ok' }
  if (!s.reviewed) return { label: 'Nouvelle', cls: 'tag' }
  if (s.difficult) return { label: `Étape ${s.level} · difficile`, cls: 'tag bad' }
  if (s.due) return { label: `À réviser · étape ${s.level}`, cls: 'tag warn' }
  return { label: `Étape ${s.level}`, cls: 'tag' }
}

export function Library({ onReview }: { onReview: (scope: string | null) => void }) {
  const lib = useLibrary()
  const [selected, setSelected] = useState<string | null>(null)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [editor, setEditor] = useState<{ cardId?: string; folderId?: string } | null>(null)
  const [viewing, setViewing] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'due' | 'difficult' | 'new'>('all')
  const [subject, setSubject] = useState<string | null>(null)
  const [recursive, setRecursive] = useState(true)
  const [styling, setStyling] = useState<Folder | null>(null)
  const [showArchives, setShowArchives] = useState(false)

  const sel = selected ? lib.byId.get(selected) : undefined
  const searching = query.trim().length > 0 || filter !== 'all' || subject !== null

  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const select = (id: string | null) => {
    setSelected(id); setQuery(''); setFilter('all'); setSubject(null)
    if (id) setOpen((s) => new Set(s).add(id))
  }

  const newSubject = async () => {
    const name = await promptAsk({ title: 'Nouvelle matière', label: 'Nom de la matière', okLabel: 'Créer' })
    if (name) { try { const f = await createFolder(name, null); select(f.id) } catch (e) { toast((e as Error).message, 'err') } }
  }
  const newFolder = async (parent: Folder) => {
    const name = await promptAsk({ title: `Nouveau dossier dans « ${parent.name} »`, label: 'Nom du dossier', okLabel: 'Créer' })
    if (name) { try { await createFolder(name, parent.id); setOpen((s) => new Set(s).add(parent.id)) } catch (e) { toast((e as Error).message, 'err') } }
  }
  const rename = async (f: Folder) => {
    const name = await promptAsk({ title: 'Renommer', initial: f.name, okLabel: 'Renommer' })
    if (name) { try { await renameFolder(f.id, name) } catch (e) { toast((e as Error).message, 'err') } }
  }
  const move = async (f: Folder) => {
    const r = await folderAsk({ title: `Déplacer « ${f.name} »`, rootLabel: '— Racine (matière) —', exclude: f.id, initial: f.parentId, okLabel: 'Déplacer' })
    if (r) { try { await moveFolder(f.id, r.id) } catch (e) { toast((e as Error).message, 'err') } }
  }
  const remove = async (f: Folder) => {
    const c = await countInside(f.id)
    const ok = await confirmAsk({
      title: `Supprimer « ${f.name} » ?`, danger: true, okLabel: 'Supprimer définitivement',
      message: c.folders || c.cards
        ? `Cette suppression retirera aussi ${c.folders} sous-dossier(s) et ${c.cards} carte(s).\nL'historique de révision de ces cartes ne sera plus visible.\n\nUne sauvegarde préalable est recommandée (Données → Sauvegarde).`
        : 'Ce dossier est vide.',
    })
    if (!ok) return
    const r = await deleteFolder(f.id)
    toast(`Supprimé : ${r.folders} sous-dossier(s), ${r.cards} carte(s)`)
    setSelected(f.parentId)
  }
  const exportFolder = async (f: Folder) => {
    try {
      const r = await exportStudyDeck(f.id)
      const p = await saveFile(`${f.name.replace(/[^\w\- ]+/g, '_')}.studydeck`, r.bytes, 'Paquet StudyDeck', 'studydeck')
      if (p) toast(`${r.cards} carte(s) exportée(s)`)
    } catch (e) { toast((e as Error).message, 'err') }
  }

  /* --- cartes à afficher --- */
  const cardsShown = useMemo(() => {
    let list: Card[] = lib.cards
    const q = query.trim().toLowerCase()
    if (searching) {
      if (subject) {
        const roots = new Set<string>()
        const walk = (id: string) => { roots.add(id); lib.children(id).forEach((c) => walk(c.id)) }
        walk(subject)
        list = list.filter((c) => roots.has(c.folderId))
      }
      if (q) {
        list = list.filter((c) =>
          c.front.toLowerCase().includes(q) || c.back.toLowerCase().includes(q) || pathOf(lib, c.folderId).toLowerCase().includes(q))
      }
      if (filter === 'due') list = list.filter((c) => lib.stats.cards.get(c.id)?.due)
      if (filter === 'difficult') list = list.filter((c) => lib.stats.cards.get(c.id)?.difficult)
      if (filter === 'new') list = list.filter((c) => !lib.stats.cards.get(c.id)?.reviewed)
    } else if (sel) {
      if (recursive) {
        const ids = new Set<string>()
        const walk = (id: string) => { ids.add(id); lib.children(id).forEach((c) => walk(c.id)) }
        walk(sel.id)
        list = list.filter((c) => ids.has(c.folderId))
      } else list = list.filter((c) => c.folderId === sel.id)
    } else list = []
    return list.slice().sort((a, b) => pathOf(lib, a.folderId).localeCompare(pathOf(lib, b.folderId), 'fr') || a.createdAt - b.createdAt)
  }, [lib, query, filter, subject, sel, recursive, searching])

  return (
    <div className="split">
      <aside className="tree" aria-label="Matières et dossiers">
        <div className="tree-head">
          <strong>Bibliothèque</strong>
          <button className="small primary" onClick={newSubject}>+ Matière</button>
        </div>
        {lib.children(null).length === 0 && <p className="muted pad">Aucune matière pour l'instant.</p>}
        <ul>
          {lib.children(null).filter((f) => kindOf(f) !== 'archive').map((f) => (
            <TreeNode key={f.id} f={f} lib={lib} depth={0} open={open} toggle={toggle} selected={selected} onSelect={select} />
          ))}
        </ul>
        {lib.children(null).some((f) => kindOf(f) === 'archive') && (
          <div className="archives">
            <button className="link" onClick={() => setShowArchives((v) => !v)}>{showArchives ? '▾' : '▸'} Archives ({lib.children(null).filter((f) => kindOf(f) === 'archive').length})</button>
            {showArchives && <ul>{lib.children(null).filter((f) => kindOf(f) === 'archive').map((f) => (
              <TreeNode key={f.id} f={f} lib={lib} depth={0} open={open} toggle={toggle} selected={selected} onSelect={select} />
            ))}</ul>}
          </div>
        )}
      </aside>

      <section className="panel">
        <div className="searchbar">
          <input type="search" placeholder="Rechercher une carte…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Rechercher" />
          <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Filtre">
            <option value="all">Toutes les cartes</option>
            <option value="due">À réviser</option>
            <option value="difficult">Difficiles</option>
            <option value="new">Jamais révisées</option>
          </select>
          <FolderSelect value={subject} onChange={setSubject} rootLabel="Tous les dossiers" />
          {searching && <button onClick={() => { setQuery(''); setFilter('all'); setSubject(null) }}>Effacer</button>}
        </div>

        {searching ? (
          <>
            <h2>{cardsShown.length} résultat{cardsShown.length > 1 ? 's' : ''}</h2>
            <CardList cards={cardsShown} lib={lib} showPath onEdit={(id) => setEditor({ cardId: id })} onView={setViewing} />
          </>
        ) : !sel ? (
          <div className="empty">
            <h2>Choisissez une matière ou un dossier</h2>
            <p>Sélectionnez un élément à gauche pour voir ses cartes, ou créez votre première matière.</p>
            <button className="primary" onClick={newSubject}>Créer une matière</button>
          </div>
        ) : (
          <>
            <nav className="crumbs" aria-label="Chemin">
              {chain(sel, lib).map((f, i, a) => (
                <span key={f.id}>{i > 0 && ' / '}{i < a.length - 1 ? <button className="link" onClick={() => select(f.id)}>{f.name}</button> : <strong>{f.name}</strong>}</span>
              ))}
            </nav>
            <div className="folder-head">
              <h1>{sel.emoji && <span className="h-emoji">{sel.emoji}</span>}{sel.name}</h1>
              {sel.parentId === null && (
                <label className="inline-select"><span className="muted small">Type :</span>
                  <select value={kindOf(sel)} onChange={(e) => void askChangeKind(sel, e.target.value as SubjectKind)}>
                    {(Object.keys(KIND_LABEL) as SubjectKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                  </select>
                </label>
              )}
              <div className="muted">
                {lib.stats.byFolder.get(sel.id)?.cards ?? 0} carte(s) · {lib.stats.byFolder.get(sel.id)?.due ?? 0} à réviser · {pct(lib.stats.byFolder.get(sel.id)?.rate ?? null)} de réussite
              </div>
            </div>
            <div className="actions">
              <button className="primary" onClick={() => setEditor({ folderId: sel.id })}>+ Carte</button>
              <button onClick={() => newFolder(sel)}>+ Sous-dossier</button>
              <button onClick={() => onReview(sel.id)} disabled={!(lib.stats.byFolder.get(sel.id)?.cards)}>Réviser</button>
              <button onClick={() => rename(sel)}>Renommer</button>
              <button onClick={() => setStyling(sel)}>Personnaliser</button>
              <button onClick={() => move(sel)}>Déplacer</button>
              <button onClick={() => exportFolder(sel)}>Exporter</button>
              <button className="danger-outline" onClick={() => remove(sel)}>Supprimer</button>
            </div>
            {lib.children(sel.id).length > 0 && (
              <div className="chips">
                {lib.children(sel.id).map((c) => (
                  <button key={c.id} className="chip" onClick={() => select(c.id)}>
                    {c.name} <span className="muted">{lib.stats.byFolder.get(c.id)?.cards ?? 0}</span>
                  </button>
                ))}
              </div>
            )}
            <label className="check"><input type="checkbox" checked={recursive} onChange={(e) => setRecursive(e.target.checked)} /> Inclure les cartes des sous-dossiers</label>
            <CardList cards={cardsShown} lib={lib} showPath={recursive} onEdit={(id) => setEditor({ cardId: id })} onView={setViewing} />
          </>
        )}
      </section>

      {styling && <StyleEditor folder={styling} onClose={() => setStyling(null)} />}
      {editor && <CardEditor cardId={editor.cardId} folderId={editor.folderId} onClose={() => setEditor(null)} />}
      {viewing && <CardView cardId={viewing} onClose={() => setViewing(null)} onEdit={(id) => { setViewing(null); setEditor({ cardId: id }) }} />}
    </div>
  )
}

function chain(f: Folder, lib: Lib): Folder[] {
  const out: Folder[] = []
  let cur: Folder | undefined = f
  let g = 0
  while (cur && g++ < 100) { out.unshift(cur); cur = cur.parentId ? lib.byId.get(cur.parentId) : undefined }
  return out
}

function TreeNode({ f, lib, depth, open, toggle, selected, onSelect }: {
  f: Folder; lib: Lib; depth: number; open: Set<string>; toggle: (id: string) => void; selected: string | null; onSelect: (id: string) => void
}) {
  const kids = lib.children(f.id)
  const isOpen = open.has(f.id)
  return (
    <li>
      <div className={`node ${selected === f.id ? 'sel' : ''}`} style={{ paddingLeft: 8 + depth * 14 }}>
        <button className="caret" aria-label={isOpen ? 'Replier' : 'Déplier'} onClick={() => toggle(f.id)} disabled={!kids.length}>{kids.length ? (isOpen ? '▾' : '▸') : ''}</button>
        <button className="name" onClick={() => onSelect(f.id)}>{f.emoji && <span className="t-emoji">{f.emoji}</span>}{f.name}{depth === 0 && kindOf(f) === 'hobbit' && <span className="tag mini">loisir</span>}</button>
        <span className="count">{lib.stats.byFolder.get(f.id)?.cards ?? 0}</span>
      </div>
      {isOpen && kids.length > 0 && depth < 60 && (
        <ul>{kids.map((k) => <TreeNode key={k.id} f={k} lib={lib} depth={depth + 1} open={open} toggle={toggle} selected={selected} onSelect={onSelect} />)}</ul>
      )}
    </li>
  )
}

function CardList({ cards, lib, showPath, onEdit, onView }: {
  cards: Card[]; lib: Lib; showPath: boolean; onEdit: (id: string) => void; onView: (id: string) => void
}) {
  const [limit, setLimit] = useState(100)
  if (!cards.length) return <p className="muted pad">Aucune carte à afficher.</p>
  const move = async (c: Card) => {
    const r = await folderAsk({ title: 'Déplacer la carte', initial: c.folderId, okLabel: 'Déplacer' })
    if (r?.id) { try { await moveCard(c.id, r.id) } catch (e) { toast((e as Error).message, 'err') } }
  }
  const dup = async (c: Card) => { try { await duplicateCard(c.id); toast('Carte dupliquée') } catch (e) { toast((e as Error).message, 'err') } }
  const del = async (c: Card) => {
    if (await confirmAsk({ title: 'Supprimer la carte ?', message: `« ${plainPreview(c.front, 80)} »`, danger: true, okLabel: 'Supprimer' })) await deleteCard(c.id)
  }
  return (
    <>
      <ul className="cards">
        {cards.slice(0, limit).map((c) => {
          const st = statusOf(lib.stats.cards.get(c.id))
          return (
            <li key={c.id} className="card-row">
              <button className="card-main" onClick={() => onView(c.id)}>
                <span className="card-front">{plainPreview(c.front, 160)}</span>
                <span className="card-sub">{plainPreview(c.back, 100)}</span>
                {showPath && <span className="card-path">{pathOf(lib, c.folderId)}</span>}
              </button>
              <span className={st.cls}>{st.label}</span>
              <div className="row-actions">
                <button className="small" onClick={() => onEdit(c.id)}>Modifier</button>
                <button className="small" onClick={() => move(c)}>Déplacer</button>
                <button className="small" onClick={() => dup(c)}>Dupliquer</button>
                <button className="small danger-outline" onClick={() => del(c)}>Supprimer</button>
              </div>
            </li>
          )
        })}
      </ul>
      {cards.length > limit && <button onClick={() => setLimit(limit + 100)}>Afficher plus ({cards.length - limit})</button>}
    </>
  )
}

export function CardView({ cardId, onClose, onEdit }: { cardId: string; onClose: () => void; onEdit: (id: string) => void }) {
  const lib = useLibrary()
  const c = lib.cards.find((x) => x.id === cardId)
  if (!c) return null
  const s = lib.stats.cards.get(c.id)
  const st = statusOf(s)
  const history = lib.events.filter((e) => e.cardId === c.id).sort((a, b) => b.at - a.at).slice(0, 30)
  return (
    <Modal wide title="Carte" onClose={onClose} footer={<><span className="muted grow">{pathOf(lib, c.folderId)}</span><button onClick={() => onEdit(c.id)}>Modifier</button><button className="primary" onClick={onClose}>Fermer</button></>}>
      <div className="two">
        <div><h3>Recto</h3><div className="face"><Rich text={c.front} /></div></div>
        <div><h3>Verso</h3><div className="face"><Rich text={c.back} /></div></div>
      </div>
      <h3>Suivi <span className={st.cls}>{st.label}</span></h3>
      <dl className="kv">
        <dt>Tentatives</dt><dd>{s?.attempts ?? 0} ({s?.correct ?? 0} réussies, {s?.incorrect ?? 0} échecs, {s?.retries ?? 0} répétitions immédiates)</dd>
        <dt>Taux de réussite</dt><dd>{pct(s?.rate ?? null)}</dd>
        <dt>Dernière révision</dt><dd>{fmtDate(s?.lastReviewAt ?? null)}</dd>
        <dt>Prochaine révision</dt><dd>{s?.kind !== 'learning' ? '—' : s.graduated ? 'Aucune (terminée)' : s.reviewed ? fmtDate(s.nextReviewAt) : 'Dès maintenant (jamais révisée)'}</dd>
        <dt>Étape d'apprentissage</dt>
        <dd>{s?.kind === 'learning'
          ? <span className="inline-level">{s.graduated ? 'Terminée (6/6 réussies)' : levelName(s.level)}
              <select value={s.graduated ? 6 : s.level} aria-label="Modifier l'étape" onChange={async (e) => { await setCardLevel(c.id, Number(e.target.value)); toast('Étape modifiée') }}>
                {Array.from({ length: LEVELS }, (_, i) => i + 1).map((l) => <option key={l} value={l}>Étape {l}</option>)}
              </select></span>
          : <span className="muted">Matière en {KIND_LABEL[s?.kind ?? 'hobbit'].toLowerCase()} : pas de suivi par étapes.</span>}</dd>
        <dt>Résultats successifs</dt>
        <dd>{s?.results.length ? <span className="dots">{s.results.map((r, i) => <i key={i} className={r ? 'ok' : 'bad'} title={r ? 'Correct' : 'Incorrect'} />)}</span> : '—'}</dd>
      </dl>
      {history.length > 0 && (
        <details><summary>Historique ({history.length} dernier(s) événement(s))</summary>
          <ul className="history">{history.map((e) => (
            <li key={e.id}>{new Date(e.at).toLocaleString('fr-FR')} — {e.correct ? 'Correct' : 'Incorrect'} <span className="muted">({e.kind === 'first' ? 'première présentation' : 'répétition immédiate'})</span></li>
          ))}</ul>
        </details>
      )}
    </Modal>
  )
}

void descendantIds
