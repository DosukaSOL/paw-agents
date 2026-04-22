// ─── PAW Hub — Desktop OS Experience ───
// Combines Dashboard, Mission Control, CLI Companion, Plugins, and Workflows
// into a single unified desktop application with Pawl companion.

import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, session, globalShortcut, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import WebSocket from 'ws';
import { PawlCompanion } from './companion';

// Allowlist for shell.openExternal — only these hosts may be opened from the renderer.
const EXTERNAL_HOST_ALLOWLIST = new Set([
  'pawagents.ai',
  'www.pawagents.ai',
  'github.com',
  'www.github.com',
  't.me',
  'telegram.org',
  'core.telegram.org',
]);

const GATEWAY_URL = process.env.PAW_GATEWAY_URL ?? 'ws://127.0.0.1:18789';
const AUTH_TOKEN = process.env.PAW_AUTH_TOKEN ?? '';

let mainWindow: BrowserWindow | null = null;
let hubWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 3000;
const MAX_RECONNECT_DELAY = 30000;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 60; // ~30 min of attempts before giving up
let pawl: PawlCompanion | null = null;

// Speech recognition uses Chromium's built-in Web Speech API
// Note: enable-speech-dispatcher is Linux-only and causes mic flashing on macOS, so we skip it

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
  // Clear any pending reconnect timer first to prevent races
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

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
    hubWindow?.webContents.send('gateway:status', 'connected');
    mainWindow?.webContents.send('gateway:status', 'connected');
    reconnectDelay = 3000; // Reset backoff on successful connection
    reconnectAttempts = 0;

    // Register as desktop channel; include auth_token if configured
    ws?.send(JSON.stringify({
      type: 'register',
      channel: 'desktop',
      client_id: `desktop_${Date.now()}`,
      auth_token: AUTH_TOKEN || undefined,
    }));
  });

  ws.on('message', (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString());
      // Forward to BOTH windows (hub + classic chat) so each can react
      hubWindow?.webContents.send('gateway:message', msg);
      mainWindow?.webContents.send('gateway:message', msg);
    } catch {
      // ignore malformed messages
    }
  });

  ws.on('close', () => {
    console.log(`[PAW Desktop] Disconnected from gateway — reconnecting in ${reconnectDelay / 1000}s`);
    hubWindow?.webContents.send('gateway:status', 'disconnected');
    mainWindow?.webContents.send('gateway:status', 'disconnected');

    // Stop trying after too many failed attempts to avoid infinite log spam
    reconnectAttempts++;
    if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      console.error('[PAW Desktop] Giving up reconnect after', MAX_RECONNECT_ATTEMPTS, 'attempts. Restart the framework and the hub.');
      hubWindow?.webContents.send('gateway:status', 'unavailable');
      mainWindow?.webContents.send('gateway:status', 'unavailable');
      return;
    }

    // Auto-reconnect with exponential backoff
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectGateway, reconnectDelay);
    // Mark timer as background so it doesn't block app exit
    if (reconnectTimer.unref) reconnectTimer.unref();
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
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

    try {
      ws.send(JSON.stringify({
        type: 'message',
        channel: 'desktop',
        from: 'desktop-user',
        payload: { text: message },
        timestamp: new Date().toISOString(),
      }));
    } catch (err) {
      return { error: 'Failed to send message: ' + (err as Error).message };
    }

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

  // Open an external URL in the default browser. Allowlisted hosts only.
  ipcMain.handle('paw:openExternal', async (_event, rawUrl: string) => {
    try {
      const u = new URL(String(rawUrl));
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return { error: 'protocol not allowed' };
      if (!EXTERNAL_HOST_ALLOWLIST.has(u.hostname.toLowerCase())) return { error: 'host not allowlisted' };
      await shell.openExternal(u.toString());
      return { ok: true };
    } catch (err) {
      return { error: 'invalid url: ' + (err as Error).message };
    }
  });

  // ─── Config: read/write PAW .env file ───
  const envPath = path.join(__dirname, '..', '..', '.env');

  ipcMain.handle('paw:getConfig', () => {
    try {
      if (!fs.existsSync(envPath)) return {};
      const content = fs.readFileSync(envPath, 'utf-8');
      const config: Record<string, string> = {};
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        config[key] = val;
      }
      return config;
    } catch {
      return {};
    }
  });

  ipcMain.handle('paw:saveConfig', async (_event, updates: Record<string, string>) => {
    try {
      // Validate: only allow known PAW config keys
      const allowedKeys = new Set([
        'DEFAULT_MODEL_PROVIDER', 'DEFAULT_MODEL_NAME',
        'OPENAI_API_KEY', 'ANTHROPIC_API_KEY',
        'GOOGLE_AI_API_KEY', 'GOOGLE_AI_MODEL',
        'GROQ_API_KEY', 'GROQ_MODEL',
        'MISTRAL_API_KEY', 'MISTRAL_MODEL',
        'DEEPSEEK_API_KEY', 'DEEPSEEK_MODEL',
        'XAI_API_KEY', 'XAI_MODEL',
        'COHERE_API_KEY', 'COHERE_MODEL',
        'OLLAMA_ENABLED', 'OLLAMA_BASE_URL', 'OLLAMA_MODEL',
      ]);
      for (const key of Object.keys(updates)) {
        if (!allowedKeys.has(key)) {
          return { error: `Unknown config key: ${key}` };
        }
      }

      let content = '';
      if (fs.existsSync(envPath)) {
        content = fs.readFileSync(envPath, 'utf-8');
      }

      // Update existing keys or append new ones
      const updatedKeys = new Set<string>();
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        if (key in updates) {
          lines[i] = `${key}=${updates[key]}`;
          updatedKeys.add(key);
        }
      }

      // Append keys that didn't exist yet
      for (const [key, val] of Object.entries(updates)) {
        if (!updatedKeys.has(key)) {
          lines.push(`${key}=${val}`);
        }
      }

      fs.writeFileSync(envPath, lines.join('\n'), 'utf-8');
      return { saved: true };
    } catch (err: unknown) {
      return { error: String(err) };
    }
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
  // Grant microphone permission only for our local hub renderer files (file://).
  // Reject permission requests from any other origin for safety.
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = ['media', 'microphone', 'audioCapture'];
    if (!allowed.includes(permission)) return callback(false);
    const url = webContents.getURL();
    const isLocal = url.startsWith('file://') || url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost');
    callback(isLocal);
  });
  // Also explicitly check existing permissions per-origin
  session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    const allowed = ['media', 'microphone', 'audioCapture'];
    if (!allowed.includes(permission)) return false;
    return requestingOrigin.startsWith('file://') ||
      requestingOrigin.startsWith('http://127.0.0.1') ||
      requestingOrigin.startsWith('http://localhost');
  });

  createHubWindow();
  createTray();
  setupIPC();
  connectGateway();

  // Global hotkey: Cmd/Ctrl+Shift+P toggles Hub focus
  try {
    const accelerator = process.platform === 'darwin' ? 'Cmd+Shift+P' : 'Ctrl+Shift+P';
    const registered = globalShortcut.register(accelerator, () => {
      if (!hubWindow) { createHubWindow(); return; }
      if (hubWindow.isFocused() && hubWindow.isVisible()) hubWindow.hide();
      else { hubWindow.show(); hubWindow.focus(); }
    });
    if (!registered) console.warn('[PAW Desktop] Global hotkey could not be registered');
  } catch (err) {
    console.warn('[PAW Desktop] Global shortcut registration failed:', (err as Error).message);
  }

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

  // Toggle Pawl companion from Hub sidebar button
  ipcMain.handle('pawl:toggle', (_event, enabled: boolean) => {
    if (enabled) {
      if (!pawl) {
        pawl = new PawlCompanion();
      }
      pawl.show();
    } else {
      if (pawl) {
        pawl.hide();
        pawl = null;
      }
    }
    return { toggled: enabled };
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
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  try { globalShortcut.unregisterAll(); } catch { /* ignore */ }
  ws?.close();
});
