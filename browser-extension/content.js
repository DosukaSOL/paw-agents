// ─── PAW Browser Extension — Content Script ───
// Adds a floating PAW trigger button on webpages.
// Allows sending selected text to PAW with one click.

(function () {
  // Only inject once
  if (document.getElementById('paw-trigger')) return;

  // Create floating button
  const btn = document.createElement('div');
  btn.id = 'paw-trigger';
  btn.innerHTML = '🐾';
  btn.title = 'Send to PAW Agent';
  btn.style.cssText = `
    position: fixed; bottom: 20px; right: 20px; z-index: 999999;
    width: 48px; height: 48px; border-radius: 50%;
    background: linear-gradient(135deg, #6366f1, #8b5cf6);
    display: none; align-items: center; justify-content: center;
    font-size: 22px; cursor: pointer; box-shadow: 0 4px 16px rgba(99,102,241,0.5);
    transition: transform 0.2s, opacity 0.2s; opacity: 0.9;
    user-select: none; -webkit-user-select: none;
  `;

  btn.addEventListener('mouseenter', () => { btn.style.transform = 'scale(1.1)'; btn.style.opacity = '1'; });
  btn.addEventListener('mouseleave', () => { btn.style.transform = 'scale(1)'; btn.style.opacity = '0.9'; });

  btn.addEventListener('click', () => {
    const selection = window.getSelection()?.toString().trim();
    if (selection) {
      chrome.runtime.sendMessage({
        type: 'paw-send',
        text: `From ${window.location.href}:\n\n${selection}`,
      });
      showNotification('Sent to PAW!');
    }
  });

  document.body.appendChild(btn);

  // Show button when text is selected
  document.addEventListener('mouseup', () => {
    const hasSelection = (window.getSelection()?.toString().trim().length ?? 0) > 0;
    btn.style.display = hasSelection ? 'flex' : 'none';
  });

  // Hide on click elsewhere
  document.addEventListener('mousedown', (e) => {
    if (e.target !== btn) {
      btn.style.display = 'none';
    }
  });

  function showNotification(text) {
    const notif = document.createElement('div');
    notif.textContent = text;
    notif.style.cssText = `
      position: fixed; bottom: 80px; right: 20px; z-index: 999999;
      background: #22c55e; color: white; padding: 8px 16px;
      border-radius: 8px; font-size: 13px; font-family: system-ui;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3); animation: pawFadeOut 2s forwards;
    `;

    const style = document.createElement('style');
    style.textContent = '@keyframes pawFadeOut { 0% { opacity: 1; } 70% { opacity: 1; } 100% { opacity: 0; } }';
    document.head.appendChild(style);

    document.body.appendChild(notif);
    setTimeout(() => { notif.remove(); style.remove(); }, 2000);
  }
})();
