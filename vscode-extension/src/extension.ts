// ─── PAW VS Code Extension ───
// Chat with your PAW agent directly from the editor.
// Connects to the PAW WebSocket gateway.

import * as vscode from 'vscode';
import WebSocket from 'ws';

let ws: WebSocket | null = null;
let currentPanel: vscode.WebviewPanel | null = null;
let outputChannel: vscode.OutputChannel;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

// ─── Activate ───
export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel('PAW Agents');
  outputChannel.appendLine('[PAW] Extension activated');

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('paw.openChat', () => openChatPanel(context)),
    vscode.commands.registerCommand('paw.sendSelection', () => sendSelection()),
    vscode.commands.registerCommand('paw.setGateway', () => setGateway()),
  );

  // Register webview provider for sidebar
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('pawChat', new PawChatViewProvider(context)),
  );

  // Connect to gateway on startup
  connectGateway();
}

// ─── Deactivate ───
export function deactivate(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  ws?.close();
}

// ─── Connect to PAW Gateway ───
function connectGateway(): void {
  const config = vscode.workspace.getConfiguration('paw');
  const gatewayUrl = config.get<string>('gatewayUrl', 'ws://127.0.0.1:18789');
  const authToken = config.get<string>('authToken', '');

  if (ws) {
    ws.close();
    ws = null;
  }

  const headers: Record<string, string> = {};
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  try {
    ws = new WebSocket(gatewayUrl, { headers });

    ws.on('open', () => {
      outputChannel.appendLine('[PAW] Connected to gateway');
      ws?.send(JSON.stringify({
        type: 'register',
        channel: 'vscode',
        client_id: `vscode_${Date.now()}`,
      }));
    });

    ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        handleIncomingMessage(msg);
      } catch {
        // ignore
      }
    });

    ws.on('close', () => {
      outputChannel.appendLine('[PAW] Disconnected from gateway');
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connectGateway, 5000);
    });

    ws.on('error', (err) => {
      outputChannel.appendLine(`[PAW] Error: ${err.message}`);
    });
  } catch (err) {
    outputChannel.appendLine(`[PAW] Connection failed: ${(err as Error).message}`);
  }
}

// ─── Handle incoming messages ───
function handleIncomingMessage(msg: { type: string; payload?: { text?: string } }): void {
  const text = msg.payload?.text;
  if (!text) return;

  // Forward to any open chat panels
  currentPanel?.webview.postMessage({ type: 'response', text });
}

// ─── Send selected text to agent ───
function sendSelection(): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('No text selected');
    return;
  }

  const selection = editor.document.getText(editor.selection);
  if (!selection) {
    vscode.window.showWarningMessage('No text selected');
    return;
  }

  sendToPaw(`Analyze this code:\n\`\`\`\n${selection}\n\`\`\``);
}

// ─── Send message to PAW ───
function sendToPaw(message: string): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    vscode.window.showErrorMessage('Not connected to PAW gateway. Run `PAW: Set Gateway` to configure.');
    return;
  }

  ws.send(JSON.stringify({
    type: 'message',
    channel: 'vscode',
    from: 'vscode-user',
    payload: { text: message },
    timestamp: new Date().toISOString(),
  }));
}

// ─── Set gateway URL ───
async function setGateway(): Promise<void> {
  const url = await vscode.window.showInputBox({
    prompt: 'PAW Gateway WebSocket URL',
    value: vscode.workspace.getConfiguration('paw').get('gatewayUrl', 'ws://127.0.0.1:18789'),
    placeHolder: 'ws://127.0.0.1:18789',
  });

  if (url) {
    await vscode.workspace.getConfiguration('paw').update('gatewayUrl', url, true);
    connectGateway();
    vscode.window.showInformationMessage(`PAW gateway set to ${url}`);
  }
}

// ─── Open chat in editor panel ───
function openChatPanel(context: vscode.ExtensionContext): void {
  if (currentPanel) {
    currentPanel.reveal();
    return;
  }

  currentPanel = vscode.window.createWebviewPanel(
    'pawChat',
    '🐾 PAW Chat',
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    },
  );

  currentPanel.webview.html = getChatHTML();

  currentPanel.webview.onDidReceiveMessage((msg) => {
    if (msg.type === 'send' && msg.text) {
      sendToPaw(msg.text);
    }
  });

  currentPanel.onDidDispose(() => {
    currentPanel = null;
  });
}

// ─── Sidebar webview provider ───
class PawChatViewProvider implements vscode.WebviewViewProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = getChatHTML();

    webviewView.webview.onDidReceiveMessage((msg) => {
      if (msg.type === 'send' && msg.text) {
        sendToPaw(msg.text);
      }
    });
  }
}

// ─── Chat HTML ───
function getChatHTML(): string {
  return `<!DOCTYPE html>
<html><head>
<style>
  body { font-family: var(--vscode-font-family); background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); margin: 0; display: flex; flex-direction: column; height: 100vh; }
  #chat { flex: 1; overflow-y: auto; padding: 12px; }
  .msg { margin-bottom: 12px; padding: 8px 12px; border-radius: 10px; max-width: 85%; white-space: pre-wrap; word-wrap: break-word; font-size: 13px; line-height: 1.5; }
  .user { background: var(--vscode-button-background); color: var(--vscode-button-foreground); margin-left: auto; }
  .agent { background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); }
  #inputArea { display: flex; gap: 8px; padding: 8px 12px; border-top: 1px solid var(--vscode-input-border); }
  #input { flex: 1; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 6px; padding: 8px; font-size: 13px; outline: none; }
  #sendBtn { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 6px; padding: 8px 16px; cursor: pointer; font-weight: 600; }
</style>
</head><body>
<div id="chat"></div>
<div id="inputArea">
  <input id="input" placeholder="Message PAW..." />
  <button id="sendBtn">Send</button>
</div>
<script>
  const vscode = acquireVsCodeApi();
  const chat = document.getElementById('chat');
  const input = document.getElementById('input');
  function addMsg(text, role) {
    const d = document.createElement('div');
    d.className = 'msg ' + role;
    d.textContent = text;
    chat.appendChild(d);
    chat.scrollTop = chat.scrollHeight;
  }
  function send() {
    const t = input.value.trim();
    if (!t) return;
    addMsg(t, 'user');
    vscode.postMessage({ type: 'send', text: t });
    input.value = '';
  }
  document.getElementById('sendBtn').onclick = send;
  input.onkeydown = (e) => { if (e.key === 'Enter') send(); };
  window.addEventListener('message', (e) => {
    if (e.data.type === 'response') addMsg(e.data.text, 'agent');
  });
  addMsg('🐾 PAW Agents — Chat with your AI agent from VS Code.', 'agent');
</script>
</body></html>`;
}
