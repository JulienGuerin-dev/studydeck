// Accès aux fichiers : Electron (boîtes de dialogue natives) ou navigateur (téléchargement / sélecteur).

interface ElectronApi {
  saveFile(name: string, data: Uint8Array, filterName: string, ext: string): Promise<string | null>
  openFile(filterName: string, exts: string[]): Promise<{ name: string; data: Uint8Array } | null>
  autoBackup(name: string, data: Uint8Array): Promise<string>
  info(): Promise<{ version: string; userData: string; backupsDir: string }>
  showItem(path: string): Promise<void>
}
const api = (): ElectronApi | undefined => (window as unknown as { studydeck?: ElectronApi }).studydeck

export const isDesktop = () => !!api()

export async function saveFile(name: string, data: Uint8Array, filterName: string, ext: string): Promise<string | null> {
  const a = api()
  if (a) return a.saveFile(name, data, filterName, ext)
  // iPhone / iPad : la feuille de partage permet « Enregistrer dans Fichiers »
  const file = new File([data as BlobPart], name, { type: ext === 'json' ? 'application/json' : 'application/zip' })
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return name } catch (e) {
      if ((e as Error).name === 'AbortError') return null
    }
  }
  const url = URL.createObjectURL(new Blob([data as BlobPart]))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
  return name
}

export async function openFile(_filterName: string, exts: string[]): Promise<{ name: string; data: Uint8Array } | null> {
  const a = api()
  if (a) return a.openFile(_filterName, exts)
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    // Pas de filtre d'extension : iOS grise les extensions inconnues (.studydeck…) dans le sélecteur
    void exts
    input.onchange = async () => {
      const f = input.files?.[0]
      resolve(f ? { name: f.name, data: new Uint8Array(await f.arrayBuffer()) } : null)
    }
    input.oncancel = () => resolve(null)
    input.click()
  })
}

/** Copie de sécurité automatique avant une opération risquable (restauration, synchronisation). */
export async function autoBackup(name: string, data: Uint8Array): Promise<string | null> {
  const a = api()
  return a ? a.autoBackup(name, data) : null
}

export async function appInfo() {
  return api()?.info() ?? { version: 'web', userData: '', backupsDir: '' }
}
export async function showItem(path: string) {
  await api()?.showItem(path)
}
