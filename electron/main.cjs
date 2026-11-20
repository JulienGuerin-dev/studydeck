// Processus principal Electron : fenêtre, protocole app://, boîtes de dialogue de fichiers, sauvegardes automatiques.
const { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, shell } = require('electron')
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
])

// WebRTC : exposer l'adresse IP locale réelle dans les candidats ICE (sinon masquée par mDNS),
// ce qui permet de la transmettre dans le code d'appairage compact.
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns')

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

let win = null
const DIST = path.join(__dirname, '..', 'dist')
const backupsDir = () => path.join(app.getPath('userData'), 'backups')

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 760,
    minHeight: 560,
    title: 'StudyDeck',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    backgroundColor: '#f6f7f9',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  win.once('ready-to-show', () => win.show())
  win.loadURL('app://local/index.html')
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://')) {
      e.preventDefault()
      if (/^https?:/i.test(url)) shell.openExternal(url)
    }
  })
}

function buildMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { label: 'Fichier', submenu: [{ role: 'quit', label: 'Quitter' }] },
      {
        label: 'Édition',
        submenu: [
          { role: 'undo', label: 'Annuler' }, { role: 'redo', label: 'Rétablir' }, { type: 'separator' },
          { role: 'cut', label: 'Couper' }, { role: 'copy', label: 'Copier' }, { role: 'paste', label: 'Coller' },
          { role: 'selectAll', label: 'Tout sélectionner' },
        ],
      },
      {
        label: 'Affichage',
        submenu: [
          { role: 'zoomIn', label: 'Zoom avant' }, { role: 'zoomOut', label: 'Zoom arrière' },
          { role: 'resetZoom', label: 'Taille normale' }, { type: 'separator' },
          { role: 'togglefullscreen', label: 'Plein écran' },
        ],
      },
    ]),
  )
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.whenReady().then(() => {
  // app://local/<chemin> sert les fichiers de dist/ (origine stable => IndexedDB stable)
  protocol.handle('app', (request) => {
    const u = new URL(request.url)
    let rel = decodeURIComponent(u.pathname)
    if (rel === '/' || rel === '') rel = '/index.html'
    const file = path.normalize(path.join(DIST, rel))
    if (!file.startsWith(DIST)) return new Response('Interdit', { status: 403 })
    return net.fetch(pathToFileURL(file).toString())
  })

  buildMenu()
  createWindow()

  ipcMain.handle('file:save', async (_e, name, data, filterName, ext) => {
    const r = await dialog.showSaveDialog(win, {
      defaultPath: path.join(app.getPath('documents'), name),
      filters: [{ name: filterName, extensions: [ext] }, { name: 'Tous les fichiers', extensions: ['*'] }],
    })
    if (r.canceled || !r.filePath) return null
    await fs.promises.writeFile(r.filePath, Buffer.from(data))
    return r.filePath
  })

  ipcMain.handle('file:open', async (_e, filterName, exts) => {
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: filterName, extensions: exts }, { name: 'Tous les fichiers', extensions: ['*'] }],
    })
    if (r.canceled || !r.filePaths[0]) return null
    const p = r.filePaths[0]
    const buf = await fs.promises.readFile(p)
    return { name: path.basename(p), data: new Uint8Array(buf) }
  })

  ipcMain.handle('backup:auto', async (_e, name, data) => {
    const dir = backupsDir()
    await fs.promises.mkdir(dir, { recursive: true })
    const file = path.join(dir, name.replace(/[^\w.-]+/g, '_'))
    await fs.promises.writeFile(file, Buffer.from(data))
    // Conserve les 15 copies automatiques les plus récentes
    const files = (await fs.promises.readdir(dir))
      .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
    for (const old of files.slice(15)) await fs.promises.unlink(path.join(dir, old.f)).catch(() => {})
    return file
  })

  ipcMain.handle('app:info', () => ({ version: app.getVersion(), userData: app.getPath('userData'), backupsDir: backupsDir() }))
  ipcMain.handle('shell:showItem', (_e, p) => {
    if (fs.existsSync(p)) fs.statSync(p).isDirectory() ? shell.openPath(p) : shell.showItemInFolder(p)
  })
})

app.on('window-all-closed', () => app.quit())
