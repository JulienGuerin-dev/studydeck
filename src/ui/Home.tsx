import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { Folder } from '../db/types'
import { kindOf, KIND_LABEL } from '../domain/subjects'
import type { Agg } from '../stats/stats'
import { StyleEditor } from './StyleEditor'
import { useLibrary } from './store'

const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)} %`)
const PALETTE = ['#7c9cff', '#5ec4b6', '#f2a65a', '#ef7f8e', '#b58cf0', '#8fcf6b', '#e8c547', '#6fb7e6']

function hash(s: string): number {
  let h = 2166136261
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return h >>> 0
}

type Mood = 'sleepy' | 'happy' | 'excited' | 'chill'

function moodOf(f: Folder, a: Agg): Mood {
  const kind = kindOf(f)
  if (kind === 'hobbit') return 'chill'
  if (kind === 'archive' || a.due === 0) return 'sleepy'
  return a.due >= 10 ? 'excited' : 'happy'
}

/** Petite créature vivante représentant une matière ou un chapitre. Purement CSS : léger et sans batterie perdue. */
function Pet({ folder, agg, big, onOpen, onStyle }: { folder: Folder; agg: Agg; big?: boolean; onOpen: () => void; onStyle: () => void }) {
  const h = hash(folder.id)
  const color = folder.color || PALETTE[h % PALETTE.length]
  const mood = moodOf(folder, agg)
  const size = Math.round((big ? 120 : 78) + Math.min(46, Math.sqrt(agg.cards) * 5))
  const style = {
    '--c': color, '--size': `${size}px`,
    '--drift-x': `${(h % 23) + 8}px`, '--drift-y': `${((h >> 5) % 17) + 6}px`,
    '--drift-t': `${14 + (h % 11)}s`, '--bob-t': `${mood === 'excited' ? 1.3 : mood === 'sleepy' ? 4.6 : 2.8 + (h % 5) / 5}s`,
    '--morph-t': `${5 + (h % 6)}s`, '--delay': `-${(h % 90) / 10}s`, '--blink-d': `${2.5 + (h % 4)}s`,
  } as CSSProperties
  const total = agg.cards || 1
  return (
    <div className={`pet-wrap ${big ? 'big' : ''}`}>
      <button className={`pet mood-${mood}`} style={style} onClick={onOpen} aria-label={`${folder.name} : ${agg.cards} cartes, ${agg.due} à réviser`}>
        <span className="pet-drift">
          <span className="pet-bob">
            {folder.emoji && <span className="pet-emoji" aria-hidden>{folder.emoji}</span>}
            <span className="pet-body">
              <i className="eye l" /><i className="eye r" /><i className="mouth" />
              {mood === 'sleepy' && <b className="zzz" aria-hidden>z</b>}
              {agg.due > 0 && <span className="pet-due" aria-hidden>{agg.due}</span>}
            </span>
          </span>
        </span>
      </button>
      <div className="pet-label">
        <strong>{folder.name}</strong>
        <span className="muted small">{agg.cards} carte(s){kindOf(folder) === 'learning' ? ` · ${agg.due} à réviser` : ` · ${KIND_LABEL[kindOf(folder)].toLowerCase()}`}</span>
        {kindOf(folder) === 'learning' && agg.cards > 0 && <div className="stack"><i className="m" style={{ width: `${(agg.mastered / total) * 100}%` }} /><i className="s" style={{ width: `${((agg.reviewed - agg.mastered) / total) * 100}%` }} /></div>}
      </div>
      <button className="pet-edit ghost" onClick={onStyle} aria-label={`Personnaliser ${folder.name}`} title="Emoji, couleur, type">✎</button>
    </div>
  )
}

export function Home({ go, reviewScope }: { go: (page: 'library' | 'review' | 'stats' | 'data') => void; reviewScope: (scope: string | null, auto?: boolean) => void }) {
  const lib = useLibrary()
  const g = lib.stats.global
  const today = new Date().setHours(0, 0, 0, 0)
  const todayEv = lib.events.filter((e) => e.at >= today && (e.kind === 'first' || e.kind === 'retry'))
  const [view, setView] = useState<'pets' | 'list'>(() => (localStorage.getItem('studydeck.homeView') === 'list' ? 'list' : 'pets'))
  const [path, setPath] = useState<string[]>([])
  const [styling, setStyling] = useState<Folder | null>(null)
  const [archives, setArchives] = useState(false)

  const setMode = (v: 'pets' | 'list') => { setView(v); localStorage.setItem('studydeck.homeView', v) }
  // Les animations se mettent en pause quand la fenêtre est masquée
  useEffect(() => {
    const f = () => document.documentElement.classList.toggle('paused', document.hidden)
    document.addEventListener('visibilitychange', f)
    return () => { document.removeEventListener('visibilitychange', f); document.documentElement.classList.remove('paused') }
  }, [])

  const current = path.length ? lib.byId.get(path[path.length - 1]) : undefined
  // Si le dossier affiché a disparu (suppression, synchronisation), on revient à la racine
  useEffect(() => { if (path.length && !current) setPath([]) }, [path, current])
  const shown = useMemo(() => (current ? lib.children(current.id) : lib.children(null).filter((f) => archives || kindOf(f) !== 'archive')), [current, lib, archives])
  const hasArchives = lib.children(null).some((f) => kindOf(f) === 'archive')
  const empty = (f: Folder) => lib.stats.byFolder.get(f.id)

  return (
    <div className="page">
      <h1>Accueil</h1>
      {g.cards === 0 ? (
        <div className="empty box">
          <h2>Commencez votre bibliothèque</h2>
          <p>Créez une matière puis vos premières cartes, ou importez un fichier .studydeck généré par une IA.</p>
          <div className="actions"><button className="primary" onClick={() => go('library')}>Ouvrir la bibliothèque</button><button onClick={() => go('data')}>Importer des cartes</button></div>
        </div>
      ) : (
        <>
          <div className="hero box">
            <div>
              <div className="hero-n">{g.due}</div>
              <div className="muted">carte{g.due > 1 ? 's' : ''} à réviser aujourd'hui</div>
            </div>
            <button className="primary big" disabled={!g.due} onClick={() => reviewScope(null, true)}>Commencer la révision</button>
          </div>
          <div className="figures wide">
            <div><b>{g.cards}</b><span>cartes</span></div>
            <div><b className="okc">{g.mastered}</b><span>terminées</span></div>
            <div><b>{todayEv.length}</b><span>réponses aujourd'hui</span></div>
            <div><b>{pct(g.rate)}</b><span>réussite globale</span></div>
          </div>
        </>
      )}

      {lib.children(null).length > 0 && (
        <>
          <div className="home-head">
            <h2>Matières</h2>
            <div className="seg" role="group" aria-label="Affichage">
              <button className={view === 'pets' ? 'on' : ''} onClick={() => setMode('pets')}>Créatures</button>
              <button className={view === 'list' ? 'on' : ''} onClick={() => setMode('list')}>Liste</button>
            </div>
          </div>

          {view === 'pets' ? (
            <div className="pets-zone">
              <nav className="crumbs" aria-label="Chemin">
                <button className="link" onClick={() => setPath([])}>Matières</button>
                {path.map((id, i) => (
                  <span key={id}> › {i < path.length - 1 ? <button className="link" onClick={() => setPath(path.slice(0, i + 1))}>{lib.byId.get(id)?.name}</button> : <strong>{lib.byId.get(id)?.name}</strong>}</span>
                ))}
              </nav>
              {current && (
                <div className="pet-focus">
                  <Pet folder={current} agg={empty(current)!} big onOpen={() => setPath(path.slice(0, -1))} onStyle={() => setStyling(current)} />
                  <div className="pet-focus-info">
                    <p className="muted">{shown.length ? 'Touchez un chapitre pour l\'ouvrir.' : 'Aucun sous-chapitre.'} Toucher la créature remonte d'un niveau.</p>
                    <div className="actions">
                      <button className="primary" disabled={!empty(current)?.cards} onClick={() => reviewScope(current.id)}>Réviser « {current.name} »</button>
                      <button onClick={() => go('library')}>Ouvrir dans la bibliothèque</button>
                    </div>
                  </div>
                </div>
              )}
              <div className="pets">
                {shown.map((f) => {
                  const a = empty(f)
                  return a ? <Pet key={f.id} folder={f} agg={a} onOpen={() => setPath([...path, f.id])} onStyle={() => setStyling(f)} /> : null
                })}
              </div>
              {!current && hasArchives && <button className="link small" onClick={() => setArchives((v) => !v)}>{archives ? 'Masquer' : 'Afficher'} les archives</button>}
            </div>
          ) : (
            <div className="tiles">
              {lib.children(null).filter((f) => kindOf(f) !== 'archive').map((f) => {
                const a = lib.stats.byFolder.get(f.id)
                if (!a) return null
                return (
                  <div key={f.id} className="tile">
                    <div className="tile-name">{f.emoji} {f.name}</div>
                    <div className="muted">{a.cards} carte(s) · {a.due} à réviser</div>
                    <div className="stack"><i className="m" style={{ width: `${a.cards ? (a.mastered / a.cards) * 100 : 0}%` }} /><i className="s" style={{ width: `${a.cards ? ((a.reviewed - a.mastered) / a.cards) * 100 : 0}%` }} /></div>
                    <div className="actions"><button className="small" onClick={() => reviewScope(f.id)}>Réviser</button></div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
      {styling && <StyleEditor folder={styling} onClose={() => setStyling(null)} />}
    </div>
  )
}
