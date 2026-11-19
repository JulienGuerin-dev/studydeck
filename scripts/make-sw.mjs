// Génère dist/sw.js : service worker qui met toute l'application en cache (fonctionnement hors ligne).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const dist = path.resolve('dist')
const files = []
const walk = (d) => {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name)
    if (f.isDirectory()) walk(p)
    else if (f.name !== 'sw.js') files.push(path.relative(dist, p).split(path.sep).join('/'))
  }
}
walk(dist)
files.sort()
const hash = crypto.createHash('sha256')
for (const f of files) hash.update(f).update(fs.readFileSync(path.join(dist, f)))
const version = hash.digest('hex').slice(0, 12)

const sw = `// Généré automatiquement (scripts/make-sw.mjs). Ne pas modifier.
const CACHE = 'studydeck-${version}'
const FILES = ${JSON.stringify(['./', ...files.map((f) => './' + f)])}

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()),
  )
})
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('studydeck-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  )
})
self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit
      if (req.mode === 'navigate') return caches.match('./index.html')
      return fetch(req)
    }),
  )
})
`
fs.writeFileSync(path.join(dist, 'sw.js'), sw)
console.log(`sw.js généré : ${files.length} fichiers en cache (version ${version})`)
