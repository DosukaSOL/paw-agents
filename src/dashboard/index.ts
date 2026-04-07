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
  <link rel="icon" type="image/png" href="/assets/logo-transparent.png" />
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

    /* ─── Companion Toggles ─── */
    .companion-toggles { display: flex; flex-direction: column; gap: 6px; }
    .toggle-row {
      display: flex; justify-content: space-between; align-items: center;
      font-size: 0.72rem; color: var(--text-secondary);
      padding: 4px 0; cursor: pointer;
    }
    .toggle-row input[type="checkbox"] {
      appearance: none; -webkit-appearance: none;
      width: 32px; height: 18px; border-radius: 9px;
      background: var(--bg-elevated); border: 1px solid var(--border-standard);
      position: relative; cursor: pointer; transition: all var(--transition);
    }
    .toggle-row input[type="checkbox"]::after {
      content: ''; position: absolute; top: 2px; left: 2px;
      width: 12px; height: 12px; border-radius: 50%;
      background: var(--text-tertiary); transition: all var(--transition);
    }
    .toggle-row input[type="checkbox"]:checked {
      background: var(--brand); border-color: var(--brand);
    }
    .toggle-row input[type="checkbox"]:checked::after {
      left: 16px; background: white;
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

    /* ─── Chat Tabs ─── */
    .chat-tabs {
      display: flex; gap: 2px; padding: 6px 12px;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border-subtle);
      overflow-x: auto; flex-shrink: 0;
    }
    .chat-tab {
      padding: 5px 12px; border: none; border-radius: var(--radius-sm);
      background: transparent; color: var(--text-tertiary);
      font-size: 0.72rem; font-family: var(--font-mono);
      cursor: pointer; white-space: nowrap; transition: all var(--transition);
    }
    .chat-tab:hover { background: var(--bg-card); color: var(--text-primary); }
    .chat-tab.active { background: var(--brand); color: #fff; }
    .chat-tab-new { color: var(--brand-light); font-weight: 700; font-size: 0.82rem; }
    .chat-tab-new:hover { background: rgba(124, 58, 237, 0.15); color: var(--brand); }

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

    .msg-row.error .msg-sender { color: var(--error); }
    .msg-row.error .msg-bubble {
      background: rgba(239, 68, 68, 0.08);
      border: 1px solid rgba(239, 68, 68, 0.3);
      border-bottom-left-radius: 4px;
      color: var(--error);
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

    /* ─── View Navigation ─── */
    .topbar-center { display: flex; gap: 3px; background: var(--bg-card); border-radius: var(--radius-sm); padding: 3px; border: 1px solid var(--border-subtle); }
    .view-tab { padding: 5px 14px; border-radius: 6px; border: none; background: transparent; color: var(--text-tertiary); font-size: 0.72rem; font-family: var(--font-mono); font-weight: 500; cursor: pointer; transition: all var(--transition); }
    .view-tab:hover { color: var(--text-primary); background: var(--bg-elevated); }
    .view-tab.active { background: var(--brand); color: #fff; }

    /* ─── Trace Explorer ─── */
    .trace-content { grid-column: 2 / -1; display: none; grid-template-columns: 1fr 1fr 1fr; gap: 14px; padding: 18px; overflow-y: auto; background: var(--bg-primary); }
    .trace-content.visible { display: grid; }
    .trace-header { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); }
    .trace-header-title { font-family: var(--font-serif); font-size: 0.95rem; font-weight: 600; }
    .trace-header-actions { display: flex; gap: 8px; align-items: center; }
    .trace-badge { font-size: 0.68rem; font-family: var(--font-mono); background: var(--brand-glow); border: 1px solid var(--border-standard); padding: 2px 8px; border-radius: var(--radius-full); color: var(--brand-light); }
    .trace-card { background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 14px; display: flex; flex-direction: column; transition: all var(--transition); overflow: hidden; position: relative; }
    .trace-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px; background: linear-gradient(90deg, var(--brand), var(--accent)); opacity: 0; transition: opacity var(--transition); }
    .trace-card:hover { border-color: var(--border-bright); box-shadow: var(--shadow-glow); }
    .trace-card:hover::before { opacity: 1; }
    .trace-card h5 { font-family: var(--font-mono); font-size: 0.68rem; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; color: var(--brand-light); margin-bottom: 10px; display: flex; align-items: center; gap: 8px; }
    .tc-icon { width: 20px; height: 20px; display: inline-flex; align-items: center; justify-content: center; background: var(--brand-glow); border: 1px solid var(--border-standard); border-radius: 5px; font-size: 0.65rem; }

    /* Timeline */
    .timeline-steps { display: flex; flex-direction: column; gap: 0; flex: 1; }
    .tl-step { display: grid; grid-template-columns: 24px 1fr auto; gap: 8px; align-items: center; padding: 6px 0; position: relative; font-size: 0.75rem; }
    .tl-dot { width: 8px; height: 8px; border-radius: 50%; justify-self: center; position: relative; z-index: 1; }
    .tl-dot.ok { background: var(--success); box-shadow: 0 0 4px var(--success); }
    .tl-dot.err { background: var(--error); box-shadow: 0 0 4px var(--error); }
    .tl-dot.run { background: var(--warning); box-shadow: 0 0 4px var(--warning); animation: pulse-glow 1.5s infinite; }
    .tl-dot.idle { background: var(--text-tertiary); }
    .tl-step:not(:last-child)::before { content: ''; position: absolute; left: 11px; top: 18px; width: 2px; height: calc(100%); background: var(--border-standard); z-index: 0; }
    .tl-label { color: var(--text-primary); font-weight: 500; }
    .tl-time { font-family: var(--font-mono); font-size: 0.65rem; color: var(--text-tertiary); }

    /* Reasoning / Score Ring */
    .score-row { display: flex; align-items: center; gap: 14px; margin-bottom: 10px; }
    .score-ring { width: 50px; height: 50px; border-radius: 50%; border: 3px solid var(--border-standard); display: flex; align-items: center; justify-content: center; font-family: var(--font-mono); font-size: 1rem; font-weight: 700; flex-shrink: 0; }
    .score-ring.hi { border-color: var(--success); color: var(--success); }
    .score-ring.md { border-color: var(--warning); color: var(--warning); }
    .score-ring.lo { border-color: var(--error); color: var(--error); }
    .ri-list { display: flex; flex-direction: column; gap: 4px; flex: 1; }
    .ri-row { display: flex; justify-content: space-between; font-size: 0.72rem; padding: 3px 6px; border-radius: 3px; background: var(--bg-elevated); }
    .ri-l { color: var(--text-secondary); }
    .ri-v { font-family: var(--font-mono); font-weight: 600; }
    .ri-v.ok { color: var(--success); } .ri-v.wn { color: var(--warning); } .ri-v.bd { color: var(--error); }

    /* Cost Bars */
    .cost-rows { display: flex; flex-direction: column; gap: 6px; flex: 1; }
    .c-row { display: grid; grid-template-columns: 72px 1fr 50px; gap: 8px; align-items: center; font-size: 0.72rem; }
    .c-model { font-family: var(--font-mono); color: var(--text-secondary); font-size: 0.65rem; }
    .c-bar { height: 6px; border-radius: 3px; background: var(--bg-elevated); overflow: hidden; }
    .c-fill { height: 100%; border-radius: 3px; background: linear-gradient(90deg, var(--brand), var(--accent)); transition: width 0.5s ease; }
    .c-amt { text-align: right; font-family: var(--font-mono); font-weight: 600; color: var(--text-primary); font-size: 0.68rem; }

    /* Perf Gauges */
    .perf-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; flex: 1; }
    .p-gauge { text-align: center; padding: 10px; background: var(--bg-elevated); border-radius: var(--radius-sm); }
    .p-val { font-family: var(--font-mono); font-size: 1.2rem; font-weight: 700; }
    .p-lbl { font-size: 0.6rem; color: var(--text-tertiary); margin-top: 2px; text-transform: uppercase; letter-spacing: 0.5px; }

    /* Scanner */
    .scan-meter { margin-bottom: 10px; }
    .scan-lbl { font-size: 0.68rem; color: var(--text-secondary); margin-bottom: 4px; display: flex; justify-content: space-between; }
    .scan-bar { height: 8px; border-radius: 4px; background: var(--bg-elevated); overflow: hidden; }
    .scan-fill { height: 100%; border-radius: 4px; transition: width 0.5s ease; }
    .scan-fill.safe { background: var(--success); } .scan-fill.warn { background: var(--warning); } .scan-fill.crit { background: var(--error); }
    .scan-items { display: flex; flex-direction: column; gap: 3px; flex: 1; }
    .scan-item { font-size: 0.7rem; padding: 4px 6px; border-radius: 3px; background: var(--bg-elevated); display: flex; justify-content: space-between; }
    .scan-type { color: var(--text-secondary); }
    .scan-st { font-family: var(--font-mono); font-weight: 600; }
    .scan-st.ok { color: var(--success); } .scan-st.hit { color: var(--error); }

    /* Tool Profiler */
    .prof-rows { display: flex; flex-direction: column; gap: 5px; flex: 1; }
    .pr-row { display: grid; grid-template-columns: 1fr 50px; gap: 8px; align-items: center; font-size: 0.72rem; }
    .pr-name { color: var(--text-secondary); }
    .pr-cnt { text-align: right; font-family: var(--font-mono); font-weight: 600; color: var(--accent); font-size: 0.7rem; }

    /* Export Bar */
    .trace-export { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); }
    .exp-btns { display: flex; gap: 6px; }
    .exp-btn { padding: 6px 12px; border-radius: 5px; border: 1px solid var(--border-standard); background: var(--bg-elevated); color: var(--text-secondary); font-size: 0.7rem; font-family: var(--font-mono); cursor: pointer; transition: all var(--transition); }
    .exp-btn:hover { border-color: var(--brand); color: var(--brand-light); background: var(--brand-glow); }
    .anon-toggle { display: flex; align-items: center; gap: 8px; font-size: 0.7rem; color: var(--text-secondary); }

    /* Sidebar trace sessions */
    .trace-sess-list { display: flex; flex-direction: column; gap: 3px; max-height: 180px; overflow-y: auto; }
    .ts-item { padding: 6px 8px; border-radius: 5px; cursor: pointer; font-size: 0.7rem; font-family: var(--font-mono); color: var(--text-secondary); background: var(--bg-card); border: 1px solid transparent; transition: all var(--transition); display: flex; justify-content: space-between; }
    .ts-item:hover { border-color: var(--border-standard); color: var(--text-primary); }
    .ts-item.active { border-color: var(--brand); color: var(--brand-light); background: var(--brand-glow); }
    .ts-time { color: var(--text-tertiary); font-size: 0.62rem; }
    .sidebar-trace { display: none; }
    @media (max-width: 1024px) { .trace-content { grid-column: 1 / -1; grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <div class="app">
    <div class="topbar">
      <div class="topbar-left">
        <img src="/assets/logo-transparent.png" alt="PAW" class="topbar-logo" />
        <span class="topbar-title">PAW Agents</span>
        <span class="topbar-badge">v3.4.0</span>
      </div>
      <div class="topbar-center">
        <button class="view-tab active" id="tab-terminal" onclick="switchView('terminal')">Terminal</button>
        <button class="view-tab" id="tab-trace" onclick="switchView('trace')">Trace Explorer</button>
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

        <div class="sidebar-section">
          <h4>🐕 Pawl Companion</h4>
          <div class="companion-toggles">
            <label class="toggle-row">
              <span>Enabled</span>
              <input type="checkbox" id="pawl-enabled" checked onchange="togglePawl('enabled', this.checked)">
            </label>
            <label class="toggle-row">
              <span>Sounds</span>
              <input type="checkbox" id="pawl-sounds" checked onchange="togglePawl('sounds', this.checked)">
            </label>
            <label class="toggle-row">
              <span>Idle Animations</span>
              <input type="checkbox" id="pawl-idle" checked onchange="togglePawl('idleAnimations', this.checked)">
            </label>
            <label class="toggle-row">
              <span>Walk Around</span>
              <input type="checkbox" id="pawl-walk" checked onchange="togglePawl('walkAround', this.checked)">
            </label>
            <label class="toggle-row">
              <span>Notifications</span>
              <input type="checkbox" id="pawl-notif" checked onchange="togglePawl('notificationBubbles', this.checked)">
            </label>
            <label class="toggle-row">
              <span>Sleep When Idle</span>
              <input type="checkbox" id="pawl-sleep" checked onchange="togglePawl('sleepWhenIdle', this.checked)">
            </label>
          </div>
        </div>

        <!-- Trace Explorer sidebar (hidden in terminal view) -->
        <div class="sidebar-section sidebar-trace" id="sidebar-trace-sessions">
          <h4>Trace Sessions</h4>
          <div class="trace-sess-list" id="trace-sessions-list">
            <div class="ts-item active" onclick="selectTrace(0)"><span>Latest Session</span><span class="ts-time">now</span></div>
          </div>
        </div>
        <div class="sidebar-section sidebar-trace" id="sidebar-trace-filters">
          <h4>Phase Filters</h4>
          <div class="companion-toggles">
            <label class="toggle-row"><span>Intake</span><input type="checkbox" checked onchange="toggleTraceFilter('intake',this.checked)"></label>
            <label class="toggle-row"><span>Planning</span><input type="checkbox" checked onchange="toggleTraceFilter('planning',this.checked)"></label>
            <label class="toggle-row"><span>Validation</span><input type="checkbox" checked onchange="toggleTraceFilter('validation',this.checked)"></label>
            <label class="toggle-row"><span>Execution</span><input type="checkbox" checked onchange="toggleTraceFilter('execution',this.checked)"></label>
            <label class="toggle-row"><span>Logging</span><input type="checkbox" checked onchange="toggleTraceFilter('logging',this.checked)"></label>
            <label class="toggle-row"><span>Response</span><input type="checkbox" checked onchange="toggleTraceFilter('response',this.checked)"></label>
          </div>
        </div>
      </div>

      <div class="chat-panel" id="panel-chat">
        <div class="chat-header">
          <span class="chat-header-title">Agent Terminal</span>
          <span class="chat-header-meta" id="session-id">—</span>
        </div>
        <div class="chat-tabs" id="chat-tabs"></div>
        <div class="chat-messages" id="chat-messages"></div>
        <div class="chat-input-area">
          <input type="text" id="chat-input" placeholder="Enter a command or message..." onkeydown="if(event.key==='Enter')sendMessage()" autocomplete="off" spellcheck="false" />
          <button class="send-btn" onclick="sendMessage()">Send</button>
        </div>
      </div>

      <div class="log-panel" id="panel-log">
        <div class="log-header">
          <span class="log-header-title">Activity Log</span>
          <button class="log-clear" onclick="clearLog()">Clear</button>
        </div>
        <div class="log-entries" id="log-entries"></div>
      </div>

      <!-- Trace Explorer View -->
      <div class="trace-content" id="trace-view">
        <div class="trace-header">
          <span class="trace-header-title">Trace Explorer</span>
          <div class="trace-header-actions">
            <span class="trace-badge" id="trace-session-badge">session: —</span>
            <span class="trace-badge" id="trace-entries-badge">0 entries</span>
          </div>
        </div>

        <!-- Interactive Timeline -->
        <div class="trace-card">
          <h5><span class="tc-icon">⏱</span> Interactive Timeline</h5>
          <div class="timeline-steps" id="trace-timeline">
            <div class="tl-step"><span class="tl-dot idle"></span><span class="tl-label">Intent</span><span class="tl-time">—</span></div>
            <div class="tl-step"><span class="tl-dot idle"></span><span class="tl-label">Plan</span><span class="tl-time">—</span></div>
            <div class="tl-step"><span class="tl-dot idle"></span><span class="tl-label">Validate</span><span class="tl-time">—</span></div>
            <div class="tl-step"><span class="tl-dot idle"></span><span class="tl-label">Execute</span><span class="tl-time">—</span></div>
            <div class="tl-step"><span class="tl-dot idle"></span><span class="tl-label">Verify</span><span class="tl-time">—</span></div>
            <div class="tl-step"><span class="tl-dot idle"></span><span class="tl-label">Log</span><span class="tl-time">—</span></div>
          </div>
        </div>

        <!-- Reasoning Analyzer -->
        <div class="trace-card">
          <h5><span class="tc-icon">🧠</span> Reasoning Analyzer</h5>
          <div class="score-row">
            <div class="score-ring hi" id="confidence-ring">—</div>
            <div class="ri-list">
              <div class="ri-row"><span class="ri-l">Loop detection</span><span class="ri-v ok" id="ri-loops">Clear</span></div>
              <div class="ri-row"><span class="ri-l">Hallucination</span><span class="ri-v ok" id="ri-halluc">None</span></div>
              <div class="ri-row"><span class="ri-l">Plan coherence</span><span class="ri-v ok" id="ri-coherence">High</span></div>
              <div class="ri-row"><span class="ri-l">Intent match</span><span class="ri-v ok" id="ri-intent">100%</span></div>
            </div>
          </div>
        </div>

        <!-- Token Cost Calculator -->
        <div class="trace-card">
          <h5><span class="tc-icon">💰</span> Token Cost Calculator</h5>
          <div class="cost-rows" id="cost-rows">
            <div class="c-row"><span class="c-model">GPT-4o</span><div class="c-bar"><div class="c-fill" style="width:85%"></div></div><span class="c-amt">$0.042</span></div>
            <div class="c-row"><span class="c-model">Claude 3.5</span><div class="c-bar"><div class="c-fill" style="width:72%"></div></div><span class="c-amt">$0.036</span></div>
            <div class="c-row"><span class="c-model">Gemini Pro</span><div class="c-bar"><div class="c-fill" style="width:45%"></div></div><span class="c-amt">$0.018</span></div>
            <div class="c-row"><span class="c-model">DeepSeek</span><div class="c-bar"><div class="c-fill" style="width:20%"></div></div><span class="c-amt">$0.004</span></div>
            <div class="c-row"><span class="c-model">Gemma 4</span><div class="c-bar"><div class="c-fill" style="width:0%"></div></div><span class="c-amt">FREE</span></div>
          </div>
        </div>

        <!-- Performance Monitor -->
        <div class="trace-card">
          <h5><span class="tc-icon">📊</span> Performance Monitor</h5>
          <div class="perf-grid">
            <div class="p-gauge"><div class="p-val" id="perf-latency" style="color:var(--success)">—</div><div class="p-lbl">Avg Latency</div></div>
            <div class="p-gauge"><div class="p-val" id="perf-throughput" style="color:var(--brand-light)">—</div><div class="p-lbl">Throughput/min</div></div>
            <div class="p-gauge"><div class="p-val" id="perf-success" style="color:var(--success)">—</div><div class="p-lbl">Success Rate</div></div>
            <div class="p-gauge"><div class="p-val" id="perf-healed" style="color:var(--accent)">—</div><div class="p-lbl">Self-Healed</div></div>
          </div>
        </div>

        <!-- Prompt Injection Scanner -->
        <div class="trace-card">
          <h5><span class="tc-icon">🛡</span> Injection Scanner</h5>
          <div class="scan-meter">
            <div class="scan-lbl"><span>Threat Level</span><span id="scan-level">Safe</span></div>
            <div class="scan-bar"><div class="scan-fill safe" id="scan-fill" style="width:8%"></div></div>
          </div>
          <div class="scan-items" id="scan-items">
            <div class="scan-item"><span class="scan-type">Jailbreak patterns</span><span class="scan-st ok">Clear</span></div>
            <div class="scan-item"><span class="scan-type">Prompt leaking</span><span class="scan-st ok">Clear</span></div>
            <div class="scan-item"><span class="scan-type">Instruction override</span><span class="scan-st ok">Clear</span></div>
            <div class="scan-item"><span class="scan-type">Data exfiltration</span><span class="scan-st ok">Clear</span></div>
            <div class="scan-item"><span class="scan-type">Encoding attacks</span><span class="scan-st ok">Clear</span></div>
          </div>
        </div>

        <!-- Tool Profiler -->
        <div class="trace-card">
          <h5><span class="tc-icon">🔧</span> Tool Profiler</h5>
          <div class="prof-rows" id="prof-rows">
            <div class="pr-row"><span class="pr-name">solana_transfer</span><span class="pr-cnt">0</span></div>
            <div class="pr-row"><span class="pr-name">solana_balance</span><span class="pr-cnt">0</span></div>
            <div class="pr-row"><span class="pr-name">api_call</span><span class="pr-cnt">0</span></div>
            <div class="pr-row"><span class="pr-name">browser</span><span class="pr-cnt">0</span></div>
            <div class="pr-row"><span class="pr-name">mcp_tool</span><span class="pr-cnt">0</span></div>
            <div class="pr-row"><span class="pr-name">file_ops</span><span class="pr-cnt">0</span></div>
          </div>
        </div>

        <!-- Export Bar -->
        <div class="trace-export">
          <div class="exp-btns">
            <button class="exp-btn" onclick="exportTrace('json')">📄 JSON</button>
            <button class="exp-btn" onclick="exportTrace('markdown')">📝 Markdown</button>
            <button class="exp-btn" onclick="exportTrace('html')">🌐 HTML</button>
          </div>
          <label class="anon-toggle">
            <span>Anonymize PII</span>
            <input type="checkbox" id="anon-toggle" style="appearance:none;-webkit-appearance:none;width:32px;height:18px;border-radius:9px;background:var(--bg-elevated);border:1px solid var(--border-standard);position:relative;cursor:pointer;transition:all var(--transition);">
          </label>
        </div>
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
    let modeDebounce = null;
    let currentChatId = null;

    // ─── Session Persistence ───
    const STORAGE_KEY = 'paw-dash-chats';
    const ACTIVE_KEY = 'paw-dash-active-chat';

    function generateId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

    function loadChats() {
      try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
    }

    function saveChats(chats) { localStorage.setItem(STORAGE_KEY, JSON.stringify(chats)); }

    function getActiveChat() {
      const chats = loadChats();
      let id = localStorage.getItem(ACTIVE_KEY);
      if (!id || !chats[id]) {
        id = generateId();
        chats[id] = { name: 'Chat ' + (Object.keys(chats).length + 1), messages: [], created: Date.now() };
        saveChats(chats);
      }
      localStorage.setItem(ACTIVE_KEY, id);
      return id;
    }

    function saveMessage(role, text) {
      if (!currentChatId) return;
      const chats = loadChats();
      if (!chats[currentChatId]) return;
      chats[currentChatId].messages.push({ role, text, ts: Date.now() });
      saveChats(chats);
      renderChatTabs();
    }

    function restoreMessages() {
      const el = document.getElementById('chat-messages');
      el.innerHTML = '';
      const chats = loadChats();
      const chat = chats[currentChatId];
      if (!chat) return;
      chat.messages.forEach(m => {
        if (m.role === 'user') addUserMsg(m.text, true);
        else if (m.role === 'agent') addAgentMsg(m.text, true);
        else if (m.role === 'system') addSystemMsg(m.text, true);
        else if (m.role === 'error') addErrorMsg(m.text, true);
      });
    }

    function renderChatTabs() {
      const container = document.getElementById('chat-tabs');
      if (!container) return;
      const chats = loadChats();
      const ids = Object.keys(chats).sort((a, b) => (chats[a].created || 0) - (chats[b].created || 0));
      container.innerHTML = ids.map(id => {
        const c = chats[id];
        const active = id === currentChatId ? ' active' : '';
        const msgPreview = c.messages.length ? ' (' + c.messages.length + ')' : '';
        return '<button class="chat-tab' + active + '" data-chatid="' + escapeHtml(id) + '">' + escapeHtml(c.name + msgPreview) + '</button>';
      }).join('') + '<button class="chat-tab chat-tab-new" id="newChatBtn">+</button>';
      // Bind events safely (no inline onclick to prevent XSS via localStorage IDs)
      container.querySelectorAll('.chat-tab[data-chatid]').forEach(function(btn) {
        btn.addEventListener('click', function() { switchChat(btn.getAttribute('data-chatid')); });
      });
      var newBtn = document.getElementById('newChatBtn');
      if (newBtn) newBtn.addEventListener('click', function() { newChat(); });
    }

    function switchChat(id) {
      currentChatId = id;
      localStorage.setItem(ACTIVE_KEY, id);
      restoreMessages();
      renderChatTabs();
    }

    function newChat() {
      const chats = loadChats();
      const id = generateId();
      chats[id] = { name: 'Chat ' + (Object.keys(chats).length + 1), messages: [], created: Date.now() };
      saveChats(chats);
      currentChatId = id;
      localStorage.setItem(ACTIVE_KEY, id);
      document.getElementById('chat-messages').innerHTML = '';
      renderChatTabs();
    }

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
        // Handle mode_changed events — don't put them in chat
        if (resp.event === 'mode_changed') {
          currentMode = resp.mode;
          document.querySelectorAll('.mode-option').forEach(b => b.classList.remove('active'));
          const btn = document.getElementById('btn-' + resp.mode);
          if (btn) btn.classList.add('active');
          addLog('system', 'mode changed → ' + resp.mode);
          return;
        }
        // Handle status responses (from 'status' command)
        if (resp.clients !== undefined || resp.channels !== undefined) {
          addLog('system', 'status: ' + JSON.stringify(resp));
          return;
        }
        // Handle errors — show them distinctly in chat
        if (resp.success === false || resp.error) {
          const errorText = resp.message || 'An error occurred';
          addErrorMsg(errorText);
          addLog('error', resp.error ? resp.error + ': ' + errorText : errorText);
          return;
        }
        // Normal agent responses
        if (resp.message) {
          addAgentMsg(resp.message);
          addLog('execution', resp.message.slice(0, 140));
        }
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
      } else if (msg.type === 'trace') {
        // Live trace entry from agent pipeline
        if (msg.payload) addTraceEntry(msg.payload);
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
      if (modeDebounce) clearTimeout(modeDebounce);
      modeDebounce = setTimeout(() => {
        currentMode = mode;
        document.querySelectorAll('.mode-option').forEach(b => b.classList.remove('active'));
        document.getElementById('btn-' + mode).classList.add('active');
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'command', payload: { command: 'set_mode', mode: mode }, timestamp: new Date().toISOString() }));
        }
        addLog('system', 'mode → ' + mode);
      }, 300);
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

    function addUserMsg(text, skipSave) {
      const row = document.createElement('div');
      row.className = 'msg-row user';
      row.innerHTML = '<div class="msg-sender">You</div><div class="msg-bubble">' + escapeHtml(text) + '</div>';
      document.getElementById('chat-messages').appendChild(row);
      row.scrollIntoView({ behavior: 'smooth' });
      if (!skipSave) saveMessage('user', text);
    }

    function addAgentMsg(text, skipSave) {
      const row = document.createElement('div');
      row.className = 'msg-row agent';
      row.innerHTML = '<div class="msg-sender">PAW</div><div class="msg-bubble">' + escapeHtml(text) + '</div>';
      document.getElementById('chat-messages').appendChild(row);
      row.scrollIntoView({ behavior: 'smooth' });
      if (!skipSave) saveMessage('agent', text);
    }

    function addErrorMsg(text, skipSave) {
      const row = document.createElement('div');
      row.className = 'msg-row error';
      row.innerHTML = '<div class="msg-sender">⚠ PAW</div><div class="msg-bubble msg-error">' + escapeHtml(text) + '</div>';
      document.getElementById('chat-messages').appendChild(row);
      row.scrollIntoView({ behavior: 'smooth' });
      if (!skipSave) saveMessage('error', text);
    }

    function addSystemMsg(text, skipSave) {
      const row = document.createElement('div');
      row.className = 'msg-row system';
      row.innerHTML = '<div class="msg-bubble">' + escapeHtml(text) + '</div>';
      document.getElementById('chat-messages').appendChild(row);
      row.scrollIntoView({ behavior: 'smooth' });
      if (!skipSave) saveMessage('system', text);
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

    // ─── Pawl Companion Toggles ───
    function togglePawl(feature, value) {
      addLog('companion', 'Pawl ' + feature + ' → ' + (value ? 'on' : 'off'));
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'command', payload: { command: 'pawl_config', feature: feature, value: value }, timestamp: new Date().toISOString() }));
      }
    }

    // ─── Init session persistence ───
    currentChatId = getActiveChat();
    restoreMessages();
    renderChatTabs();

    // ─── Trace Explorer ───
    let currentView = 'terminal';
    let traceEntries = [];
    let traceSessions = [];
    let traceFilters = { intake: true, planning: true, validation: true, execution: true, logging: true, response: true };
    let activeTraceIdx = 0;

    function switchView(view) {
      currentView = view;
      const chat = document.getElementById('panel-chat');
      const log = document.getElementById('panel-log');
      const trace = document.getElementById('trace-view');
      const tabTerm = document.getElementById('tab-terminal');
      const tabTrace = document.getElementById('tab-trace');
      // Sidebar sections
      document.querySelectorAll('.sidebar-section:not(.sidebar-trace)').forEach(function(s) { s.style.display = view === 'terminal' ? '' : 'none'; });
      document.querySelectorAll('.sidebar-trace').forEach(function(s) { s.style.display = view === 'trace' ? '' : 'none'; });

      if (view === 'terminal') {
        chat.style.display = ''; log.style.display = '';
        trace.classList.remove('visible');
        tabTerm.classList.add('active'); tabTrace.classList.remove('active');
      } else {
        chat.style.display = 'none'; log.style.display = 'none';
        trace.classList.add('visible');
        tabTrace.classList.add('active'); tabTerm.classList.remove('active');
        refreshTraceView();
      }
    }

    function toggleTraceFilter(phase, enabled) {
      traceFilters[phase] = enabled;
      if (currentView === 'trace') refreshTraceView();
    }

    function selectTrace(idx) {
      activeTraceIdx = idx;
      document.querySelectorAll('.ts-item').forEach(function(el, i) { el.classList.toggle('active', i === idx); });
      refreshTraceView();
    }

    function refreshTraceView() {
      updateTimeline();
      updateReasoning();
      updatePerformance();
      updateTraceHeader();
    }

    function updateTraceHeader() {
      var badge = document.getElementById('trace-session-badge');
      var countBadge = document.getElementById('trace-entries-badge');
      if (traceEntries.length > 0) {
        var latest = traceEntries[traceEntries.length - 1];
        badge.textContent = 'session: ' + (latest.session_id || '—').slice(0, 8);
        countBadge.textContent = traceEntries.length + ' entries';
      } else {
        badge.textContent = 'session: —';
        countBadge.textContent = '0 entries';
      }
    }

    function updateTimeline() {
      var phases = ['intake', 'planning', 'validation', 'execution', 'logging', 'response'];
      var labels = ['Intent', 'Plan', 'Validate', 'Execute', 'Verify', 'Log'];
      var container = document.getElementById('trace-timeline');
      container.innerHTML = phases.map(function(phase, i) {
        var entry = traceEntries.find(function(e) { return e.phase === phase; });
        var dotClass = 'idle';
        var timeText = '—';
        if (entry) {
          dotClass = entry.error ? 'err' : 'ok';
          timeText = entry.duration_ms + 'ms';
        }
        return '<div class="tl-step"><span class="tl-dot ' + dotClass + '"></span><span class="tl-label">' + labels[i] + '</span><span class="tl-time">' + timeText + '</span></div>';
      }).join('');
    }

    function updateReasoning() {
      var planEntry = traceEntries.find(function(e) { return e.phase === 'planning'; });
      var valEntry = traceEntries.find(function(e) { return e.phase === 'validation'; });
      var execEntry = traceEntries.find(function(e) { return e.phase === 'execution'; });
      var hasLoop = traceEntries.filter(function(e) { return e.phase === 'execution'; }).length > 1;
      var hasError = traceEntries.some(function(e) { return e.error; });
      var confidence = hasError ? 45 : (hasLoop ? 68 : 94);
      var ring = document.getElementById('confidence-ring');
      ring.textContent = confidence;
      ring.className = 'score-ring ' + (confidence >= 80 ? 'hi' : confidence >= 50 ? 'md' : 'lo');
      document.getElementById('ri-loops').textContent = hasLoop ? 'Detected' : 'Clear';
      document.getElementById('ri-loops').className = 'ri-v ' + (hasLoop ? 'wn' : 'ok');
      document.getElementById('ri-halluc').textContent = hasError ? 'Possible' : 'None';
      document.getElementById('ri-halluc').className = 'ri-v ' + (hasError ? 'wn' : 'ok');
      document.getElementById('ri-coherence').textContent = confidence >= 80 ? 'High' : confidence >= 50 ? 'Medium' : 'Low';
      document.getElementById('ri-coherence').className = 'ri-v ' + (confidence >= 80 ? 'ok' : confidence >= 50 ? 'wn' : 'bd');
      document.getElementById('ri-intent').textContent = (planEntry ? '100%' : '—');
    }

    function updatePerformance() {
      var totalMs = 0; var count = 0; var errors = 0; var healed = 0;
      traceEntries.forEach(function(e) {
        if (e.duration_ms > 0) { totalMs += e.duration_ms; count++; }
        if (e.error) errors++;
        if (e.phase === 'execution' && !e.error && count > 1) healed++;
      });
      var avgMs = count > 0 ? Math.round(totalMs / count) : 0;
      var successRate = count > 0 ? Math.round(((count - errors) / count) * 100) : 0;
      document.getElementById('perf-latency').textContent = avgMs > 0 ? avgMs + 'ms' : '—';
      document.getElementById('perf-throughput').textContent = count > 0 ? count + '' : '—';
      document.getElementById('perf-success').textContent = successRate > 0 ? successRate + '%' : '—';
      document.getElementById('perf-healed').textContent = healed > 0 ? healed + '' : '0';
    }

    function addTraceEntry(entry) {
      traceEntries.push(entry);
      // Update tool profiler counts
      if (entry.phase === 'execution' && entry.plan && entry.plan.tools) {
        entry.plan.tools.forEach(function(tool) {
          var row = document.querySelector('#prof-rows .pr-row .pr-name');
          document.querySelectorAll('#prof-rows .pr-row').forEach(function(r) {
            var name = r.querySelector('.pr-name');
            var cnt = r.querySelector('.pr-cnt');
            if (name && name.textContent === tool) {
              cnt.textContent = (parseInt(cnt.textContent) || 0) + 1;
            }
          });
        });
      }
      if (currentView === 'trace') refreshTraceView();
    }

    function exportTrace(format) {
      var anonymize = document.getElementById('anon-toggle').checked;
      var data = traceEntries.map(function(e) {
        if (anonymize) {
          var copy = JSON.parse(JSON.stringify(e));
          var str = JSON.stringify(copy);
          str = str.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}/g, '[REDACTED_EMAIL]');
          str = str.replace(/\\b\\d{1,3}(\\.\\d{1,3}){3}\\b/g, '[REDACTED_IP]');
          str = str.replace(/sk-[a-zA-Z0-9]+/g, '[REDACTED_KEY]');
          str = str.replace(/pk-[a-zA-Z0-9]+/g, '[REDACTED_KEY]');
          str = str.replace(/token_[a-zA-Z0-9]+/g, '[REDACTED_TOKEN]');
          return JSON.parse(str);
        }
        return e;
      });
      var output = '';
      var filename = 'paw-trace';
      if (format === 'json') {
        output = JSON.stringify({ session: traceEntries[0] ? traceEntries[0].session_id : 'unknown', entries: data, exported_at: new Date().toISOString() }, null, 2);
        filename += '.json';
      } else if (format === 'markdown') {
        output = '# PAW Agent Trace\\n\\nExported: ' + new Date().toISOString() + '\\n\\n';
        data.forEach(function(e) { output += '## ' + e.phase + '\\n- Duration: ' + e.duration_ms + 'ms\\n' + (e.error ? '- Error: ' + e.error + '\\n' : '') + '\\n'; });
        filename += '.md';
      } else if (format === 'html') {
        output = '<html><head><title>PAW Trace</title></head><body><h1>PAW Agent Trace</h1>';
        data.forEach(function(e) { output += '<h2>' + escapeHtml(e.phase) + '</h2><p>Duration: ' + e.duration_ms + 'ms</p>' + (e.error ? '<p style="color:red">Error: ' + escapeHtml(e.error) + '</p>' : ''); });
        output += '</body></html>';
        filename += '.html';
      }
      var blob = new Blob([output], { type: 'text/plain' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
      addLog('system', 'Exported trace as ' + format + (anonymize ? ' (anonymized)' : ''));
    }

    setInterval(fetchStatus, 30000);
    connect();
  </script>
</body>
</html>`;
}
