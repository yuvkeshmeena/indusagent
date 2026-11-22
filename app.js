// Indus Agent - Frontend Application Logic
// ChatGPT Web Clone powered by Cloudflare Worker, D1 Database, and OpenRouter API

(function () {
  'use strict';

  // Application State
  const state = {
    currentUser: null,
    chats: [],
    activeChatId: null,
    currentMessages: [],
    availableModels: [],
    selectedModel: 'meta-llama/llama-3.3-70b-instruct',
    isGenerating: false,
    abortController: null,
    config: {},
    settings: {
      openRouterKey: localStorage.getItem('indus_openrouter_key') || '',
      temperature: parseFloat(localStorage.getItem('indus_temperature') || '0.7'),
      systemPrompt: localStorage.getItem('indus_system_prompt') || '',
      theme: localStorage.getItem('indus_theme') || 'dark'
    }
  };

  // DOM Elements Cache
  const elements = {
    // Layout
    sidebar: document.getElementById('sidebar'),
    btnToggleSidebar: document.getElementById('btn-toggle-sidebar'),
    btnCollapseSidebar: document.getElementById('btn-collapse-sidebar'),
    btnNewChat: document.getElementById('btn-new-chat'),
    searchChatsInput: document.getElementById('search-chats-input'),
    chatsListContainer: document.getElementById('chats-list-container'),
    userFooterLoggedIn: document.getElementById('user-footer-logged-in'),
    userFooterLoggedOut: document.getElementById('user-footer-logged-out'),
    userAvatar: document.getElementById('user-avatar-element'),
    userName: document.getElementById('user-name-element'),
    userEmail: document.getElementById('user-email-element'),
    btnSidebarGoogleLogin: document.getElementById('btn-sidebar-google-login'),
    btnOpenSettings: document.getElementById('btn-open-settings'),
    btnHeaderSettings: document.getElementById('btn-header-settings'),
    btnThemeToggle: document.getElementById('btn-theme-toggle'),

    // Model Selector
    btnModelSelect: document.getElementById('btn-model-select'),
    currentModelName: document.getElementById('current-model-name'),
    currentModelBadge: document.getElementById('current-model-badge'),
    modelDropdownMenu: document.getElementById('model-dropdown-menu'),
    inputModelChipText: document.getElementById('input-model-chip-text'),

    // Chat Area
    messagesContainer: document.getElementById('messages-container'),
    welcomeScreen: document.getElementById('welcome-screen'),
    messagesList: document.getElementById('messages-list'),
    chatTextarea: document.getElementById('chat-textarea'),
    btnSendMessage: document.getElementById('btn-send-message'),
    btnStopGenerating: document.getElementById('btn-stop-generating'),

    // Modals
    authModal: document.getElementById('auth-modal'),
    btnCloseAuthModal: document.getElementById('btn-close-auth-modal'),
    btnModalOAuthRedirect: document.getElementById('btn-modal-oauth-redirect'),
    btnModalGuestLogin: document.getElementById('btn-modal-guest-login'),
    googleGsiButtonContainer: document.getElementById('google-gsi-button-container'),

    settingsModal: document.getElementById('settings-modal'),
    btnCloseSettings: document.getElementById('btn-close-settings'),
    settingOpenRouterKey: document.getElementById('setting-openrouter-key'),
    settingTemperature: document.getElementById('setting-temperature'),
    temperatureValLabel: document.getElementById('temperature-val-label'),
    settingSystemPrompt: document.getElementById('setting-system-prompt'),
    settingsUserAvatar: document.getElementById('settings-user-avatar'),
    settingsUserEmail: document.getElementById('settings-user-email'),
    btnSettingsLogout: document.getElementById('btn-settings-logout'),
    btnClearAllChats: document.getElementById('btn-clear-all-chats'),
    btnSaveSettings: document.getElementById('btn-save-settings'),

    toastContainer: document.getElementById('toast-container')
  };

  // Configure Marked renderer
  if (window.marked) {
    marked.setOptions({
      breaks: true,
      gfm: true,
      highlight: function (code, lang) {
        if (window.hljs) {
          const language = hljs.getLanguage(lang) ? lang : 'plaintext';
          return hljs.highlight(code, { language }).value;
        }
        return code;
      }
    });
  }

  // --------------------------------------------------------------------------
  // INITIALIZATION
  // --------------------------------------------------------------------------
  async function init() {
    applyTheme(state.settings.theme);
    setupEventListeners();
    setupTextareaAutoResize();

    // 1. Fetch server config & models
    await loadAppConfig();
    await loadModels();

    // 2. Check user authentication
    await checkCurrentUser();

    // 3. Check URL query parameters (e.g. error redirect)
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('error')) {
      showToast('Login notice: ' + urlParams.get('error'), 'error');
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }

  // --------------------------------------------------------------------------
  // CONFIG & MODELS
  // --------------------------------------------------------------------------
  async function loadAppConfig() {
    try {
      const res = await fetch('/api/config');
      if (res.ok) {
        state.config = await res.json();
        if (state.config.defaultModel) {
          state.selectedModel = state.config.defaultModel;
        }
        initGoogleIdentity();
      }
    } catch (err) {
      console.warn('Failed to fetch /api/config', err);
    }
  }

  async function loadModels() {
    try {
      const res = await fetch('/api/models');
      if (res.ok) {
        const data = await res.json();
        state.availableModels = data.models || [];
        renderModelDropdown();
        updateSelectedModelUI();
      }
    } catch (err) {
      console.warn('Failed to load models', err);
    }
  }

  function renderModelDropdown() {
    elements.modelDropdownMenu.innerHTML = '';
    state.availableModels.forEach((m) => {
      const isSelected = m.id === state.selectedModel;
      const opt = document.createElement('div');
      opt.className = `model-option ${isSelected ? 'selected' : ''}`;
      opt.innerHTML = `
        <div class="model-option-top">
          <span class="model-option-name">${escapeHtml(m.name)}</span>
          <span class="model-badge">${escapeHtml(m.badge || m.provider)}</span>
        </div>
        <div class="model-option-desc">${escapeHtml(m.description)}</div>
      `;
      opt.addEventListener('click', () => {
        selectModel(m.id);
        elements.modelDropdownMenu.classList.remove('show');
      });
      elements.modelDropdownMenu.appendChild(opt);
    });
  }

  function selectModel(modelId) {
    state.selectedModel = modelId;
    updateSelectedModelUI();
    renderModelDropdown();

    // If active chat exists, update its model in D1
    if (state.activeChatId && state.currentUser) {
      fetch(`/api/chats/${state.activeChatId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelId })
      }).catch(console.error);
    }
  }

  function updateSelectedModelUI() {
    const current = state.availableModels.find((m) => m.id === state.selectedModel);
    if (current) {
      elements.currentModelName.textContent = current.name;
      elements.currentModelBadge.textContent = current.badge || current.provider;
      elements.inputModelChipText.textContent = current.name;
    }
  }

  // --------------------------------------------------------------------------
  // AUTHENTICATION & GOOGLE IDENTITY
  // --------------------------------------------------------------------------
  async function checkCurrentUser() {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        if (data.user) {
          setUserLoggedIn(data.user);
          await loadUserChats();
          return;
        }
      }
    } catch (err) {
      console.warn('Check auth me error:', err);
    }
    setUserLoggedOut();
  }

  function setUserLoggedIn(user) {
    state.currentUser = user;
    elements.userFooterLoggedIn.style.display = 'block';
    elements.userFooterLoggedOut.style.display = 'none';

    // Avatar
    if (user.picture) {
      elements.userAvatar.innerHTML = `<img src="${escapeHtml(user.picture)}" alt="${escapeHtml(user.name)}">`;
      elements.settingsUserAvatar.innerHTML = `<img src="${escapeHtml(user.picture)}" alt="${escapeHtml(user.name)}">`;
    } else {
      const initial = (user.name || user.email || 'U')[0].toUpperCase();
      elements.userAvatar.textContent = initial;
      elements.settingsUserAvatar.textContent = initial;
    }

    elements.userName.textContent = user.name || 'User';
    elements.userEmail.textContent = user.email || '';
    elements.settingsUserEmail.textContent = `${user.name} (${user.email})`;
  }

  function setUserLoggedOut() {
    state.currentUser = null;
    elements.userFooterLoggedIn.style.display = 'none';
    elements.userFooterLoggedOut.style.display = 'block';
    elements.settingsUserEmail.textContent = 'Not signed in';
    elements.chatsListContainer.innerHTML = `
      <div style="padding: 16px; font-size: 13px; color: var(--text-muted); text-align: center;">
        Sign in with Google to save chat history.
      </div>
    `;
  }

  function initGoogleIdentity() {
    if (state.config.googleClientId && window.google?.accounts?.id) {
      try {
        google.accounts.id.initialize({
          client_id: state.config.googleClientId,
          callback: handleGoogleCredentialResponse,
          auto_select: false
        });

        // Render Google Sign In Button
        if (elements.googleGsiButtonContainer) {
          google.accounts.id.renderButton(elements.googleGsiButtonContainer, {
            theme: 'outline',
            size: 'large',
            width: 320,
            text: 'continue_with',
            shape: 'rectangular'
          });
        }
      } catch (e) {
        console.warn('Google Identity initialization failed:', e);
      }
    }
  }

  async function handleGoogleCredentialResponse(response) {
    try {
      showToast('Verifying Google credentials with Cloudflare Worker...', 'info');
      const res = await fetch('/api/auth/google/credential', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: response.credential })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Google login failed');
      }

      setUserLoggedIn(data.user);
      closeAuthModal();
      showToast(`Welcome back, ${data.user.name}!`, 'success');
      await loadUserChats();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function initiateGoogleOAuth() {
    try {
      const res = await fetch('/api/auth/google/url');
      const data = await res.json();
      if (!res.ok || !data.url) {
        throw new Error(data.error || 'Google OAuth URL generation failed');
      }
      window.location.href = data.url;
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function loginAsGuest() {
    try {
      showToast('Creating guest session in Cloudflare D1...', 'info');
      const res = await fetch('/api/auth/demo', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Guest login failed');
      setUserLoggedIn(data.user);
      closeAuthModal();
      showToast(`Welcome, ${data.user.name}!`, 'success');
      await loadUserChats();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      setUserLoggedOut();
      startNewChat();
      showToast('Signed out successfully', 'info');
    } catch (err) {
      showToast('Logout failed', 'error');
    }
  }

  // --------------------------------------------------------------------------
  // CHAT PERSISTENCE (CLOUDFLARE D1)
  // --------------------------------------------------------------------------
  async function loadUserChats() {
    if (!state.currentUser) return;
    try {
      const res = await fetch('/api/chats');
      if (res.ok) {
        const data = await res.json();
        state.chats = data.chats || [];
        renderSidebarChats();
      }
    } catch (err) {
      console.warn('Failed to load user chats:', err);
    }
  }

  function renderSidebarChats(searchFilter = '') {
    elements.chatsListContainer.innerHTML = '';
    const filtered = searchFilter
      ? state.chats.filter((c) => c.title.toLowerCase().includes(searchFilter.toLowerCase()))
      : state.chats;

    if (filtered.length === 0) {
      elements.chatsListContainer.innerHTML = `
        <div style="padding: 16px; font-size: 13px; color: var(--text-muted); text-align: center;">
          ${searchFilter ? 'No matching conversations' : 'No chats yet'}
        </div>
      `;
      return;
    }

    filtered.forEach((chat) => {
      const item = document.createElement('div');
      item.className = `chat-item ${chat.id === state.activeChatId ? 'active' : ''}`;
      item.dataset.chatId = chat.id;

      item.innerHTML = `
        <span class="chat-title-text" title="${escapeHtml(chat.title)}">${escapeHtml(chat.title)}</span>
        <div class="chat-actions">
          <button class="btn-icon-sm edit-btn" title="Rename chat">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 20h9"></path>
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
            </svg>
          </button>
          <button class="btn-icon-sm delete-btn" title="Delete chat">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      `;

      // Select chat
      item.addEventListener('click', (e) => {
        if (e.target.closest('.chat-actions')) return;
        selectChat(chat.id);
      });

      // Rename chat
      const editBtn = item.querySelector('.edit-btn');
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        promptRenameChat(chat);
      });

      // Delete chat
      const deleteBtn = item.querySelector('.delete-btn');
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteChat(chat.id);
      });

      elements.chatsListContainer.appendChild(item);
    });
  }

  async function selectChat(chatId) {
    if (state.isGenerating) {
      showToast('Please wait or stop the current generation before switching chats.', 'info');
      return;
    }

    state.activeChatId = chatId;
    renderSidebarChats();

    try {
      const res = await fetch(`/api/chats/${chatId}`);
      if (!res.ok) throw new Error('Failed to load chat details');
      const data = await res.json();

      state.currentMessages = data.messages || [];
      if (data.chat?.model) {
        selectModel(data.chat.model);
      }
      renderMessages();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function startNewChat() {
    if (state.isGenerating) return;
    state.activeChatId = null;
    state.currentMessages = [];
    renderSidebarChats();
    renderMessages();
    elements.chatTextarea.focus();
  }

  async function promptRenameChat(chat) {
    const newTitle = prompt('Enter a new title for this chat:', chat.title);
    if (!newTitle || newTitle.trim() === chat.title) return;

    try {
      const res = await fetch(`/api/chats/${chat.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle.trim() })
      });
      if (!res.ok) throw new Error('Rename failed');
      const data = await res.json();
      chat.title = data.chat.title;
      renderSidebarChats();
      showToast('Chat renamed', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function deleteChat(chatId) {
    if (!confirm('Are you sure you want to delete this chat conversation?')) return;
    try {
      const res = await fetch(`/api/chats/${chatId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      state.chats = state.chats.filter((c) => c.id !== chatId);
      if (state.activeChatId === chatId) {
        startNewChat();
      } else {
        renderSidebarChats();
      }
      showToast('Chat deleted', 'info');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function clearAllChats() {
    if (!confirm('Are you sure you want to delete ALL conversations permanently? This cannot be undone.')) return;
    try {
      const res = await fetch('/api/chats', { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to clear chats');
      state.chats = [];
      startNewChat();
      closeSettingsModal();
      showToast('All conversations cleared', 'info');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // --------------------------------------------------------------------------
  // MESSAGING & STREAMING (OPENROUTER)
  // --------------------------------------------------------------------------
  function renderMessages() {
    elements.messagesList.innerHTML = '';

    if (state.currentMessages.length === 0) {
      elements.welcomeScreen.style.display = 'flex';
      return;
    }

    elements.welcomeScreen.style.display = 'none';

    state.currentMessages.forEach((msg) => {
      appendMessageToDOM(msg.role, msg.content, false);
    });

    scrollToBottom();
  }

  function appendMessageToDOM(role, content, isStreaming = false) {
    elements.welcomeScreen.style.display = 'none';

    const row = document.createElement('div');
    row.className = `message-row ${role}`;

    const isUser = role === 'user';
    const avatar = document.createElement('div');
    avatar.className = `message-avatar ${isUser ? 'user-avatar' : 'assistant-avatar'}`;

    if (isUser) {
      if (state.currentUser?.picture) {
        avatar.innerHTML = `<img src="${escapeHtml(state.currentUser.picture)}" alt="User">`;
      } else {
        avatar.textContent = (state.currentUser?.name || 'U')[0].toUpperCase();
      }
    } else {
      avatar.innerHTML = `<img src="favicon.svg" alt="Indus Agent">`;
    }

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';

    if (isUser) {
      bubble.textContent = content;
    } else {
      bubble.innerHTML = renderMarkdown(content);
      if (isStreaming) {
        const cursor = document.createElement('span');
        cursor.className = 'streaming-cursor';
        bubble.appendChild(cursor);
      }
    }

    row.appendChild(avatar);
    row.appendChild(bubble);

    // If assistant completed message, add action buttons (Copy / Regenerate)
    if (!isUser && !isStreaming) {
      attachMessageActions(row, content);
    }

    elements.messagesList.appendChild(row);
    scrollToBottom();
    return { row, bubble };
  }

  function attachMessageActions(messageRow, rawContent) {
    const actions = document.createElement('div');
    actions.className = 'message-actions';

    // Copy text button
    const btnCopy = document.createElement('button');
    btnCopy.className = 'btn-action-sm';
    btnCopy.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>
      <span>Copy</span>
    `;
    btnCopy.addEventListener('click', () => {
      navigator.clipboard.writeText(rawContent).then(() => {
        btnCopy.innerHTML = `
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10a37f" stroke-width="2.5">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          <span style="color: #10a37f;">Copied!</span>
        `;
        setTimeout(() => {
          btnCopy.innerHTML = `
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            <span>Copy</span>
          `;
        }, 2000);
      });
    });

    actions.appendChild(btnCopy);
    messageRow.querySelector('.message-bubble').appendChild(actions);
  }

  function renderMarkdown(text) {
    if (!text) return '';
    let html = '';
    if (window.marked) {
      html = marked.parse(text);
    } else {
      html = escapeHtml(text).replace(/\n/g, '<br>');
    }

    // Enhance code blocks with custom header and copy button
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;

    tempDiv.querySelectorAll('pre code').forEach((codeBlock) => {
      const pre = codeBlock.parentElement;
      const langClass = Array.from(codeBlock.classList).find((c) => c.startsWith('language-'));
      const lang = langClass ? langClass.replace('language-', '') : 'code';

      const wrapper = document.createElement('div');
      wrapper.className = 'code-block-container';

      const header = document.createElement('div');
      header.className = 'code-header';
      header.innerHTML = `
        <span>${escapeHtml(lang)}</span>
        <button class="btn-copy-code" type="button">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
          <span>Copy code</span>
        </button>
      `;

      const copyBtn = header.querySelector('.btn-copy-code');
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(codeBlock.innerText).then(() => {
          copyBtn.innerHTML = `
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#10a37f" stroke-width="2.5">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <span style="color: #10a37f;">Copied!</span>
          `;
          setTimeout(() => {
            copyBtn.innerHTML = `
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              <span>Copy code</span>
            `;
          }, 2000);
        });
      });

      pre.parentNode.insertBefore(wrapper, pre);
      wrapper.appendChild(header);
      wrapper.appendChild(pre);
    });

    return tempDiv.innerHTML;
  }

  async function handleSendMessage() {
    const text = elements.chatTextarea.value.trim();
    if (!text || state.isGenerating) return;

    // Check if user is logged in
    if (!state.currentUser) {
      openAuthModal();
      return;
    }

    elements.chatTextarea.value = '';
    adjustTextareaHeight();
    updateSendButtonState();

    // 1. If no active chat, create one in Cloudflare D1 first
    if (!state.activeChatId) {
      try {
        const createRes = await fetch('/api/chats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'New Chat',
            model: state.selectedModel
          })
        });
        if (!createRes.ok) throw new Error('Failed to create chat in Cloudflare D1');
        const createData = await createRes.json();
        state.activeChatId = createData.chat.id;
        state.chats.unshift(createData.chat);
        renderSidebarChats();
      } catch (err) {
        showToast(err.message, 'error');
        return;
      }
    }

    // 2. Append User Message
    const userMsg = { id: crypto.randomUUID(), role: 'user', content: text };
    state.currentMessages.push(userMsg);
    appendMessageToDOM('user', text, false);

    // 3. Setup Streaming Assistant Message
    setGeneratingState(true);
    state.abortController = new AbortController();

    const { row: assistantRow, bubble: assistantBubble } = appendMessageToDOM('assistant', '', true);

    let accumulatedText = '';
    const headers = { 'Content-Type': 'application/json' };
    if (state.settings.openRouterKey) {
      headers['X-OpenRouter-Key'] = state.settings.openRouterKey;
    }

    try {
      const response = await fetch(`/api/chats/${state.activeChatId}/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          content: text,
          model: state.selectedModel,
          temperature: state.settings.temperature,
          systemPrompt: state.settings.systemPrompt
        }),
        signal: state.abortController.signal
      });

      if (!response.ok) {
        let errDesc = '';
        try {
          const errJson = await response.json();
          errDesc = errJson.error || errJson.message;
        } catch {
          errDesc = await response.text();
        }
        throw new Error(errDesc || `Request failed with status ${response.status}`);
      }

      // Read SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep last incomplete line in buffer

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const dataStr = trimmed.slice(6);

          if (dataStr === '[DONE]') break;

          try {
            const parsed = JSON.parse(dataStr);
            if (parsed.delta) {
              accumulatedText += parsed.delta;
              // Re-render markdown
              assistantBubble.innerHTML = renderMarkdown(accumulatedText);
              const cursor = document.createElement('span');
              cursor.className = 'streaming-cursor';
              assistantBubble.appendChild(cursor);
              scrollToBottom();
            }
          } catch (e) {
            // Json parse ignore
          }
        }
      }

      // Streaming finished
      const assistantMsg = { id: crypto.randomUUID(), role: 'assistant', content: accumulatedText };
      state.currentMessages.push(assistantMsg);

      // Clean up cursor and add action buttons
      assistantBubble.innerHTML = renderMarkdown(accumulatedText);
      attachMessageActions(assistantRow, accumulatedText);

      // Refresh chat list to update title and order
      await loadUserChats();

    } catch (err) {
      if (err.name === 'AbortError') {
        showToast('Generation stopped', 'info');
      } else {
        showToast(err.message, 'error');
        assistantBubble.innerHTML = `
          <div style="color: var(--danger-color); padding: 8px 12px; border: 1px solid var(--danger-color); border-radius: 8px; font-size: 13px;">
            ⚠️ <strong>Error:</strong> ${escapeHtml(err.message)}
          </div>
        `;
      }
    } finally {
      setGeneratingState(false);
      state.abortController = null;
    }
  }

  function stopGenerating() {
    if (state.abortController) {
      state.abortController.abort();
    }
  }

  function setGeneratingState(isGenerating) {
    state.isGenerating = isGenerating;
    if (isGenerating) {
      elements.btnSendMessage.style.display = 'none';
      elements.btnStopGenerating.classList.add('show');
    } else {
      elements.btnSendMessage.style.display = 'flex';
      elements.btnStopGenerating.classList.remove('show');
      updateSendButtonState();
      elements.chatTextarea.focus();
    }
  }

  // --------------------------------------------------------------------------
  // EVENT LISTENERS & UI HELPERS
  // --------------------------------------------------------------------------
  function setupEventListeners() {
    // Sidebar toggle
    elements.btnToggleSidebar.addEventListener('click', () => {
      elements.sidebar.classList.toggle('collapsed');
    });
    elements.btnCollapseSidebar.addEventListener('click', () => {
      elements.sidebar.classList.add('collapsed');
    });

    // New chat button & Keyboard shortcut
    elements.btnNewChat.addEventListener('click', startNewChat);
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        startNewChat();
      }
    });

    // Search chats
    elements.searchChatsInput.addEventListener('input', (e) => {
      renderSidebarChats(e.target.value);
    });

    // Model Selector toggle
    elements.btnModelSelect.addEventListener('click', (e) => {
      e.stopPropagation();
      elements.modelDropdownMenu.classList.toggle('show');
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.model-selector-wrap')) {
        elements.modelDropdownMenu.classList.remove('show');
      }
    });

    // Suggestion Cards click
    document.querySelectorAll('.suggestion-card').forEach((card) => {
      card.addEventListener('click', () => {
        const promptText = card.dataset.prompt;
        elements.chatTextarea.value = promptText;
        adjustTextareaHeight();
        updateSendButtonState();
        handleSendMessage();
      });
    });

    // Send & Stop buttons
    elements.btnSendMessage.addEventListener('click', handleSendMessage);
    elements.btnStopGenerating.addEventListener('click', stopGenerating);

    // Textarea input & keyboard handlers
    elements.chatTextarea.addEventListener('input', () => {
      adjustTextareaHeight();
      updateSendButtonState();
    });

    elements.chatTextarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
      }
    });

    // Google Sign-in triggers
    elements.btnSidebarGoogleLogin.addEventListener('click', openAuthModal);
    elements.btnModalOAuthRedirect.addEventListener('click', initiateGoogleOAuth);
    if (elements.btnModalGuestLogin) {
      elements.btnModalGuestLogin.addEventListener('click', loginAsGuest);
    }
    elements.btnCloseAuthModal.addEventListener('click', closeAuthModal);
    elements.authModal.addEventListener('click', (e) => {
      if (e.target === elements.authModal) closeAuthModal();
    });

    // Settings Modal triggers
    elements.btnOpenSettings.addEventListener('click', openSettingsModal);
    elements.btnHeaderSettings.addEventListener('click', openSettingsModal);
    elements.btnCloseSettings.addEventListener('click', closeSettingsModal);
    elements.settingsModal.addEventListener('click', (e) => {
      if (e.target === elements.settingsModal) closeSettingsModal();
    });

    // Settings actions
    elements.settingTemperature.addEventListener('input', (e) => {
      elements.temperatureValLabel.textContent = e.target.value;
    });

    elements.btnSaveSettings.addEventListener('click', () => {
      saveSettings();
      closeSettingsModal();
      showToast('Settings saved successfully', 'success');
    });

    elements.btnSettingsLogout.addEventListener('click', () => {
      closeSettingsModal();
      logout();
    });

    elements.btnClearAllChats.addEventListener('click', clearAllChats);

    // Theme Toggle
    elements.btnThemeToggle.addEventListener('click', () => {
      const newTheme = state.settings.theme === 'dark' ? 'light' : 'dark';
      applyTheme(newTheme);
      state.settings.theme = newTheme;
      localStorage.setItem('indus_theme', newTheme);
      showToast(`Switched to ${newTheme} theme`, 'info');
    });
  }

  function setupTextareaAutoResize() {
    elements.chatTextarea.addEventListener('input', adjustTextareaHeight);
  }

  function adjustTextareaHeight() {
    elements.chatTextarea.style.height = 'auto';
    elements.chatTextarea.style.height = Math.min(elements.chatTextarea.scrollHeight, 180) + 'px';
  }

  function updateSendButtonState() {
    const hasText = elements.chatTextarea.value.trim().length > 0;
    elements.btnSendMessage.disabled = !hasText || state.isGenerating;
  }

  function scrollToBottom() {
    elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
  }

  // Modals
  function openAuthModal() {
    elements.authModal.classList.add('active');
  }

  function closeAuthModal() {
    elements.authModal.classList.remove('active');
  }

  function openSettingsModal() {
    elements.settingOpenRouterKey.value = state.settings.openRouterKey;
    elements.settingTemperature.value = state.settings.temperature;
    elements.temperatureValLabel.textContent = state.settings.temperature;
    elements.settingSystemPrompt.value = state.settings.systemPrompt;
    elements.settingsModal.classList.add('active');
  }

  function closeSettingsModal() {
    elements.settingsModal.classList.remove('active');
  }

  function saveSettings() {
    state.settings.openRouterKey = elements.settingOpenRouterKey.value.trim();
    state.settings.temperature = parseFloat(elements.settingTemperature.value);
    state.settings.systemPrompt = elements.settingSystemPrompt.value.trim();

    localStorage.setItem('indus_openrouter_key', state.settings.openRouterKey);
    localStorage.setItem('indus_temperature', state.settings.temperature.toString());
    localStorage.setItem('indus_system_prompt', state.settings.systemPrompt);
  }

  // Toast System
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = 'toast';

    let icon = '';
    if (type === 'success') {
      icon = '<span style="color: #10a37f;">✓</span>';
    } else if (type === 'error') {
      icon = '<span style="color: #ef4444;">✕</span>';
    } else {
      icon = '<span style="color: #3b82f6;">ℹ</span>';
    }

    toast.innerHTML = `${icon} <span>${escapeHtml(message)}</span>`;
    elements.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.25s';
      setTimeout(() => toast.remove(), 250);
    }, 3500);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Run app on DOM load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
