import { createContext, useContext, useMemo, useState, useEffect, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import type { Card, Folder, ReviewEvent, Scheduling, Session } from '../db/types'
import { buildStats, type StatsBundle } from '../stats/stats'

export interface Library {
  ready: boolean
  folders: Folder[]
  cards: Card[]
  events: ReviewEvent[]
  scheds: Scheduling[]
  sessions: Session[]
  stats: StatsBundle
  children: (parentId: string | null) => Folder[]
  byId: Map<string, Folder>
}

const Ctx = createContext<Library | null>(null)
export const useLibrary = () => useContext(Ctx)!

const byName = (a: Folder, b: Folder) => a.name.localeCompare(b.name, 'fr', { numeric: true })

export function LibraryProvider({ children }: { children: ReactNode }) {
  const folders = useLiveQuery(() => db.folders.toArray().then((a) => a.filter((f) => f.deletedAt === null)))
  const cards = useLiveQuery(() => db.cards.toArray().then((a) => a.filter((c) => c.deletedAt === null)))
  const events = useLiveQuery(() => db.events.toArray())
  const scheds = useLiveQuery(() => db.scheduling.toArray())
  const sessions = useLiveQuery(() => db.sessions.orderBy('startedAt').reverse().toArray())
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 60_000)
    return () => clearInterval(t)
  }, [])
  const ready = !!(folders && cards && events && scheds && sessions)

  const value = useMemo<Library>(() => {
    const f = folders ?? [], c = cards ?? [], e = events ?? [], s = scheds ?? []
    const kids = new Map<string | null, Folder[]>()
    for (const x of f) kids.set(x.parentId, [...(kids.get(x.parentId) ?? []), x])
    for (const list of kids.values()) list.sort(byName)
    const ids = new Set(f.map((x) => x.id))
    // Un dossier dont le parent est introuvable est affiché à la racine (la réparation corrigera la base)
    const roots = f.filter((x) => x.parentId === null || !ids.has(x.parentId)).sort(byName)
    return {
      ready, folders: f, cards: c, events: e, scheds: s, sessions: sessions ?? [],
      stats: buildStats(f, c, e, s, Date.now()),
      children: (p) => (p === null ? roots : kids.get(p) ?? []),
      byId: new Map(f.map((x) => [x.id, x])),
    }
  }, [ready, folders, cards, events, scheds, sessions, tick])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** Liste « à plat » des dossiers avec profondeur, pour les listes déroulantes. */
export function flatFolders(lib: Library, excludeSubtreeOf?: string): { folder: Folder; depth: number }[] {
  const out: { folder: Folder; depth: number }[] = []
  const walk = (p: string | null, depth: number) => {
    for (const f of lib.children(p)) {
      if (f.id === excludeSubtreeOf) continue
      out.push({ folder: f, depth })
      if (depth < 60) walk(f.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

export function pathOf(lib: Library, id: string | null): string {
  const parts: string[] = []
  let cur = id ? lib.byId.get(id) : undefined
  let guard = 0
  while (cur && guard++ < 100) { parts.unshift(cur.name); cur = cur.parentId ? lib.byId.get(cur.parentId) : undefined }
  return parts.join(' / ')
}

export function FolderSelect(props: {
  value: string | null
  onChange: (v: string | null) => void
  rootLabel?: string // si défini, une option « racine » est proposée
  excludeSubtreeOf?: string
  disabled?: boolean
}) {
  const lib = useLibrary()
  const list = flatFolders(lib, props.excludeSubtreeOf)
  return (
    <select
      value={props.value ?? ''}
      disabled={props.disabled}
      onChange={(e) => props.onChange(e.target.value === '' ? null : e.target.value)}
    >
      {props.rootLabel !== undefined && <option value="">{props.rootLabel}</option>}
      {props.rootLabel === undefined && props.value === null && <option value="">Choisir un dossier…</option>}
      {list.map(({ folder, depth }) => (
        <option key={folder.id} value={folder.id}>{'\u00A0\u00A0'.repeat(depth)}{depth ? '↳ ' : ''}{folder.name}</option>
      ))}
    </select>
  )
}
