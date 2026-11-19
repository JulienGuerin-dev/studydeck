import { useState } from 'react'
import { Data } from './Data'
import { DialogHost } from './dialogs'
import { Home } from './Home'
import { Library } from './Library'
import { Review } from './Review'
import { Stats } from './Stats'
import { LibraryProvider, useLibrary } from './store'

type Page = 'home' | 'library' | 'review' | 'stats' | 'data'
const NAV: [Page, string][] = [['home', 'Accueil'], ['library', 'Bibliothèque'], ['review', 'Révision'], ['stats', 'Statistiques'], ['data', 'Paramètres']]

function Shell() {
  const lib = useLibrary()
  const [page, setPage] = useState<Page>('home')
  const [review, setReview] = useState<{ scope: string | null; auto: boolean; key: number }>({ scope: null, auto: false, key: 0 })

  const startReview = (scope: string | null, auto = false) => { setReview((r) => ({ scope, auto, key: r.key + 1 })); setPage('review') }
  const due = lib.stats.global.due

  return (
    <div className="app">
      <nav className="nav" aria-label="Navigation principale">
        <div className="brand">StudyDeck</div>
        {NAV.map(([k, l]) => (
          <button key={k} className={page === k ? 'on' : ''} onClick={() => (k === 'review' ? startReview(null) : setPage(k))} aria-current={page === k ? 'page' : undefined}>
            {l}{k === 'review' && due > 0 && <span className="badge">{due}</span>}
          </button>
        ))}
      </nav>
      <main className="main">
        {!lib.ready ? <p className="muted pad">Chargement…</p> : (<>
          {page === 'home' && <Home go={(p) => setPage(p)} reviewScope={startReview} />}
          {page === 'library' && <Library onReview={(s) => startReview(s)} />}
          {page === 'review' && <Review key={review.key} initialScope={review.scope} autoStart={review.auto ? 'due' : null} onDone={() => setPage('home')} />}
          {page === 'stats' && <Stats />}
          {page === 'data' && <Data />}
        </>)}
      </main>
    </div>
  )
}

export default function App() {
  return (
    <LibraryProvider>
      <Shell />
      <DialogHost />
    </LibraryProvider>
  )
}
