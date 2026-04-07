// ─── PAW Desktop — Preload Script ───
// Exposes safe IPC bridge to the renderer process.

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('paw', {
  send: (message: string) => ipcRenderer.invoke('paw:send', message),
  status: () => ipcRenderer.invoke('paw:status'),
  reconnect: () => ipcRenderer.invoke('paw:reconnect'),
  getConfig: () => ipcRenderer.invoke('paw:getConfig'),
  saveConfig: (updates: Record<string, string>) => ipcRenderer.invoke('paw:saveConfig', updates),
  togglePawl: (enabled: boolean) => ipcRenderer.invoke('pawl:toggle', enabled),
  onMessage: (callback: (msg: unknown) => void) => {
    ipcRenderer.on('gateway:message', (_event, msg) => callback(msg));
  },
  onStatus: (callback: (status: string) => void) => {
    ipcRenderer.on('gateway:status', (_event, status) => callback(status));
  },
});

// ─── Pawl Companion API ───
contextBridge.exposeInMainWorld('pawlAPI', {
  click: () => ipcRenderer.send('pawl:click'),
  doubleclick: () => ipcRenderer.send('pawl:doubleclick'),
  drag: (dx: number, dy: number) => ipcRenderer.send('pawl:drag', dx, dy),
  onFrame: (callback: (frame: string) => void) => {
    ipcRenderer.on('pawl:frame', (_event, frame) => callback(frame));
  },
  onNotification: (callback: (data: { text: string; type: string }) => void) => {
    ipcRenderer.on('pawl:notification', (_event, data) => callback(data));
  },
  onSound: (callback: (sound: string) => void) => {
    ipcRenderer.on('pawl:sound', (_event, sound) => callback(sound));
  },
  onOpenApp: (callback: () => void) => {
    ipcRenderer.on('pawl:open-app', () => callback());
  },
});
