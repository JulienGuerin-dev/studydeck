const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('studydeck', {
  saveFile: (name, data, filterName, ext) => ipcRenderer.invoke('file:save', name, data, filterName, ext),
  openFile: (filterName, exts) => ipcRenderer.invoke('file:open', filterName, exts),
  autoBackup: (name, data) => ipcRenderer.invoke('backup:auto', name, data),
  info: () => ipcRenderer.invoke('app:info'),
  showItem: (p) => ipcRenderer.invoke('shell:showItem', p),
})
