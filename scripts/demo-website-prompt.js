#!/usr/bin/env node
// Demo: connect to PAW gateway as a hub-style client, send a prompt,
// stream back agent events + responses.
const WebSocket = require('ws');
const url = 'ws://127.0.0.1:18789';
const ws = new WebSocket(url);

const clientId = 'demo_' + Date.now();
let done = false;

const PROMPT =
  "ACTION REQUEST: I want you to actually generate the full source code for a tiny " +
  "single-page portfolio website for a fictional indie game developer named 'Mira " +
  "Nakamura'. Three files: index.html (semantic HTML5, hero + projects grid + about + " +
  "footer), style.css (modern dark theme, subtle purple gradient hero, responsive CSS " +
  "grid, system font stack), and app.js (vanilla JS theme toggle button that flips a " +
  "data-theme attribute on <html> and persists to localStorage). DO NOT write any " +
  "files. Instead, return the COMPLETE source of each file inline in your response, " +
  "in three clearly labelled fenced code blocks: ```html (filename: index.html), " +
  "```css (filename: style.css), ```js (filename: app.js). I will paste them myself. " +
  "Treat this as a conversational coding request — output the JSON with a populated " +
  "`response` field that contains all three full code blocks verbatim. No truncation, " +
  "no placeholders, no '...'.";

function send(obj) {
  ws.send(JSON.stringify(obj));
}

ws.on('open', () => {
  console.log('[demo] connected to gateway');
  send({ type: 'register', channel: 'hub', client_id: clientId });
  setTimeout(() => {
    console.log('[demo] sending prompt...\n');
    send({
      type: 'message',
      channel: 'hub',
      from: 'demo-script',
      payload: PROMPT,
      timestamp: new Date().toISOString(),
    });
  }, 400);
});

ws.on('message', (data) => {
  let msg;
  try { msg = JSON.parse(data.toString()); } catch { return; }
  if (msg.type === 'event') {
    const evt = msg.payload && msg.payload.event;
    if (evt) console.log('[event]', evt, msg.payload.intent || msg.payload.tool || msg.payload.message || '');
  } else if (msg.type === 'response') {
    const raw = msg.payload;
    let text;
    if (typeof raw === 'string') {
      try { const p = JSON.parse(raw); text = p.message || p.text || p.response || raw; }
      catch { text = raw; }
    } else if (raw && typeof raw === 'object') {
      text = raw.message || raw.text || raw.response || JSON.stringify(raw, null, 2);
    } else { text = String(raw); }
    console.log('\n========== AGENT RESPONSE ==========\n');
    console.log(text);
    console.log('\n========== END RESPONSE ==========\n');
    done = true;
    setTimeout(() => ws.close(), 200);
  } else if (msg.type === 'error') {
    console.error('[error]', msg.payload);
  } else if (msg.type === 'hub_control') {
    console.log('[hub_control]', msg.payload && msg.payload.action);
  }
});

ws.on('close', () => {
  console.log('[demo] disconnected');
  process.exit(done ? 0 : 1);
});
ws.on('error', (e) => console.error('[ws error]', e.message));

// Safety timeout
setTimeout(() => {
  if (!done) { console.error('[demo] timeout after 180s'); ws.close(); process.exit(2); }
}, 180000);
