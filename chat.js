(() => {
  'use strict';

  const panel = document.getElementById('chatPanel');
  const messages = document.getElementById('chatMessages');
  const connection = document.getElementById('chatConnection');
  const empty = document.getElementById('chatEmpty');
  const form = document.getElementById('chatForm');
  const nickname = document.getElementById('chatNickname');
  const input = document.getElementById('chatInput');
  const send = document.getElementById('chatSend');
  const status = document.getElementById('chatStatus');

  const chatBase = window.ITHAC_CHAT_URL?.replace(/\/+$/, '') || 'https://api.ithacapp.com/chat';
  const clock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  let after = null;
  let loading = false;
  let polling = null;
  let checkingPresence = false;
  const viewer = getViewerId();

  function getViewerId() {
    const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
    try {
      const saved = localStorage.getItem('ithac-chat-viewer');
      if (/^[0-9a-f]{32}$/.test(saved || '')) return saved;
      localStorage.setItem('ithac-chat-viewer', id);
    } catch {
      // A browser with storage disabled uses a temporary identifier.
    }
    return id;
  }

  panel.open = window.matchMedia('(min-width: 961px)').matches;
  try {
    nickname.value = localStorage.getItem('ithac-chat-nickname') || '';
  } catch {
    // Chat remains usable with browser storage disabled.
  }

  async function request(path, options = {}) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`${chatBase}${path}`, {
        ...options,
        credentials: 'omit',
        signal: controller.signal
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Chat request failed.');
      return payload;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function appendMessage(message) {
    const date = new Date(message.createdAt);
    const item = document.createElement('p');
    const time = document.createElement('time');
    const name = document.createElement('strong');
    item.className = 'chat-message';
    if (Number.isFinite(date.getTime())) {
      time.dateTime = date.toISOString();
      time.textContent = clock.format(date);
      item.append(time, '  ');
    }
    name.textContent = message.nickname;
    item.append(name, '  ', message.text);
    messages.append(item);
  }

  async function refresh() {
    if (!panel.open || document.hidden || loading) return;
    loading = true;
    try {
      const suffix = after === null ? '' : `?after=${after}`;
      const response = await request(`/messages${suffix}`);
      const atBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 48;
      for (const message of response.messages) {
        if (!Number.isSafeInteger(message.id) || message.id <= (after ?? 0)) continue;
        appendMessage(message);
        after = message.id;
      }
      while (messages.children.length > 100) messages.firstElementChild.remove();
      if (atBottom) messages.scrollTop = messages.scrollHeight;
      empty.hidden = messages.children.length > 0;
      empty.textContent = 'No messages yet.';
    } catch {
      if (!messages.children.length) {
        empty.hidden = false;
        empty.textContent = 'Chat temporarily unavailable.';
      }
    } finally {
      loading = false;
    }
  }

  async function refreshPresence() {
    if (document.hidden || checkingPresence) return;
    checkingPresence = true;
    try {
      const data = await request(`/presence?viewer=${viewer}`);
      if (!Number.isSafeInteger(data.online) || data.online < 0) throw new Error('Invalid presence');
      connection.dataset.state = 'live';
      connection.textContent = `${data.online} online`;
    } catch {
      connection.dataset.state = 'offline';
      connection.textContent = 'Offline';
    } finally {
      checkingPresence = false;
    }
  }

  function updatePolling() {
    window.clearInterval(polling);
    if (!panel.open || document.hidden) return;
    void refresh();
    polling = window.setInterval(refresh, 4000);
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = nickname.value.trim();
    const text = input.value.trim();
    if (!name || !text) {
      status.textContent = 'Enter a nickname and a message.';
      return;
    }

    send.disabled = true;
    status.textContent = '';
    try {
      await request('/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: name, text })
      });
      try {
        localStorage.setItem('ithac-chat-nickname', name);
      } catch {
        // The nickname can still be reused for this page.
      }
      if (input.value.trim() === text) input.value = '';
      status.textContent = 'Message sent.';
      void refresh();
      if (document.activeElement === send || document.activeElement === document.body) input.focus();
    } catch (error) {
      status.textContent = error.name === 'AbortError' ? 'Chat did not respond. Please try again.' : error.message;
    } finally {
      send.disabled = false;
    }
  });

  panel.addEventListener('toggle', updatePolling);
  document.addEventListener('visibilitychange', () => {
    updatePolling();
    void refreshPresence();
  });
  updatePolling();
  void refreshPresence();
  window.setInterval(refreshPresence, 5000);
})();
