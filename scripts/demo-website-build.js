#!/usr/bin/env node
// Demo: have PAW build a real 3-file portfolio website via file_write,
// while exercising the supervised-mode confirmation gate.
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const ws = new WebSocket('ws://127.0.0.1:18789');
const clientId = 'demo_' + Date.now();

const PROMPT =
  "ACTION REQUEST: Use the file_write tool three times to create a tiny single-page " +
  "portfolio website for a fictional indie game developer named 'Mira Nakamura'. " +
  "Write to these exact paths:\n" +
  "  1. mira-portfolio/index.html — semantic HTML5 with <header>, hero section " +
  "(name + tagline 'Indie game developer · Tokyo'), <main> containing a 'Projects' " +
  "grid of 3 sample game cards (Lumen Drift, Paper Forest, Echo Garden — each a " +
  "<article> with title + 1-line description), an <about> section (~3 sentences), " +
  "and a <footer>. Link style.css and app.js. Add a button id=\"theme-toggle\" in the header.\n" +
  "  2. mira-portfolio/style.css — modern dark theme by default (CSS custom " +
  "properties, --bg/--fg/--accent), subtle purple→indigo gradient on hero, " +
  "system-ui font, responsive CSS grid (auto-fill, minmax(220px,1fr)) for projects, " +
  "and a [data-theme=\"light\"] override block.\n" +
  "  3. mira-portfolio/app.js — vanilla JS that reads localStorage 'theme', applies " +
  "it to document.documentElement.dataset.theme on load, and wires #theme-toggle to " +
  "flip between 'dark' and 'light' (persist to localStorage).\n" +
  "Each file_write step's params must be { path: '<one of the paths above>', " +
  "content: '<the FULL file contents as a single string>' }. Output exactly 3 plan " +
  "steps, one per file. Set requires_confirmation=true.";

let phase = 'awaiting_plan';

function send(obj) { ws.send(JSON.stringify(obj)); }
function sendChat(text) {
  send({
    type: 'message', channel: 'hub', from: 'demo-script',
    payload: text, timestamp: new Date().toISOString(),
  });
}

ws.on('open', () => {
  console.log('[demo] connected to gateway');
  send({ type: 'register', channel: 'hub', client_id: clientId });
  setTimeout(() => {
    console.log('[demo] sending action prompt...\n');
    sendChat(PROMPT);
  }, 400);
});

ws.on('message', (data) => {
  let msg;
  try { msg = JSON.parse(data.toString()); } catch { return; }

  if (msg.type === 'event') {
    const p = msg.payload || {};
    if (p.event) console.log('[event]', p.event, p.intent || p.tool || p.message || '');
    return;
  }
  if (msg.type === 'error') {
    console.error('[error]', msg.payload);
    return;
  }
  if (msg.type !== 'response') return;

  const raw = msg.payload;
  let text, payloadObj = null;
  if (typeof raw === 'string') {
    try { payloadObj = JSON.parse(raw); text = payloadObj.message || raw; }
    catch { text = raw; }
  } else if (raw && typeof raw === 'object') {
    payloadObj = raw;
    text = raw.message || raw.text || raw.response || JSON.stringify(raw);
  } else { text = String(raw); }

  console.log('\n========== AGENT (' + phase + ') ==========\n' + text + '\n========== END ==========\n');

  const requiresConfirm = payloadObj && payloadObj.requires_confirmation === true;

  if (phase === 'awaiting_plan' && requiresConfirm) {
    phase = 'awaiting_execution';
    console.log('[demo] supervised gate hit — sending "yes" to confirm...\n');
    setTimeout(() => sendChat('yes'), 300);
    return;
  }

  // Final response after execution (or non-confirmation path)
  phase = 'done';
  setTimeout(() => {
    const dir = path.resolve(process.cwd(), 'data', 'mira-portfolio');
    console.log('[demo] checking output dir:', dir);
    try {
      const files = fs.readdirSync(dir);
      console.log('[demo] files written:', files);
      for (const f of files) {
        const fp = path.join(dir, f);
        const sz = fs.statSync(fp).size;
        console.log('  -', f, '(' + sz + ' bytes)');
      }
    } catch (e) { console.log('[demo] no output dir found:', e.message); }
    ws.close();
  }, 800);
});

ws.on('close', () => { console.log('[demo] disconnected'); process.exit(phase === 'done' ? 0 : 1); });
ws.on('error', (e) => console.error('[ws error]', e.message));

setTimeout(() => { console.error('[demo] hard timeout 240s'); ws.close(); process.exit(2); }, 240000);
