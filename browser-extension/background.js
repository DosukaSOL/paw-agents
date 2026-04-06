// ─── PAW Browser Extension — Background Service Worker ───
// Manages WebSocket connection to PAW gateway and context menus.

let ws = null;
let gatewayUrl = 'ws://127.0.0.1:18789';
let authToken = '';

// ─── Load settings ───
chrome.storage.sync.get(['gatewayUrl', 'authToken'], (result) => {
  if (result.gatewayUrl) gatewayUrl = result.gatewayUrl;
  if (result.authToken) authToken = result.authToken;
  connectGateway();
});

// ─── Context menu ───
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'paw-send-selection',
    title: 'Send to PAW Agent',
    contexts: ['selection'],
  });

  chrome.contextMenus.create({
    id: 'paw-send-page',
    title: 'Send page URL to PAW',
    contexts: ['page'],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'paw-send-selection' && info.selectionText) {
    sendToPaw(`Analyze this text from ${tab?.url ?? 'a webpage'}:\n\n${info.selectionText}`);
  } else if (info.menuItemId === 'paw-send-page' && tab?.url) {
    sendToPaw(`Check out this page: ${tab.url}`);
  }
});

// ─── WebSocket connection ───
function connectGateway() {
  if (ws) {
    ws.close();
    ws = null;
  }

  try {
    const url = authToken
      ? `${gatewayUrl}?token=${encodeURIComponent(authToken)}`
      : gatewayUrl;

    ws = new WebSocket(url);

    ws.onopen = () => {
      console.log('[PAW Extension] Connected to gateway');
      ws.send(JSON.stringify({
        type: 'register',
        channel: 'browser-extension',
        client_id: `ext_${Date.now()}`,
      }));
      updateBadge('connected');
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        // Forward to popup if open
        chrome.runtime.sendMessage({ type: 'paw-response', data: msg }).catch(() => {});
      } catch {
        // ignore
      }
    };

    ws.onclose = () => {
      console.log('[PAW Extension] Disconnected');
      updateBadge('disconnected');
      // Auto-reconnect
      setTimeout(connectGateway, 5000);
    };

    ws.onerror = () => {
      updateBadge('error');
    };
  } catch {
    updateBadge('error');
    setTimeout(connectGateway, 5000);
  }
}

function sendToPaw(message) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.warn('[PAW Extension] Not connected');
    return false;
  }

  ws.send(JSON.stringify({
    type: 'message',
    channel: 'browser-extension',
    from: 'extension-user',
    payload: { text: message },
    timestamp: new Date().toISOString(),
  }));

  return true;
}

function updateBadge(status) {
  const colors = { connected: '#22c55e', disconnected: '#ef4444', error: '#eab308' };
  const texts = { connected: '', disconnected: '!', error: '!' };
  chrome.action.setBadgeBackgroundColor({ color: colors[status] ?? '#666' });
  chrome.action.setBadgeText({ text: texts[status] ?? '' });
}

// ─── Listen for messages from popup ───
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'paw-send') {
    const success = sendToPaw(msg.text);
    sendResponse({ success });
  } else if (msg.type === 'paw-status') {
    sendResponse({ connected: ws?.readyState === WebSocket.OPEN, gateway: gatewayUrl });
  } else if (msg.type === 'paw-reconnect') {
    connectGateway();
    sendResponse({ reconnecting: true });
  } else if (msg.type === 'paw-update-settings') {
    gatewayUrl = msg.gatewayUrl || gatewayUrl;
    authToken = msg.authToken || authToken;
    chrome.storage.sync.set({ gatewayUrl, authToken });
    connectGateway();
    sendResponse({ updated: true });
  }
  return true; // async response
});
