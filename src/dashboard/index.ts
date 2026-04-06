// ─── PAW Web Dashboard ───
// Serves a real-time agent dashboard via the Gateway HTTP server.
// Professional terminal-style interface with real-time WebSocket communication.

export function getDashboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PAW Agents</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg: #09090b; --surface: #18181b; --surface-2: #1f1f23;
      --border: #27272a; --border-hover: #3f3f46;
      --text: #fafafa; --text-secondary: #a1a1aa; --text-muted: #71717a;
      --accent: #8b5cf6; --accent-dim: rgba(139,92,246,0.12); --accent-border: rgba(139,92,246,0.25);
      --green: #22c55e; --green-dim: rgba(34,197,94,0.12);
      --red: #ef4444; --red-dim: rgba(239,68,68,0.12);
      --amber: #f59e0b; --amber-dim: rgba(245,158,11,0.12);
      --blue: #3b82f6; --blue-dim: rgba(59,130,246,0.12);
      --radius: 6px; --radius-lg: 10px;
    }
    html { font-size: 14px; }
    body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; -webkit-font-smoothing: antialiased; }

    /* Layout */
    .app { display: grid; grid-template-rows: auto 1fr; height: 100vh; }
    .topbar { display: flex; align-items: center; justify-content: space-between; padding: 0 24px; height: 56px; border-bottom: 1px solid var(--border); background: var(--surface); }
    .topbar-left { display: flex; align-items: center; gap: 12px; }
    .topbar-logo { height: 28px; width: 28px; opacity: 0.95; }
    .topbar-title { font-size: 15px; font-weight: 600; letter-spacing: -0.01em; }
    .topbar-version { font-size: 11px; color: var(--text-muted); font-family: 'JetBrains Mono', monospace; background: var(--surface-2); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border); }
    .topbar-right { display: flex; align-items: center; gap: 16px; }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
    .status-dot.online { background: var(--green); box-shadow: 0 0 6px var(--green); }
    .status-dot.offline { background: var(--red); box-shadow: 0 0 6px var(--red); }
    .status-label { font-size: 12px; color: var(--text-secondary); display: flex; align-items: center; gap: 6px; }

    .main { display: grid; grid-template-columns: 260px 1fr 320px; overflow: hidden; }

    /* Sidebar */
    .sidebar { background: var(--surface); border-right: 1px solid var(--border); padding: 20px 16px; display: flex; flex-direction: column; gap: 24px; overflow-y: auto; }
    .sidebar-section h4 { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); margin-bottom: 12px; }
    .stat-card { background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px; margin-bottom: 8px; transition: border-color 0.15s; }
    .stat-card:hover { border-color: var(--border-hover); }
    .stat-label { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
    .stat-value { font-size: 20px; font-weight: 700; font-family: 'JetBrains Mono', monospace; letter-spacing: -0.02em; }
    .stat-value.green { color: var(--green); }
    .stat-value.accent { color: var(--accent); }

    .mode-group { display: flex; flex-direction: column; gap: 4px; }
    .mode-option { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: var(--radius); cursor: pointer; font-size: 13px; color: var(--text-secondary); border: 1px solid transparent; transition: all 0.15s; background: none; width: 100%; text-align: left; }
    .mode-option:hover { background: var(--surface-2); color: var(--text); }
    .mode-option.active { background: var(--accent-dim); color: var(--accent); border-color: var(--accent-border); }
    .mode-icon { width: 16px; text-align: center; font-size: 11px; font-family: 'JetBrains Mono', monospace; }
    .mode-label { font-weight: 500; }

    .pipeline-list { display: flex; flex-direction: column; gap: 2px; }
    .pipeline-step { font-size: 12px; font-family: 'JetBrains Mono', monospace; color: var(--text-muted); padding: 3px 0; display: flex; align-items: center; gap: 6px; }
    .pipeline-arrow { color: var(--border-hover); }

    /* Chat */
    .chat-panel { display: flex; flex-direction: column; border-right: 1px solid var(--border); }
    .chat-header { padding: 16px 20px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
    .chat-header-title { font-size: 13px; font-weight: 600; }
    .chat-header-meta { font-size: 11px; color: var(--text-muted); font-family: 'JetBrains Mono', monospace; }
    .chat-messages { flex: 1; overflow-y: auto; padding: 16px 20px; display: flex; flex-direction: column; gap: 2px; }
    .msg-row { display: flex; flex-direction: column; padding: 6px 0; }
    .msg-row.user { align-items: flex-end; }
    .msg-sender { font-size: 11px; font-weight: 500; margin-bottom: 4px; color: var(--text-muted); }
    .msg-bubble { padding: 10px 14px; border-radius: var(--radius-lg); max-width: 85%; font-size: 13px; line-height: 1.55; white-space: pre-wrap; word-wrap: break-word; }
    .msg-row.user .msg-bubble { background: var(--accent); color: white; border-bottom-right-radius: 2px; }
    .msg-row.agent .msg-bubble { background: var(--surface-2); border: 1px solid var(--border); border-bottom-left-radius: 2px; }
    .msg-row.system .msg-bubble { background: transparent; color: var(--text-muted); font-size: 11px; text-align: center; align-self: center; font-family: 'JetBrains Mono', monospace; }
    .chat-input-area { padding: 12px 20px; border-top: 1px solid var(--border); display: flex; gap: 8px; }
    .chat-input-area input { flex: 1; background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); padding: 10px 14px; color: var(--text); font-size: 13px; font-family: 'Inter', sans-serif; outline: none; transition: border-color 0.15s; }
    .chat-input-area input:focus { border-color: var(--accent); }
    .chat-input-area input::placeholder { color: var(--text-muted); }
    .send-btn { background: var(--accent); color: white; border: none; border-radius: var(--radius); padding: 10px 18px; cursor: pointer; font-size: 13px; font-weight: 500; font-family: 'Inter', sans-serif; transition: opacity 0.15s; }
    .send-btn:hover { opacity: 0.85; }
    .send-btn:active { opacity: 0.7; }

    /* Log Panel */
    .log-panel { background: var(--surface); display: flex; flex-direction: column; }
    .log-header { padding: 16px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
    .log-header-title { font-size: 13px; font-weight: 600; }
    .log-clear { font-size: 11px; color: var(--text-muted); background: none; border: 1px solid var(--border); border-radius: 4px; padding: 3px 8px; cursor: pointer; font-family: 'Inter', sans-serif; }
    .log-clear:hover { color: var(--text-secondary); border-color: var(--border-hover); }
    .log-entries { flex: 1; overflow-y: auto; padding: 8px 12px; font-family: 'JetBrains Mono', monospace; font-size: 11px; line-height: 1.7; }
    .log-line { display: flex; gap: 8px; padding: 2px 0; }
    .log-ts { color: var(--text-muted); min-width: 64px; flex-shrink: 0; }
    .log-tag { min-width: 70px; flex-shrink: 0; font-weight: 500; }
    .log-tag.intake { color: var(--blue); }
    .log-tag.planning { color: var(--accent); }
    .log-tag.validation { color: var(--amber); }
    .log-tag.execution { color: var(--green); }
    .log-tag.error { color: var(--red); }
    .log-tag.system { color: var(--text-muted); }
    .log-msg { color: var(--text-secondary); word-break: break-word; }

    /* Responsive */
    @media (max-width: 1024px) {
      .main { grid-template-columns: 1fr; }
      .sidebar, .log-panel { display: none; }
    }
    /* Scrollbar */
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: var(--border-hover); }
  </style>
</head>
<body>
  <div class="app">
    <div class="topbar">
      <div class="topbar-left">
        <img src="/assets/logo-transparent.png" alt="PAW" class="topbar-logo" />
        <span class="topbar-title">PAW Agents</span>
        <span class="topbar-version">v3.0.0</span>
      </div>
      <div class="topbar-right">
        <span class="status-label"><span class="status-dot" id="status-dot"></span> <span id="status-text">Connecting</span></span>
      </div>
    </div>

    <div class="main">
      <div class="sidebar">
        <div class="sidebar-section">
          <h4>System</h4>
          <div class="stat-card"><div class="stat-label">Status</div><div class="stat-value green" id="agent-status">--</div></div>
          <div class="stat-card"><div class="stat-label">Uptime</div><div class="stat-value" id="uptime">--</div></div>
          <div class="stat-card"><div class="stat-label">Messages</div><div class="stat-value accent" id="msg-count">0</div></div>
        </div>

        <div class="sidebar-section">
          <h4>Mode</h4>
          <div class="mode-group">
            <button class="mode-option active" id="btn-supervised" onclick="setMode('supervised')"><span class="mode-icon">S</span><span class="mode-label">Supervised</span></button>
            <button class="mode-option" id="btn-autonomous" onclick="setMode('autonomous')"><span class="mode-icon">A</span><span class="mode-label">Autonomous</span></button>
          </div>
        </div>

        <div class="sidebar-section">
          <h4>Pipeline</h4>
          <div class="pipeline-list">
            <div class="pipeline-step">INTENT</div>
            <div class="pipeline-step"><span class="pipeline-arrow">|</span></div>
            <div class="pipeline-step">PLAN</div>
            <div class="pipeline-step"><span class="pipeline-arrow">|</span></div>
            <div class="pipeline-step">VALIDATE</div>
            <div class="pipeline-step"><span class="pipeline-arrow">|</span></div>
            <div class="pipeline-step">EXECUTE</div>
            <div class="pipeline-step"><span class="pipeline-arrow">|</span></div>
            <div class="pipeline-step">VERIFY</div>
            <div class="pipeline-step"><span class="pipeline-arrow">|</span></div>
            <div class="pipeline-step">LOG</div>
          </div>
        </div>
      </div>

      <div class="chat-panel">
        <div class="chat-header">
          <span class="chat-header-title">Agent Terminal</span>
          <span class="chat-header-meta" id="session-id">--</span>
        </div>
        <div class="chat-messages" id="chat-messages"></div>
        <div class="chat-input-area">
          <input type="text" id="chat-input" placeholder="Enter a command or message..." onkeydown="if(event.key==='Enter')sendMessage()" autocomplete="off" spellcheck="false" />
          <button class="send-btn" onclick="sendMessage()">Send</button>
        </div>
      </div>

      <div class="log-panel">
        <div class="log-header">
          <span class="log-header-title">Activity</span>
          <button class="log-clear" onclick="clearLog()">Clear</button>
        </div>
        <div class="log-entries" id="log-entries"></div>
      </div>
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
        document.getElementById('status-dot').className = 'status-dot online';
        document.getElementById('status-text').textContent = 'Connected';
        document.getElementById('agent-status').textContent = 'Online';
        addSystemMsg('session established');
        fetchStatus();
      };

      ws.onclose = () => {
        document.getElementById('status-dot').className = 'status-dot offline';
        document.getElementById('status-text').textContent = 'Disconnected';
        document.getElementById('agent-status').textContent = 'Offline';
        addSystemMsg('connection lost — reconnecting');
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
          const sid = (payload.client_id || '').slice(0,8);
          document.getElementById('session-id').textContent = 'session: ' + sid;
          addLog('system', 'connected — client ' + sid);
        }
        if (payload.event === 'authenticated') {
          addLog('system', 'authenticated');
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
      addLog('planning', text.slice(0, 80));
      ws.send(JSON.stringify({ type: 'message', channel: 'webchat', from: 'user', payload: text, timestamp: new Date().toISOString() }));
    }

    function setMode(mode) {
      currentMode = mode;
      document.querySelectorAll('.mode-option').forEach(b => b.classList.remove('active'));
      document.getElementById('btn-' + mode).classList.add('active');
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'command', payload: { command: 'set_mode', mode: mode }, timestamp: new Date().toISOString() }));
      }
      addLog('system', 'mode -> ' + mode);
    }

    function addUserMsg(text) {
      const row = document.createElement('div');
      row.className = 'msg-row user';
      row.innerHTML = '<div class="msg-sender">You</div><div class="msg-bubble">' + escapeHtml(text) + '</div>';
      document.getElementById('chat-messages').appendChild(row);
      row.scrollIntoView({ behavior: 'smooth' });
    }

    function addAgentMsg(text) {
      const row = document.createElement('div');
      row.className = 'msg-row agent';
      row.innerHTML = '<div class="msg-sender">PAW</div><div class="msg-bubble">' + escapeHtml(text) + '</div>';
      document.getElementById('chat-messages').appendChild(row);
      row.scrollIntoView({ behavior: 'smooth' });
    }

    function addSystemMsg(text) {
      const row = document.createElement('div');
      row.className = 'msg-row system';
      row.innerHTML = '<div class="msg-bubble">' + escapeHtml(text) + '</div>';
      document.getElementById('chat-messages').appendChild(row);
      row.scrollIntoView({ behavior: 'smooth' });
    }

    function addLog(tag, message) {
      const el = document.createElement('div');
      el.className = 'log-line';
      const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
      el.innerHTML = '<span class="log-ts">' + ts + '</span><span class="log-tag ' + tag + '">' + tag + '</span><span class="log-msg">' + escapeHtml(message.slice(0, 140)) + '</span>';
      const container = document.getElementById('log-entries');
      container.insertBefore(el, container.firstChild);
    }

    function clearLog() { document.getElementById('log-entries').innerHTML = ''; }
    function escapeHtml(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

    async function fetchStatus() {
      try {
        const r = await fetch('/api/status');
        const d = await r.json();
        currentMode = d.mode || 'supervised';
        document.querySelectorAll('.mode-option').forEach(b => b.classList.remove('active'));
        const btn = document.getElementById('btn-' + currentMode);
        if (btn) btn.classList.add('active');
      } catch(e) {}
      try {
        const r = await fetch('/health');
        const d = await r.json();
        const up = Math.floor(d.uptime || 0);
        const h = Math.floor(up / 3600);
        const m = Math.floor((up % 3600) / 60);
        document.getElementById('uptime').textContent = (h > 0 ? h + 'h ' : '') + m + 'm';
      } catch(e) {}
    }

    setInterval(fetchStatus, 30000);
    connect();
  </script>
</body>
</html>`;
}
