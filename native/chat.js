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
      connection.dataset.state = 'live';
      connection.textContent = 'Live';
    } catch {
      connection.dataset.state = 'offline';
      connection.textContent = 'Reconnecting';
    } finally {
      loading = false;
    }
  }

  function updatePolling() {
    window.clearInterval(polling);
    if (!panel.open) {
      connection.textContent = '';
      return;
    }
    if (document.hidden) return;
    if (!connection.textContent) connection.textContent = 'Connecting';
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
  document.addEventListener('visibilitychange', updatePolling);
  updatePolling();
})();
