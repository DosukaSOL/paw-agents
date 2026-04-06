// ─── PAW Browser Extension — Popup Script ───

const chat = document.getElementById('chat');
const input = document.getElementById('input');
const sendBtn = document.getElementById('send');
const statusDot = document.getElementById('statusDot');
const settingsPanel = document.getElementById('settingsPanel');
const settingsBtn = document.getElementById('settingsBtn');
const closeSettings = document.getElementById('closeSettings');
const saveSettings = document.getElementById('saveSettings');
const gatewayInput = document.getElementById('gatewayInput');
const tokenInput = document.getElementById('tokenInput');

function addMessage(text, role) {
  const div = document.createElement('div');
  div.className = 'msg ' + role;
  div.textContent = text;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

function send() {
  const text = input.value.trim();
  if (!text) return;

  addMessage(text, 'user');
  input.value = '';

  chrome.runtime.sendMessage({ type: 'paw-send', text }, (res) => {
    if (!res?.success) {
      addMessage('Not connected to PAW. Check settings.', 'agent');
    }
  });
}

sendBtn.addEventListener('click', send);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') send();
});

// Listen for responses from background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'paw-response' && msg.data) {
    const text = msg.data.payload?.text || msg.data.message || JSON.stringify(msg.data);
    addMessage(text, 'agent');
  }
});

// Check connection status
chrome.runtime.sendMessage({ type: 'paw-status' }, (res) => {
  if (res?.connected) {
    statusDot.classList.add('connected');
  }
});

// Settings
settingsBtn.addEventListener('click', () => {
  settingsPanel.style.display = 'block';
  chrome.storage.sync.get(['gatewayUrl', 'authToken'], (r) => {
    gatewayInput.value = r.gatewayUrl || 'ws://127.0.0.1:18789';
    tokenInput.value = r.authToken || '';
  });
});

closeSettings.addEventListener('click', () => {
  settingsPanel.style.display = 'none';
});

saveSettings.addEventListener('click', () => {
  chrome.runtime.sendMessage({
    type: 'paw-update-settings',
    gatewayUrl: gatewayInput.value,
    authToken: tokenInput.value,
  });
  settingsPanel.style.display = 'none';
  addMessage('Settings saved. Reconnecting...', 'agent');
});

input.focus();
