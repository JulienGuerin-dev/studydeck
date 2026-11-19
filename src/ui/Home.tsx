import { useLibrary } from './store'

const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)} %`)

export function Home({ go, reviewScope }: { go: (page: 'library' | 'review' | 'stats' | 'data') => void; reviewScope: (scope: string | null, auto?: boolean) => void }) {
  const lib = useLibrary()
  const g = lib.stats.global
  const today = new Date().setHours(0, 0, 0, 0)
  const todayEv = lib.events.filter((e) => e.at >= today)
  const roots = lib.children(null)

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
            <div><b className="okc">{g.mastered}</b><span>maîtrisées</span></div>
            <div><b>{todayEv.length}</b><span>réponses aujourd'hui</span></div>
            <div><b>{pct(g.rate)}</b><span>réussite globale</span></div>
          </div>
        </>
      )}
      {roots.length > 0 && (
        <>
          <h2>Matières</h2>
          <div className="tiles">
            {roots.map((f) => {
              const a = lib.stats.byFolder.get(f.id)
              if (!a) return null
              return (
                <div key={f.id} className="tile">
                  <div className="tile-name">{f.name}</div>
                  <div className="muted">{a.cards} carte(s) · {a.due} à réviser</div>
                  <div className="stack"><i className="m" style={{ width: `${a.cards ? (a.mastered / a.cards) * 100 : 0}%` }} /><i className="s" style={{ width: `${a.cards ? ((a.reviewed - a.mastered) / a.cards) * 100 : 0}%` }} /></div>
                  <div className="actions"><button className="small" onClick={() => reviewScope(f.id)}>Réviser</button></div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
