// ─── PAW Web Dashboard ───
// Serves a real-time agent dashboard via the Gateway HTTP server.
// Features: agent status, chat interface, action log, system health.

export function getDashboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PAW Agents — Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg: #0d1117; --surface: #161b22; --border: #30363d;
      --text: #c9d1d9; --text-muted: #8b949e; --accent: #a855f7;
      --green: #3fb950; --red: #f85149; --yellow: #d29922;
    }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); }
    .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
    header { display: flex; justify-content: space-between; align-items: center; padding: 16px 0; border-bottom: 1px solid var(--border); margin-bottom: 24px; }
    header h1 { font-size: 20px; color: var(--accent); }
    .status-badge { padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600; }
    .status-online { background: rgba(63,185,80,0.15); color: var(--green); }
    .status-offline { background: rgba(248,81,73,0.15); color: var(--red); }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
    .card h3 { font-size: 14px; color: var(--text-muted); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
    .card .value { font-size: 28px; font-weight: 700; }
    .chat-container { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; display: flex; flex-direction: column; height: 500px; }
    .chat-header { padding: 12px 16px; border-bottom: 1px solid var(--border); font-weight: 600; }
    .chat-messages { flex: 1; overflow-y: auto; padding: 16px; }
    .msg { margin-bottom: 12px; padding: 8px 12px; border-radius: 8px; max-width: 80%; }
    .msg-user { background: var(--accent); color: white; margin-left: auto; }
    .msg-agent { background: var(--border); }
    .msg-system { background: rgba(210,153,34,0.15); color: var(--yellow); font-size: 12px; text-align: center; max-width: 100%; }
    .chat-input { display: flex; padding: 12px; border-top: 1px solid var(--border); gap: 8px; }
    .chat-input input { flex: 1; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 8px 12px; color: var(--text); font-size: 14px; outline: none; }
    .chat-input input:focus { border-color: var(--accent); }
    .chat-input button { background: var(--accent); color: white; border: none; border-radius: 6px; padding: 8px 16px; cursor: pointer; font-weight: 600; }
    .chat-input button:hover { opacity: 0.9; }
    .log-container { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; margin-top: 16px; }
    .log-header { padding: 12px 16px; border-bottom: 1px solid var(--border); font-weight: 600; display: flex; justify-content: space-between; }
    .log-entries { max-height: 300px; overflow-y: auto; padding: 8px; font-family: 'JetBrains Mono', 'Fira Code', monospace; font-size: 12px; }
    .log-entry { padding: 4px 8px; border-bottom: 1px solid var(--border); display: flex; gap: 8px; }
    .log-time { color: var(--text-muted); min-width: 80px; }
    .log-phase { min-width: 80px; font-weight: 600; }
    .log-phase.intake { color: #58a6ff; }
    .log-phase.planning { color: var(--accent); }
    .log-phase.validation { color: var(--yellow); }
    .log-phase.execution { color: var(--green); }
    .log-phase.error { color: var(--red); }
    .mode-toggle { display: flex; gap: 8px; align-items: center; }
    .mode-btn { padding: 4px 12px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg); color: var(--text); cursor: pointer; font-size: 12px; }
    .mode-btn.active { background: var(--accent); color: white; border-color: var(--accent); }
    @media (max-width: 768px) { .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>🐾 PAW Agents</h1>
      <div style="display: flex; align-items: center; gap: 12px;">
        <div class="mode-toggle">
          <button class="mode-btn" id="btn-supervised" onclick="setMode('supervised')">🔒 Supervised</button>
          <button class="mode-btn" id="btn-autonomous" onclick="setMode('autonomous')">🤖 Autonomous</button>
        </div>
        <span class="status-badge" id="status-badge">Connecting...</span>
      </div>
    </header>

    <div class="grid">
      <div class="card"><h3>Status</h3><div class="value" id="agent-status">—</div></div>
      <div class="card"><h3>Mode</h3><div class="value" id="agent-mode">—</div></div>
      <div class="card"><h3>Messages</h3><div class="value" id="msg-count">0</div></div>
      <div class="card"><h3>Uptime</h3><div class="value" id="uptime">—</div></div>
    </div>

    <div class="chat-container">
      <div class="chat-header">Agent Chat</div>
      <div class="chat-messages" id="chat-messages"></div>
      <div class="chat-input">
        <input type="text" id="chat-input" placeholder="Send a message to PAW..." onkeydown="if(event.key==='Enter')sendMessage()" />
        <button onclick="sendMessage()">Send</button>
      </div>
    </div>

    <div class="log-container">
      <div class="log-header">
        <span>Action Log</span>
        <button class="mode-btn" onclick="clearLog()">Clear</button>
      </div>
      <div class="log-entries" id="log-entries"></div>
    </div>
  </div>

  <script>
    let ws = null;
    let msgCount = 0;
    let currentMode = 'supervised';

    function connect() {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(proto + '//' + location.host);

      ws.onopen = () => {
        document.getElementById('status-badge').className = 'status-badge status-online';
        document.getElementById('status-badge').textContent = 'Connected';
        document.getElementById('agent-status').textContent = 'Online';
        addSystemMsg('Connected to PAW Agent');
        fetchStatus();
      };

      ws.onclose = () => {
        document.getElementById('status-badge').className = 'status-badge status-offline';
        document.getElementById('status-badge').textContent = 'Disconnected';
        document.getElementById('agent-status').textContent = 'Offline';
        addSystemMsg('Disconnected. Reconnecting...');
        setTimeout(connect, 3000);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          handleMessage(msg);
        } catch(e) {}
      };
    }

    function handleMessage(msg) {
      if (msg.type === 'response' && msg.payload) {
        const resp = msg.payload;
        addAgentMsg(resp.message || JSON.stringify(resp));
        addLog(resp.success ? 'execution' : 'error', resp.message || 'Action completed');
      } else if (msg.type === 'event') {
        const payload = msg.payload || {};
        if (payload.event === 'connected') {
          addLog('intake', 'WebSocket connected (id: ' + (payload.client_id || '?').slice(0,8) + ')');
        }
      }
    }

    function sendMessage() {
      const input = document.getElementById('chat-input');
      const text = input.value.trim();
      if (!text || !ws || ws.readyState !== 1) return;
      input.value = '';
      msgCount++;
      document.getElementById('msg-count').textContent = msgCount;
      addUserMsg(text);
      addLog('planning', 'Processing: ' + text.slice(0, 60));
      ws.send(JSON.stringify({ type: 'message', channel: 'webchat', from: 'user', payload: text, timestamp: new Date().toISOString() }));
    }

    function setMode(mode) {
      currentMode = mode;
      document.getElementById('agent-mode').textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      document.getElementById('btn-' + mode).classList.add('active');
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'command', payload: { command: 'set_mode', mode: mode }, timestamp: new Date().toISOString() }));
      }
      addSystemMsg('Mode switched to: ' + mode);
    }

    function addUserMsg(text) {
      const el = document.createElement('div');
      el.className = 'msg msg-user';
      el.textContent = text;
      document.getElementById('chat-messages').appendChild(el);
      el.scrollIntoView();
    }

    function addAgentMsg(text) {
      const el = document.createElement('div');
      el.className = 'msg msg-agent';
      el.textContent = text;
      document.getElementById('chat-messages').appendChild(el);
      el.scrollIntoView();
    }

    function addSystemMsg(text) {
      const el = document.createElement('div');
      el.className = 'msg msg-system';
      el.textContent = text;
      document.getElementById('chat-messages').appendChild(el);
      el.scrollIntoView();
    }

    function addLog(phase, message) {
      const el = document.createElement('div');
      el.className = 'log-entry';
      el.innerHTML = '<span class="log-time">' + new Date().toLocaleTimeString() + '</span><span class="log-phase ' + phase + '">' + phase + '</span><span>' + escapeHtml(message.slice(0, 120)) + '</span>';
      const container = document.getElementById('log-entries');
      container.insertBefore(el, container.firstChild);
    }

    function clearLog() { document.getElementById('log-entries').innerHTML = ''; }

    function escapeHtml(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

    async function fetchStatus() {
      try {
        const r = await fetch('/api/status');
        const d = await r.json();
        document.getElementById('agent-mode').textContent = (d.mode || 'supervised').charAt(0).toUpperCase() + (d.mode || 'supervised').slice(1);
        currentMode = d.mode || 'supervised';
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        const btn = document.getElementById('btn-' + currentMode);
        if (btn) btn.classList.add('active');
      } catch(e) {}
      try {
        const r = await fetch('/health');
        const d = await r.json();
        const uptime = Math.floor(d.uptime || 0);
        const h = Math.floor(uptime / 3600);
        const m = Math.floor((uptime % 3600) / 60);
        document.getElementById('uptime').textContent = h + 'h ' + m + 'm';
      } catch(e) {}
    }

    setInterval(fetchStatus, 30000);
    connect();
  </script>
</body>
</html>`;
}
