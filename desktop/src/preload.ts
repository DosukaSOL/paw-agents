// ─── PAW Desktop — Preload Script ───
// Exposes safe IPC bridge to the renderer process.

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('paw', {
  send: (message: string) => ipcRenderer.invoke('paw:send', message),
  status: () => ipcRenderer.invoke('paw:status'),
  reconnect: () => ipcRenderer.invoke('paw:reconnect'),
  onMessage: (callback: (msg: unknown) => void) => {
    ipcRenderer.on('gateway:message', (_event, msg) => callback(msg));
  },
  onStatus: (callback: (status: string) => void) => {
    ipcRenderer.on('gateway:status', (_event, status) => callback(status));
  },
});
