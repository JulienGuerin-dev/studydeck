import { useMemo, useState } from 'react'
import { reviewsPerDay, type Agg } from '../stats/stats'
import type { Folder } from '../db/types'
import { useLibrary } from './store'

const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)} %`)
const share = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0)
const dur = (a: number, b: number | null) => {
  if (!b) return '—'
  const s = Math.round((b - a) / 1000)
  return s >= 60 ? `${Math.floor(s / 60)} min` : `${s} s`
}

function Bar({ a }: { a: Agg }) {
  const m = share(a.mastered, a.cards)
  const seen = share(a.reviewed - a.mastered, a.cards)
  return (
    <div className="stack" title={`${a.mastered} maîtrisées, ${a.reviewed - a.mastered} en cours, ${a.neverReviewed} nouvelles`}>
      <i className="m" style={{ width: `${m}%` }} /><i className="s" style={{ width: `${seen}%` }} />
    </div>
  )
}

export function Stats() {
  const lib = useLibrary()
  const [open, setOpen] = useState<Set<string>>(new Set())
  const g = lib.stats.global
  const days = useMemo(() => reviewsPerDay(lib.events, 30, Date.now()), [lib.events])
  const maxDay = Math.max(1, ...days.map((d) => d.total))

  const rows: { f: Folder; depth: number }[] = []
  const walk = (p: string | null, depth: number) => {
    for (const f of lib.children(p)) {
      rows.push({ f, depth })
      if (open.has(f.id) && depth < 40) walk(f.id, depth + 1)
    }
  }
  walk(null, 0)
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  return (
    <div className="page">
      <h1>Statistiques</h1>
      <div className="figures wide">
        <div><b>{g.cards}</b><span>cartes</span></div>
        <div><b>{g.reviewed}</b><span>déjà révisées</span></div>
        <div><b className="warnc">{g.due}</b><span>à réviser</span></div>
        <div><b className="okc">{g.mastered}</b><span>maîtrisées</span></div>
        <div><b className="badc">{g.difficult}</b><span>en difficulté</span></div>
        <div><b>{pct(g.rate)}</b><span>réussite ({g.attempts} tentatives)</span></div>
      </div>

      <h2>Activité des 30 derniers jours</h2>
      <div className="chart box" role="img" aria-label="Nombre de réponses par jour">
        <svg viewBox="0 0 600 140" preserveAspectRatio="none">
          {days.map((d, i) => {
            const w = 600 / days.length
            const h = (d.total / maxDay) * 110
            const hc = (d.correct / maxDay) * 110
            return (
              <g key={i}>
                <rect x={i * w + 2} y={120 - h} width={w - 4} height={h} className="bar-bad"><title>{new Date(d.day).toLocaleDateString('fr-FR')} : {d.total} réponse(s), {d.correct} correcte(s)</title></rect>
                <rect x={i * w + 2} y={120 - hc} width={w - 4} height={hc} className="bar-ok" />
              </g>
            )
          })}
          <line x1="0" y1="120" x2="600" y2="120" className="axis" />
        </svg>
        <div className="legend"><span><i className="sw ok" /> correctes</span><span><i className="sw bad" /> incorrectes</span><span className="muted">max {maxDay} / jour</span></div>
      </div>

      <h2>Par matière et dossier</h2>
      <div className="box nopad">
        <table className="grid">
          <thead><tr><th>Nom</th><th>Cartes</th><th>Progression</th><th>À réviser</th><th>Maîtrisées</th><th>Difficiles</th><th>Tentatives</th><th>Réussite</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={8} className="muted">Aucune donnée.</td></tr>}
            {rows.map(({ f, depth }) => {
              const a = lib.stats.byFolder.get(f.id)
              if (!a) return null
              const hasKids = lib.children(f.id).length > 0
              return (
                <tr key={f.id}>
                  <td style={{ paddingLeft: 10 + depth * 18 }}>
                    <button className="caret" disabled={!hasKids} onClick={() => toggle(f.id)} aria-label="Déplier">{hasKids ? (open.has(f.id) ? '▾' : '▸') : ''}</button>
                    {depth === 0 ? <strong>{f.name}</strong> : f.name}
                  </td>
                  <td>{a.cards}</td><td><Bar a={a} /></td><td>{a.due}</td><td>{a.mastered}</td><td>{a.difficult}</td><td>{a.attempts}</td><td>{pct(a.rate)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small">Maîtrisée : 3 dernières présentations correctes et intervalle d'au moins 21 jours. Difficile : au moins 3 tentatives et moins de 60 % de réussite. Les chiffres d'un dossier incluent ses sous-dossiers.</p>

      <h2>Historique des sessions</h2>
      <div className="box nopad">
        <table className="grid">
          <thead><tr><th>Date</th><th>Périmètre</th><th>Cartes</th><th>Tentatives</th><th>Réussite</th><th>Durée</th></tr></thead>
          <tbody>
            {lib.sessions.length === 0 && <tr><td colSpan={6} className="muted">Aucune session pour l'instant.</td></tr>}
            {lib.sessions.slice(0, 40).map((s) => (
              <tr key={s.id}>
                <td>{new Date(s.startedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                <td>{s.scopeLabel} <span className="muted">({s.mode === 'due' ? 'dues' : 'libre'})</span></td>
                <td>{s.selected}</td><td>{s.attempts}</td><td>{s.attempts ? pct(s.correct / s.attempts) : '—'}</td><td>{dur(s.startedAt, s.endedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
