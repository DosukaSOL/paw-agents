// ─── PAW Hub — Desktop OS Experience ───
// Combines Dashboard, Mission Control, CLI Companion, Plugins, and Workflows
// into a single unified desktop application with Pawl companion.

import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } from 'electron';
import * as path from 'path';
import WebSocket from 'ws';
import { PawlCompanion } from './companion';

const GATEWAY_URL = process.env.PAW_GATEWAY_URL ?? 'ws://127.0.0.1:18789';
const AUTH_TOKEN = process.env.PAW_AUTH_TOKEN ?? '';

let mainWindow: BrowserWindow | null = null;
let hubWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pawl: PawlCompanion | null = null;

// ─── Create Hub window (primary) ───
function createHubWindow(): void {
  hubWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'PAW Hub',
    titleBarStyle: 'hiddenInset',
    icon: path.join(__dirname, '..', 'icon.png'),
    backgroundColor: '#08080d',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  hubWindow.loadFile(path.join(__dirname, '..', 'renderer', 'hub.html'));

  hubWindow.on('closed', () => {
    hubWindow = null;
  });
}

// ─── Create classic chat window ───
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 500,
    minHeight: 400,
    title: 'PAW Agents',
    titleBarStyle: 'hiddenInset',
    icon: path.join(__dirname, '..', 'icon.png'),
    backgroundColor: '#08080d',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── WebSocket connection to PAW Gateway ───
function connectGateway(): void {
  if (ws) {
    ws.close();
    ws = null;
  }

  const headers: Record<string, string> = {};
  if (AUTH_TOKEN) {
    headers['Authorization'] = `Bearer ${AUTH_TOKEN}`;
  }

  ws = new WebSocket(GATEWAY_URL, { headers });

  ws.on('open', () => {
    console.log('[PAW Desktop] Connected to gateway');
    mainWindow?.webContents.send('gateway:status', 'connected');

    // Register as desktop channel
    ws?.send(JSON.stringify({
      type: 'register',
      channel: 'desktop',
      client_id: `desktop_${Date.now()}`,
    }));
  });

  ws.on('message', (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString());
      mainWindow?.webContents.send('gateway:message', msg);
    } catch {
      // ignore malformed messages
    }
  });

  ws.on('close', () => {
    console.log('[PAW Desktop] Disconnected from gateway');
    mainWindow?.webContents.send('gateway:status', 'disconnected');

    // Auto-reconnect after 3s
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectGateway, 3000);
  });

  ws.on('error', (err) => {
    console.error('[PAW Desktop] WebSocket error:', err.message);
  });
}

// ─── IPC handlers for renderer ───
function setupIPC(): void {
  // Send message to PAW
  ipcMain.handle('paw:send', async (_event, message: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return { error: 'Not connected to PAW gateway' };
    }

    ws.send(JSON.stringify({
      type: 'message',
      channel: 'desktop',
      from: 'desktop-user',
      payload: { text: message },
      timestamp: new Date().toISOString(),
    }));

    return { sent: true };
  });

  // Get connection status
  ipcMain.handle('paw:status', () => {
    return {
      connected: ws?.readyState === WebSocket.OPEN,
      gateway: GATEWAY_URL,
    };
  });

  // Reconnect
  ipcMain.handle('paw:reconnect', () => {
    connectGateway();
    return { reconnecting: true };
  });
}

// ─── System tray ───
function createTray(): void {
  const trayIconPath = path.join(__dirname, '..', 'icon.png');
  const icon = nativeImage.createFromPath(trayIconPath).resize({ width: 18, height: 18 });
  tray = new Tray(icon);
  tray.setToolTip('PAW Hub');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show PAW Hub', click: () => { if (hubWindow) hubWindow.show(); else createHubWindow(); } },
    { label: 'Show Chat', click: () => { if (mainWindow) mainWindow.show(); else { createWindow(); } } },
    { type: 'separator' },
    { label: 'Pawl Companion', type: 'checkbox', checked: true, click: (item) => {
      if (item.checked) {
        pawl = new PawlCompanion();
        pawl.show();
      } else {
        pawl?.hide();
        pawl = null;
      }
    }},
    { type: 'separator' },
    { label: 'Status', enabled: false },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', () => { if (hubWindow) hubWindow.show(); else createHubWindow(); });
}

// ─── App lifecycle ───
app.whenReady().then(() => {
  createHubWindow();
  createTray();
  setupIPC();
  connectGateway();

  // Start Pawl companion
  pawl = new PawlCompanion();
  pawl.show();

  // Listen for Pawl double-click → show Hub
  ipcMain.on('pawl:open-app', () => {
    if (hubWindow) {
      hubWindow.show();
      hubWindow.focus();
    } else {
      createHubWindow();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createHubWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  ws?.close();
});
