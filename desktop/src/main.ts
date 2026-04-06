// ─── PAW Desktop — Electron Main Process ───
// Connects to the PAW WebSocket gateway for chat functionality.

import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } from 'electron';
import * as path from 'path';
import WebSocket from 'ws';

const GATEWAY_URL = process.env.PAW_GATEWAY_URL ?? 'ws://127.0.0.1:18789';
const AUTH_TOKEN = process.env.PAW_AUTH_TOKEN ?? '';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

// ─── Create main window ───
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 500,
    minHeight: 400,
    title: 'PAW Agents',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f0f23',
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
  // Use a simple icon (16x16 paw emoji equivalent)
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setTitle('🐾');
  tray.setToolTip('PAW Agents');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show PAW', click: () => mainWindow?.show() },
    { type: 'separator' },
    { label: 'Status', enabled: false },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', () => mainWindow?.show());
}

// ─── App lifecycle ───
app.whenReady().then(() => {
  createWindow();
  createTray();
  setupIPC();
  connectGateway();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
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
