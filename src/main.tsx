import React from 'react'
import ReactDOM from 'react-dom/client'
import 'katex/dist/katex.min.css'
import './styles.css'
import App from './ui/App'
import { initDevice } from './db/db'
import { ensureScheduleVersion } from './review/scheduling'

async function boot() {
  try { await navigator.storage?.persist?.() } catch { /* sans importance */ }
  await ensureScheduleVersion().catch(() => undefined)
  await initDevice(/iPhone|iPad/.test(navigator.userAgent) ? 'iPhone' : 'PC Windows')
  // Mode hors ligne (PWA) : uniquement en HTTPS ; inactif dans l'application Windows (protocole app://)
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined)
  }
  ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
}
void boot()
