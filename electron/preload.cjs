/**
 * The only bridge between the editor and the desktop. It exposes four
 * operations and nothing else: no filesystem, no Node, no module loader.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  openProject: () => ipcRenderer.invoke('project:open'),
  saveProject: (request) => ipcRenderer.invoke('project:save', request),
  saveFile: (request) => ipcRenderer.invoke('file:save', request),
  revealFile: (filePath) => ipcRenderer.invoke('shell:reveal', filePath),
  openExternal: (url) => ipcRenderer.invoke('shell:open', url),
});
