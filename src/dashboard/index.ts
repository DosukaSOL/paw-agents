// ─── PAW Web Dashboard ───
// Serves a real-time agent dashboard via the Gateway HTTP server.
// Matches the PAW website design system — same palette, fonts, animations, theme toggle.

export function getDashboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PAW Agents — Dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Playfair+Display:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

    :root {
      --font-serif: 'Playfair Display', Georgia, serif;
      --font-sans: 'Inter', system-ui, -apple-system, sans-serif;
      --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
      --radius-sm: 8px;
      --radius-md: 12px;
      --radius-lg: 16px;
      --radius-full: 9999px;
      --transition: 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }

    [data-theme="dark"] {
      --bg-primary: #08080d;
      --bg-secondary: #0e0e16;
      --bg-card: #13131f;
      --bg-card-hover: #1a1a2e;
      --bg-elevated: #1e1e32;
      --border-subtle: rgba(124, 58, 237, 0.12);
      --border-standard: rgba(124, 58, 237, 0.2);
      --border-bright: rgba(124, 58, 237, 0.35);
      --text-primary: #f0eef5;
      --text-secondary: #a8a4b8;
      --text-tertiary: #6b6880;
      --brand: #7c3aed;
      --brand-light: #a78bfa;
      --brand-dark: #6d28d9;
      --brand-glow: rgba(124, 58, 237, 0.15);
      --accent: #22d3ee;
      --accent-glow: rgba(34, 211, 238, 0.1);
      --success: #34d399;
      --warning: #fbbf24;
      --error: #f87171;
      --blue: #60a5fa;
      --nav-bg: rgba(8, 8, 13, 0.92);
      --code-bg: #0c0c14;
      --shadow-glow: 0 0 40px rgba(124, 58, 237, 0.08);
    }

    [data-theme="light"] {
      --bg-primary: #f8f7fc;
      --bg-secondary: #efedf6;
      --bg-card: #ffffff;
      --bg-card-hover: #f5f3fa;
      --bg-elevated: #ffffff;
      --border-subtle: rgba(124, 58, 237, 0.08);
      --border-standard: rgba(124, 58, 237, 0.15);
      --border-bright: rgba(124, 58, 237, 0.3);
      --text-primary: #1a1a2e;
      --text-secondary: #5e5b6e;
      --text-tertiary: #8a879a;
      --brand: #7c3aed;
      --brand-light: #8b5cf6;
      --brand-dark: #6d28d9;
      --brand-glow: rgba(124, 58, 237, 0.06);
      --accent: #0891b2;
      --accent-glow: rgba(8, 145, 178, 0.06);
      --success: #059669;
      --warning: #d97706;
      --error: #dc2626;
      --blue: #3b82f6;
      --nav-bg: rgba(248, 247, 252, 0.92);
      --code-bg: #f0eef5;
      --shadow-glow: 0 0 40px rgba(124, 58, 237, 0.04);
    }

    html { font-size: 14px; }

    body {
      font-family: var(--font-sans);
      background: var(--bg-primary);
      color: var(--text-primary);
      min-height: 100vh;
      -webkit-font-smoothing: antialiased;
      transition: background var(--transition), color var(--transition);
    }

    ::selection { background: rgba(124, 58, 237, 0.3); }

    @keyframes pulse-glow {
      0%, 100% { box-shadow: 0 0 6px var(--success); }
      50% { box-shadow: 0 0 14px var(--success); }
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* ─── Layout ─── */
    .app { display: grid; grid-template-rows: auto 1fr; height: 100vh; }

    /* ─── Top Bar ─── */
    .topbar {
      display: flex; align-items: center; justify-content: space-between;
      padding: 0 24px; height: 56px;
      background: var(--nav-bg);
      backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
      border-bottom: 1px solid var(--border-subtle);
      transition: background var(--transition), border-color var(--transition);
      z-index: 100;
    }

    .topbar-left { display: flex; align-items: center; gap: 12px; }

    .topbar-logo {
      height: 30px; width: auto; opacity: 0.95;
      filter: drop-shadow(0 0 8px rgba(124, 58, 237, 0.15));
    }

    .topbar-title {
      font-family: var(--font-serif);
      font-size: 1.1rem; font-weight: 600;
      color: var(--text-primary);
    }

    .topbar-badge {
      font-size: 0.7rem; font-family: var(--font-mono); font-weight: 500;
      color: var(--brand-light);
      background: var(--brand-glow);
      border: 1px solid var(--border-standard);
      padding: 2px 8px; border-radius: var(--radius-full);
    }

    .topbar-right { display: flex; align-items: center; gap: 14px; }

    .status-indicator {
      display: flex; align-items: center; gap: 8px;
      font-size: 0.78rem; font-weight: 500; color: var(--text-secondary);
    }

    .status-dot {
      width: 8px; height: 8px; border-radius: 50%;
      transition: all var(--transition);
    }

    .status-dot.online { background: var(--success); animation: pulse-glow 2s infinite; }
    .status-dot.offline { background: var(--error); box-shadow: 0 0 6px var(--error); }
    .status-dot.connecting { background: var(--warning); box-shadow: 0 0 6px var(--warning); }

    .theme-toggle {
      width: 34px; height: 34px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border-standard);
      background: var(--bg-card);
      color: var(--text-secondary);
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      font-size: 0.95rem;
      transition: all var(--transition);
    }

    .theme-toggle:hover { border-color: var(--brand); color: var(--brand); background: var(--brand-glow); }

    /* ─── Main Grid ─── */
    .main { display: grid; grid-template-columns: 260px 1fr 340px; overflow: hidden; }

    /* ─── Sidebar ─── */
    .sidebar {
      background: var(--bg-secondary);
      border-right: 1px solid var(--border-subtle);
      padding: 20px 16px;
      display: flex; flex-direction: column; gap: 24px;
      overflow-y: auto;
      transition: background var(--transition), border-color var(--transition);
    }

    .sidebar-section h4 {
      font-family: var(--font-mono);
      font-size: 0.68rem; font-weight: 500;
      text-transform: uppercase; letter-spacing: 1.5px;
      color: var(--brand-light);
      margin-bottom: 12px;
    }

    .stat-card {
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-sm);
      padding: 14px;
      margin-bottom: 8px;
      transition: all var(--transition);
      position: relative;
      overflow: hidden;
    }

    .stat-card::before {
      content: '';
      position: absolute; top: 0; left: 0; right: 0; height: 2px;
      background: linear-gradient(90deg, var(--brand), var(--accent));
      opacity: 0;
      transition: opacity var(--transition);
    }

    .stat-card:hover { border-color: var(--border-bright); box-shadow: var(--shadow-glow); }
    .stat-card:hover::before { opacity: 1; }

    .stat-label {
      font-size: 0.7rem; font-weight: 500; font-family: var(--font-mono);
      color: var(--text-tertiary);
      text-transform: uppercase; letter-spacing: 0.8px;
      margin-bottom: 6px;
    }

    .stat-value {
      font-family: var(--font-serif);
      font-size: 1.4rem; font-weight: 700;
    }

    .stat-value.success { color: var(--success); }
    .stat-value.brand  { color: var(--brand-light); }

    .mode-group { display: flex; flex-direction: column; gap: 6px; }

    .mode-option {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 12px; border-radius: var(--radius-sm);
      cursor: pointer; font-size: 0.85rem; font-weight: 500;
      color: var(--text-secondary);
      border: 1px solid transparent;
      background: none;
      width: 100%; text-align: left;
      transition: all var(--transition);
      font-family: var(--font-sans);
    }

    .mode-option:hover { background: var(--bg-card); color: var(--text-primary); border-color: var(--border-subtle); }

    .mode-option.active {
      background: var(--brand-glow);
      color: var(--brand-light);
      border-color: var(--border-standard);
    }

    .mode-option.mode-free { border-color: transparent; }
    .mode-option.mode-free:hover { border-color: #ef4444; background: rgba(239, 68, 68, 0.08); color: #ef4444; }
    .mode-option.mode-free.active { background: rgba(239, 68, 68, 0.12); color: #ef4444; border-color: #ef4444; }
    .mode-option.mode-free.active .mode-icon { background: rgba(239, 68, 68, 0.12); border-color: #ef4444; color: #ef4444; }

    .free-modal-overlay {
      display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0,0,0,0.7); z-index: 9999; align-items: center; justify-content: center;
    }
    .free-modal-overlay.visible { display: flex; }
    .free-modal {
      background: var(--bg-secondary); border: 1px solid #ef4444; border-radius: 12px;
      padding: 32px; max-width: 480px; width: 90%;
    }
    .free-modal h3 { color: #ef4444; margin: 0 0 16px; font-family: var(--font-serif); }
    .free-modal p { color: var(--text-secondary); font-size: 0.85rem; line-height: 1.6; margin: 0 0 12px; }
    .free-modal .warn-text { color: #ef4444; font-weight: 600; font-size: 0.85rem; }
    .free-modal-actions { display: flex; gap: 12px; margin-top: 20px; }
    .free-modal-actions button {
      flex: 1; padding: 10px; border-radius: 8px; border: 1px solid var(--border-subtle);
      font-family: var(--font-sans); font-size: 0.82rem; cursor: pointer; font-weight: 600;
    }
    .btn-cancel-free { background: var(--bg-card); color: var(--text-primary); }
    .btn-cancel-free:hover { border-color: var(--brand); }
    .btn-proceed-free { background: rgba(239, 68, 68, 0.1); color: #ef4444; border-color: #ef4444 !important; }
    .btn-proceed-free:hover { background: rgba(239, 68, 68, 0.2); }

    .mode-icon {
      width: 24px; height: 24px;
      display: flex; align-items: center; justify-content: center;
      font-size: 0.7rem; font-family: var(--font-mono); font-weight: 600;
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
    }

    .mode-option.active .mode-icon {
      background: var(--brand-glow);
      border-color: var(--brand);
      color: var(--brand-light);
    }

    .pipeline-list { display: flex; flex-direction: column; gap: 0; }

    .pipeline-step {
      font-size: 0.72rem; font-family: var(--font-mono); font-weight: 500;
      color: var(--text-tertiary);
      padding: 6px 10px;
      display: flex; align-items: center; gap: 8px;
      border-radius: 6px;
      transition: all var(--transition);
    }

    .pipeline-step:hover { color: var(--brand-light); background: var(--brand-glow); }

    .pipeline-num {
      width: 18px; height: 18px;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 0.6rem;
      border-radius: 4px;
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      color: var(--brand-light);
    }

    /* ─── Chat Panel ─── */
    .chat-panel {
      display: flex; flex-direction: column;
      border-right: 1px solid var(--border-subtle);
      background: var(--bg-primary);
      transition: background var(--transition), border-color var(--transition);
    }

    .chat-header {
      padding: 16px 24px;
      border-bottom: 1px solid var(--border-subtle);
      display: flex; align-items: center; justify-content: space-between;
      background: var(--bg-secondary);
      transition: background var(--transition);
    }

    .chat-header-title {
      font-family: var(--font-serif);
      font-size: 0.95rem; font-weight: 600;
    }

    .chat-header-meta {
      font-size: 0.7rem; color: var(--text-tertiary);
      font-family: var(--font-mono);
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      padding: 3px 10px; border-radius: var(--radius-full);
    }

    .chat-messages {
      flex: 1; overflow-y: auto;
      padding: 20px 24px;
      display: flex; flex-direction: column; gap: 4px;
    }

    .msg-row { display: flex; flex-direction: column; padding: 6px 0; animation: fadeIn 0.3s ease; }
    .msg-row.user { align-items: flex-end; }

    .msg-sender {
      font-size: 0.68rem; font-weight: 600;
      font-family: var(--font-mono);
      text-transform: uppercase; letter-spacing: 1px;
      margin-bottom: 4px; color: var(--text-tertiary);
    }

    .msg-bubble {
      padding: 12px 16px; border-radius: var(--radius-md);
      max-width: 85%; font-size: 0.88rem; line-height: 1.6;
      white-space: pre-wrap; word-wrap: break-word;
    }

    .msg-row.user .msg-bubble {
      background: var(--brand);
      color: #fff;
      border-bottom-right-radius: 4px;
      box-shadow: 0 2px 12px rgba(124, 58, 237, 0.2);
    }

    .msg-row.agent .msg-bubble {
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-bottom-left-radius: 4px;
    }

    .msg-row.system .msg-bubble {
      background: transparent;
      color: var(--text-tertiary);
      font-size: 0.72rem;
      text-align: center; align-self: center;
      font-family: var(--font-mono);
    }

    .chat-input-area {
      padding: 16px 24px;
      border-top: 1px solid var(--border-subtle);
      display: flex; gap: 10px;
      background: var(--bg-secondary);
      transition: background var(--transition);
    }

    .chat-input-area input {
      flex: 1;
      background: var(--bg-primary);
      border: 1px solid var(--border-standard);
      border-radius: var(--radius-sm);
      padding: 12px 16px;
      color: var(--text-primary);
      font-size: 0.88rem;
      font-family: var(--font-sans);
      outline: none;
      transition: all var(--transition);
    }

    .chat-input-area input:focus { border-color: var(--brand); box-shadow: 0 0 0 3px var(--brand-glow); }
    .chat-input-area input::placeholder { color: var(--text-tertiary); }

    .send-btn {
      background: var(--brand);
      color: #fff;
      border: none;
      border-radius: var(--radius-sm);
      padding: 12px 22px;
      cursor: pointer;
      font-size: 0.85rem; font-weight: 500;
      font-family: var(--font-sans);
      transition: all var(--transition);
    }

    .send-btn:hover { background: var(--brand-dark); box-shadow: 0 0 20px rgba(124, 58, 237, 0.25); }
    .send-btn:active { transform: scale(0.97); }

    /* ─── Log Panel ─── */
    .log-panel {
      background: var(--bg-secondary);
      display: flex; flex-direction: column;
      transition: background var(--transition);
    }

    .log-header {
      padding: 16px 20px;
      border-bottom: 1px solid var(--border-subtle);
      display: flex; align-items: center; justify-content: space-between;
    }

    .log-header-title {
      font-family: var(--font-serif);
      font-size: 0.95rem; font-weight: 600;
    }

    .log-clear {
      font-size: 0.7rem; font-family: var(--font-mono);
      color: var(--text-tertiary);
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 6px; padding: 4px 10px;
      cursor: pointer;
      transition: all var(--transition);
    }

    .log-clear:hover { color: var(--brand-light); border-color: var(--brand); }

    .log-entries {
      flex: 1; overflow-y: auto; padding: 12px 16px;
      font-family: var(--font-mono); font-size: 0.72rem; line-height: 1.8;
    }

    .log-line {
      display: flex; gap: 10px; padding: 3px 6px; border-radius: 4px;
      transition: background var(--transition);
      animation: fadeIn 0.2s ease;
    }

    .log-line:hover { background: var(--bg-card); }

    .log-ts { color: var(--text-tertiary); min-width: 60px; flex-shrink: 0; }

    .log-tag { min-width: 72px; flex-shrink: 0; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
    .log-tag.intake { color: var(--blue); }
    .log-tag.planning { color: var(--brand-light); }
    .log-tag.validation { color: var(--warning); }
    .log-tag.execution { color: var(--success); }
    .log-tag.error { color: var(--error); }
    .log-tag.system { color: var(--text-tertiary); }

    .log-msg { color: var(--text-secondary); word-break: break-word; }

    /* ─── Responsive ─── */
    @media (max-width: 1024px) {
      .main { grid-template-columns: 1fr; }
      .sidebar, .log-panel { display: none; }
    }

    /* ─── Scrollbar ─── */
    ::-webkit-scrollbar { width: 5px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--border-standard); border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: var(--brand); }
  </style>
</head>
<body>
  <div class="app">
    <div class="topbar">
      <div class="topbar-left">
        <img src="/assets/logo-transparent.png" alt="PAW" class="topbar-logo" />
        <span class="topbar-title">PAW Agents</span>
        <span class="topbar-badge">v3.0.0</span>
      </div>
      <div class="topbar-right">
        <span class="status-indicator">
          <span class="status-dot connecting" id="status-dot"></span>
          <span id="status-text">Connecting</span>
        </span>
        <button class="theme-toggle" id="themeToggle" onclick="toggleTheme()">
          <span id="themeIcon">☀️</span>
        </button>
      </div>
    </div>

    <div class="main">
      <div class="sidebar">
        <div class="sidebar-section">
          <h4>System</h4>
          <div class="stat-card">
            <div class="stat-label">Status</div>
            <div class="stat-value success" id="agent-status">—</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Uptime</div>
            <div class="stat-value" id="uptime">—</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Messages</div>
            <div class="stat-value brand" id="msg-count">0</div>
          </div>
        </div>

        <div class="sidebar-section">
          <h4>Agent Mode</h4>
          <div class="mode-group">
            <button class="mode-option active" id="btn-supervised" onclick="setMode('supervised')">
              <span class="mode-icon">🔒</span>
              <span>Supervised</span>
            </button>
            <button class="mode-option" id="btn-autonomous" onclick="setMode('autonomous')">
              <span class="mode-icon">🤖</span>
              <span>Autonomous</span>
            </button>
            <button class="mode-option mode-free" id="btn-free" onclick="requestFreeMode()">
              <span class="mode-icon">🔓</span>
              <span>Free</span>
            </button>
          </div>
        </div>

        <div class="sidebar-section">
          <h4>Pipeline</h4>
          <div class="pipeline-list">
            <div class="pipeline-step"><span class="pipeline-num">1</span> Intent</div>
            <div class="pipeline-step"><span class="pipeline-num">2</span> Plan</div>
            <div class="pipeline-step"><span class="pipeline-num">3</span> Validate</div>
            <div class="pipeline-step"><span class="pipeline-num">4</span> Execute</div>
            <div class="pipeline-step"><span class="pipeline-num">5</span> Verify</div>
            <div class="pipeline-step"><span class="pipeline-num">6</span> Log</div>
          </div>
        </div>
      </div>

      <div class="chat-panel">
        <div class="chat-header">
          <span class="chat-header-title">Agent Terminal</span>
          <span class="chat-header-meta" id="session-id">—</span>
        </div>
        <div class="chat-messages" id="chat-messages"></div>
        <div class="chat-input-area">
          <input type="text" id="chat-input" placeholder="Enter a command or message..." onkeydown="if(event.key==='Enter')sendMessage()" autocomplete="off" spellcheck="false" />
          <button class="send-btn" onclick="sendMessage()">Send</button>
        </div>
      </div>

      <div class="log-panel">
        <div class="log-header">
          <span class="log-header-title">Activity Log</span>
          <button class="log-clear" onclick="clearLog()">Clear</button>
        </div>
        <div class="log-entries" id="log-entries"></div>
      </div>
    </div>
  </div>

  <!-- Free Mode Warning Modals -->
  <div class="free-modal-overlay" id="free-modal-1">
    <div class="free-modal">
      <h3>⚠️ Warning — Free Mode (1/2)</h3>
      <p>You are about to enable <strong>Free Mode</strong>.</p>
      <p>Free Mode grants the agent <strong>full autonomy</strong> over:</p>
      <p>• All actions on your device<br>• All connected APIs and services<br>• All blockchain transactions (no confirmation gate)<br>• All file operations<br>• All browser sessions and logged-in accounts<br>• All external tool calls</p>
      <p><strong>No actions will require confirmation.</strong></p>
      <p class="warn-text">⚠️ It is strongly advised to use Supervised or Autonomous mode instead.</p>
      <div class="free-modal-actions">
        <button class="btn-cancel-free" onclick="cancelFreeMode()">Cancel</button>
        <button class="btn-proceed-free" onclick="showFreeWarning2()">Proceed to Final Warning →</button>
      </div>
    </div>
  </div>
  <div class="free-modal-overlay" id="free-modal-2">
    <div class="free-modal">
      <h3>🚨 Final Warning — Free Mode (2/2)</h3>
      <p>This is your <strong>last chance</strong> to reconsider.</p>
      <p>By proceeding, you accept that:</p>
      <p>1. The agent will execute <strong>all actions without asking permission</strong><br>2. This includes <strong>irreversible actions</strong> (transfers, deletions, deployments)<br>3. The agent has unrestricted access to <strong>all connected systems</strong><br>4. You assume <strong>full responsibility</strong> for all actions taken</p>
      <p class="warn-text">⚠️ We strongly recommend Supervised or Autonomous mode.<br>Autonomous already auto-executes most actions while keeping you safe.</p>
      <div class="free-modal-actions">
        <button class="btn-cancel-free" onclick="cancelFreeMode()">Cancel — Stay Safe</button>
        <button class="btn-proceed-free" onclick="activateFreeMode()">Activate Free Mode</button>
      </div>
    </div>
  </div>

  <script>
    let ws = null;
    let msgCount = 0;
    let currentMode = 'supervised';

    // ─── Theme ───
    function toggleTheme() {
      const html = document.documentElement;
      const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      html.setAttribute('data-theme', next);
      document.getElementById('themeIcon').textContent = next === 'dark' ? '☀️' : '🌙';
      localStorage.setItem('paw-dash-theme', next);
    }

    (function() {
      const saved = localStorage.getItem('paw-dash-theme');
      if (saved) {
        document.documentElement.setAttribute('data-theme', saved);
        document.getElementById('themeIcon').textContent = saved === 'dark' ? '☀️' : '🌙';
      }
    })();

    // ─── WebSocket ───
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
      addLog('system', 'mode → ' + mode);
    }

    function requestFreeMode() {
      document.getElementById('free-modal-1').classList.add('visible');
    }

    function showFreeWarning2() {
      document.getElementById('free-modal-1').classList.remove('visible');
      document.getElementById('free-modal-2').classList.add('visible');
    }

    function cancelFreeMode() {
      document.getElementById('free-modal-1').classList.remove('visible');
      document.getElementById('free-modal-2').classList.remove('visible');
    }

    function activateFreeMode() {
      document.getElementById('free-modal-2').classList.remove('visible');
      setMode('free');
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
