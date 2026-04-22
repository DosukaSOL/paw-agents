// ─── PAW Desktop — Preload Script ───
// Exposes safe IPC bridge to the renderer process.

import { contextBridge, ipcRenderer } from 'electron';

// Track listeners so we can clean them up (prevent memory leaks)
const listeners: Array<{ channel: string; fn: (...args: any[]) => void }> = [];

function addListener(channel: string, callback: (...args: any[]) => void) {
  // Remove previous listener for this channel to prevent accumulation
  const existing = listeners.findIndex(l => l.channel === channel);
  if (existing >= 0) {
    ipcRenderer.removeListener(channel, listeners[existing].fn);
    listeners.splice(existing, 1);
  }
  const fn = (_event: any, ...args: any[]) => callback(...args);
  ipcRenderer.on(channel, fn);
  listeners.push({ channel, fn });
}

contextBridge.exposeInMainWorld('paw', {
  send: (message: string) => ipcRenderer.invoke('paw:send', message),
  status: () => ipcRenderer.invoke('paw:status'),
  reconnect: () => ipcRenderer.invoke('paw:reconnect'),
  openExternal: (url: string) => ipcRenderer.invoke('paw:openExternal', url),
  getConfig: () => ipcRenderer.invoke('paw:getConfig'),
  saveConfig: (updates: Record<string, string>) => ipcRenderer.invoke('paw:saveConfig', updates),
  togglePawl: (enabled: boolean) => ipcRenderer.invoke('pawl:toggle', enabled),
  onMessage: (callback: (msg: unknown) => void) => {
    addListener('gateway:message', callback);
  },
  onStatus: (callback: (status: string) => void) => {
    addListener('gateway:status', callback);
  },
});

// ─── Pawl Companion API ───
contextBridge.exposeInMainWorld('pawlAPI', {
  click: () => ipcRenderer.send('pawl:click'),
  doubleclick: () => ipcRenderer.send('pawl:doubleclick'),
  drag: (dx: number, dy: number) => ipcRenderer.send('pawl:drag', dx, dy),
  onFrame: (callback: (frame: string) => void) => {
    addListener('pawl:frame', callback);
  },
  onNotification: (callback: (data: { text: string; type: string }) => void) => {
    addListener('pawl:notification', callback);
  },
  onSound: (callback: (sound: string) => void) => {
    addListener('pawl:sound', callback);
  },
  onOpenApp: (callback: () => void) => {
    addListener('pawl:open-app', callback);
  },
});
