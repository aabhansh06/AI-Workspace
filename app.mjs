import {
  addConversation,
  appendAssistantMessage,
  appendUserMessage,
  createConversation,
  createState,
  deleteConversation,
  filterConversations,
} from "./app-state.mjs";

const STORAGE_KEY = "ai-workspace-preview-v1";
const THEME_KEY = "ai-workspace-theme";

// Restore theme from localStorage or system preference
const savedTheme = localStorage.getItem(THEME_KEY);
if (
  savedTheme === "light" ||
  (!savedTheme && window.matchMedia?.("(prefers-color-scheme: light)").matches)
) {
  document.documentElement.classList.add("light-theme");
}

const elements = {
  activeTitle: document.querySelector("#active-title"),
  apiKeyForm: document.querySelector("#api-key-form"),
  apiKeyInput: document.querySelector("#api-key-input"),
  apiKeyHint: document.querySelector("#api-key-hint"),
  conversationCount: document.querySelector("#conversation-count"),
  conversationList: document.querySelector("#conversation-list"),
  conversationSearch: document.querySelector("#conversation-search"),
  messageCount: document.querySelector("#message-count"),
  messageForm: document.querySelector("#message-form"),
  messageInput: document.querySelector("#message-input"),
  messageList: document.querySelector("#message-list"),
  modelName: document.querySelector("#model-name"),
  providerStatus: document.querySelector("#provider-status"),
  setupStatus: document.querySelector("#setup-status"),
  sidebar: document.querySelector(".sidebar"),
  sidebarBackdrop: document.querySelector("#sidebar-backdrop"),
  sidebarEmpty: document.querySelector("#sidebar-empty"),
  stopGeneration: document.querySelector("#stop-generation"),
  toast: document.querySelector("#toast"),
  welcome: document.querySelector("#welcome"),
};
let toastTimer;
let requestController;
let pendingResponse;
let state = loadState();

function isValidState(value) {
  return (
    value &&
    Array.isArray(value.conversations) &&
    (value.activeConversationId === null ||
      typeof value.activeConversationId === "string") &&
    value.conversations.every(
      (conversation) =>
        conversation &&
        typeof conversation.id === "string" &&
        typeof conversation.title === "string" &&
        Array.isArray(conversation.messages) &&
        conversation.messages.every(
          (message) =>
            message &&
            ["user", "assistant"].includes(message.role) &&
            typeof message.content === "string" &&
            typeof message.createdAt === "number",
        ),
    )
  );
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return createState();
    const parsed = JSON.parse(saved);
    if (isValidState(parsed)) {
      if (
        parsed.activeConversationId &&
        !parsed.conversations.some(({ id }) => id === parsed.activeConversationId)
      ) {
        parsed.activeConversationId = parsed.conversations[0]?.id ?? null;
      }
      return parsed;
    }
    showToast("Saved chat data was invalid and has been ignored.");
  } catch (error) {
    showToast("Could not read saved chats from this browser.");
    console.error("Could not load saved conversations:", error);
  }
  return createState();
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    showToast("Could not save this chat. Check your browser storage settings.");
    console.error("Could not save conversations:", error);
  }
}

function activeConversation() {
  return state.conversations.find(({ id }) => id === state.activeConversationId);
}

function renderConversations() {
  const filtered = filterConversations(
    state.conversations,
    elements.conversationSearch.value,
  );
  elements.conversationList.replaceChildren();

  for (const conversation of filtered) {
    const item = document.createElement("div");
    item.className = `conversation-item${conversation.id === state.activeConversationId ? " active" : ""}`;
    const open = document.createElement("button");
    open.type = "button";
    open.className = "conversation-open";
    open.setAttribute("aria-label", `Open ${conversation.title}`);

    const icon = document.createElement("span");
    icon.className = "chat-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "◌";

    const title = document.createElement("span");
    title.className = "conversation-title";
    title.textContent = conversation.title;
    open.append(icon, title);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "delete-chat";
    remove.setAttribute("aria-label", `Delete ${conversation.title}`);
    remove.textContent = "×";
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      const isGeneratingThis = pendingResponse?.conversationId === conversation.id;
      if (isGeneratingThis) {
        pendingResponse = null;
        requestController?.abort();
      }
      state = deleteConversation(state, conversation.id);
      saveState();
      render();
    });

    open.addEventListener("click", () => selectConversation(conversation.id));
    item.append(open, remove);
    elements.conversationList.append(item);
  }

  elements.sidebarEmpty.hidden = filtered.length !== 0;
  elements.sidebarEmpty.textContent = state.conversations.length
    ? "No conversations match your search."
    : "No conversations yet. Start a new chat.";
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderMarkdown(content) {
  if (!content) return "";

  const codeBlocks = [];
  let text = content.replace(/```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const id = codeBlocks.length;
    codeBlocks.push({ lang: lang.trim() || "code", code: code.replace(/\n$/, "") });
    return `__CODE_BLOCK_${id}__`;
  });

  text = escapeHtml(text);

  // Headers
  text = text.replace(/^### (.*$)/gim, '<h3 class="markdown-h3">$1</h3>');
  text = text.replace(/^## (.*$)/gim, '<h2 class="markdown-h2">$1</h2>');
  text = text.replace(/^# (.*$)/gim, '<h1 class="markdown-h1">$1</h1>');

  // Blockquotes
  text = text.replace(/^> (.*$)/gim, '<blockquote class="markdown-blockquote">$1</blockquote>');

  // Inline code
  text = text.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

  // Bold & italic
  text = text.replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>");
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/\*([^*]+)\*/g, "<em>$1</em>");

  // Lists
  text = text.replace(/^(?:[-*]|\d+\.) (.*$)/gim, '<li class="markdown-li">$1</li>');
  text = text.replace(/(<li class="markdown-li">.*<\/li>\n?)+/g, (match) => `<ul class="markdown-list">${match}</ul>`);

  // Paragraphs
  text = text.replace(/\n\n/g, "</p><p>");
  text = text.replace(/\n/g, "<br />");
  text = `<div class="markdown-body"><p>${text}</p></div>`;
  text = text.replace(/<p>\s*<\/p>/g, "");

  // Restore code blocks with Copy button
  for (let i = 0; i < codeBlocks.length; i++) {
    const { lang, code } = codeBlocks[i];
    const escapedCode = escapeHtml(code);
    const blockHtml = `
      <div class="code-block">
        <div class="code-header">
          <span>${escapeHtml(lang)}</span>
          <button type="button" class="copy-code-btn" data-code="${encodeURIComponent(code)}">Copy code</button>
        </div>
        <pre><code>${escapedCode}</code></pre>
      </div>`;
    text = text.replace(`__CODE_BLOCK_${i}__`, blockHtml);
  }

  return text;
}

async function copyToClipboard(text, button, defaultLabel = "Copy") {
  try {
    await navigator.clipboard.writeText(text);
    const prev = button.textContent;
    button.textContent = "Copied!";
    setTimeout(() => {
      button.textContent = defaultLabel || prev;
    }, 2000);
  } catch {
    showToast("Could not copy to clipboard.");
  }
}

function makeMessageRow(role, content, status = "") {
  const row = document.createElement("div");
  row.className = `message-row ${role}`;
  const bubble = document.createElement("div");
  bubble.className = `message-bubble ${role}${status ? ` ${status}` : ""}`;
  if (role === "assistant" && !status) {
    bubble.innerHTML = renderMarkdown(content);
  } else {
    bubble.textContent = content;
  }
  row.append(bubble);
  return { row, bubble };
}

function updateStreamingBubble() {
  const conversation = activeConversation();
  if (!conversation || pendingResponse?.conversationId !== conversation.id) return;

  let pendingBubble = elements.messageList.querySelector(".message-bubble.pending");
  if (!pendingBubble) {
    renderMessages(conversation);
    pendingBubble = elements.messageList.querySelector(".message-bubble.pending");
  }

  if (pendingBubble && pendingResponse.text) {
    pendingBubble.innerHTML = renderMarkdown(pendingResponse.text);
    const isNearBottom =
      elements.messageList.scrollHeight - elements.messageList.scrollTop - elements.messageList.clientHeight < 140;
    if (isNearBottom) {
      elements.messageList.scrollTop = elements.messageList.scrollHeight;
    }
  }
}

function renderMessages(conversation) {
  elements.messageList.replaceChildren();
  for (const message of conversation?.messages ?? []) {
    const { row } = makeMessageRow(message.role, message.content);
    const meta = document.createElement("div");
    meta.className = "message-meta";
    meta.textContent = message.role === "user" ? "You" : "AI Workspace";

    if (message.role === "assistant") {
      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "copy-msg-btn";
      copyBtn.setAttribute("aria-label", "Copy response");
      copyBtn.innerHTML = "<span>📋</span> Copy";
      copyBtn.addEventListener("click", () => copyToClipboard(message.content, copyBtn, "Copy"));
      meta.append(" · ", copyBtn);
    }

    row.append(meta);
    elements.messageList.append(row);
  }

  if (pendingResponse && pendingResponse.conversationId === conversation?.id) {
    const { row, bubble } = makeMessageRow(
      "assistant",
      pendingResponse.error ?? pendingResponse.text,
      pendingResponse.error ? "error" : "pending",
    );
    if (pendingResponse.error) {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "retry-button";
      retry.textContent = "Retry";
      retry.addEventListener("click", () => requestAssistantResponse(conversation.id));
      bubble.append(document.createElement("br"), retry);
    } else if (!pendingResponse.text) {
      const dots = document.createElement("span");
      dots.className = "typing-indicator";
      dots.setAttribute("aria-label", "Gemini is thinking");
      dots.textContent = "Thinking";
      bubble.textContent = "";
      bubble.append(dots, document.createTextNode(" …"));
    } else {
      bubble.innerHTML = renderMarkdown(pendingResponse.text);
    }
    const meta = document.createElement("div");
    meta.className = "message-meta";
    meta.textContent = pendingResponse.error ? "Response failed" : "Gemini is responding";
    row.append(meta);
    elements.messageList.append(row);
  }

  elements.messageList.classList.toggle(
    "visible",
    Boolean(
      conversation?.messages.length ||
        (pendingResponse && pendingResponse.conversationId === conversation?.id),
    ),
  );
  elements.messageList.scrollTop = elements.messageList.scrollHeight;
}

function render() {
  const conversation = activeConversation();
  elements.activeTitle.textContent = conversation?.title ?? "New chat";
  elements.conversationCount.textContent = String(state.conversations.length);
  elements.messageCount.textContent = String(
    state.conversations.reduce((total, item) => total + item.messages.length, 0),
  );
  elements.welcome.hidden = Boolean(conversation?.messages.length);
  elements.messageInput.placeholder = conversation
    ? "Message Gemini…"
    : "Start a new chat to message Gemini";
  elements.stopGeneration.hidden = !requestController;
  renderConversations();
  renderMessages(conversation);
}

function selectConversation(id) {
  state = { ...state, activeConversationId: id };
  saveState();
  render();
  closeSidebar();
}

function startConversation() {
  const conversation = createConversation({ id: crypto.randomUUID() });
  state = addConversation(state, conversation);
  saveState();
  render();
  closeSidebar();
  elements.messageInput.focus();
}

function showToast(message) {
  if (!elements.toast) return;
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove("visible"), 5000);
}

function closeSidebar() {
  elements.sidebar.classList.remove("open");
  elements.sidebarBackdrop.classList.remove("visible");
}

async function readError(response) {
  try {
    const body = await response.json();
    return typeof body.error === "string" ? body.error : "The server could not complete this request.";
  } catch {
    return "The server returned an invalid error response.";
  }
}

async function readGeminiStream(response, conversationId) {
  if (!response.body) {
    throw new Error("The server did not start a response stream.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done = false;

  function processFrame(frame) {
    let eventName = "message";
    const data = [];
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trim());
    }
    if (!data.length) return;

    const payload = JSON.parse(data.join("\n"));
    if (eventName === "error") {
      throw new Error(payload.error || "Gemini response failed.");
    }
    if (eventName === "done") {
      done = true;
      return;
    }
    if (eventName === "delta" && typeof payload.text === "string") {
      pendingResponse.text += payload.text;
      updateStreamingBubble();
    }
  }

  while (true) {
    const { value, done: streamEnded } = await reader.read();
    buffer += streamEnded ? decoder.decode() : decoder.decode(value, { stream: true });

    let boundary;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      processFrame(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
    }
    if (streamEnded) break;
  }

  if (buffer.trim()) processFrame(buffer);
  if (!done) throw new Error("The response stream ended before Gemini finished.");
  if (!pendingResponse?.text.trim()) throw new Error("Gemini returned an empty response. Please retry.");
  return pendingResponse.text;
}

async function requestAssistantResponse(conversationId) {
  if (requestController) return;
  const conversation = state.conversations.find(({ id }) => id === conversationId);
  if (!conversation) return;

  const controller = new AbortController();
  requestController = controller;
  pendingResponse = { conversationId, text: "" };
  render();
  elements.messageInput.disabled = true;
  elements.messageForm.querySelector(".send-button").disabled = true;

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: conversation.messages.map(({ role, content }) => ({ role, content })),
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(await readError(response));

    const answer = await readGeminiStream(response, conversationId);
    if (!state.conversations.some(({ id }) => id === conversationId)) {
      pendingResponse = null;
      return;
    }
    state = appendAssistantMessage(
      state,
      conversationId,
      answer,
      Date.now(),
      crypto.randomUUID(),
    );
    saveState();
    pendingResponse = null;
  } catch (error) {
    if (controller.signal.aborted) {
      pendingResponse = null;
      if (state.conversations.some(({ id }) => id === conversationId)) {
        showToast("Generation stopped. Your message is saved and can be retried.");
      }
    } else {
      console.error("Chat request failed:", error);
      if (pendingResponse) pendingResponse.error = error.message;
      showToast(error.message);
    }
  } finally {
    requestController = null;
    elements.messageInput.disabled = false;
    elements.messageForm.querySelector(".send-button").disabled = false;
    render();
    elements.messageInput.focus();
  }
}

async function loadProviderStatus() {
  try {
    const response = await fetch("/api/health");
    if (!response.ok) throw new Error("The local server could not be reached.");
    const status = await response.json();
    elements.modelName.textContent = status.model;
    elements.modelName.classList.toggle("model-available", status.configured);
    elements.modelName.classList.toggle("model-unavailable", !status.configured);
    elements.providerStatus.textContent = status.configured
      ? "Gemini key set"
      : "Gemini setup needed";
    elements.setupStatus.textContent = status.configured
      ? "Key set; send a message to verify access"
      : "Enter a key below or add GEMINI_API_KEY to .env.local";
    if (status.configured) {
      elements.apiKeyHint.textContent = "Connected for this server session. A restart clears an in-memory key.";
      elements.apiKeyForm.querySelector("button").textContent = "Update key";
    } else {
      elements.apiKeyHint.textContent = "Free-tier access is limited by Google’s model and project quotas.";
    }
    elements.setupStatus.classList.toggle("configured", status.configured);
    elements.providerStatus.classList.toggle("configured", status.configured);
  } catch (error) {
    console.error("Could not check Gemini configuration:", error);
    elements.modelName.textContent = "Server unavailable";
    elements.modelName.classList.add("model-unavailable");
    elements.modelName.classList.remove("model-available");
    elements.providerStatus.textContent = "Start the local server";
    elements.setupStatus.textContent = "Run node server.mjs";
  }
}

elements.apiKeyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const apiKey = elements.apiKeyInput.value.trim();
  if (!apiKey) return;

  const button = elements.apiKeyForm.querySelector("button");
  button.disabled = true;
  button.textContent = "Connecting…";
  elements.setupStatus.textContent = "Sending key to your local server…";

  try {
    const response = await fetch("/api/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey }),
    });
    if (!response.ok) throw new Error(await readError(response));

    elements.apiKeyInput.value = "";
    elements.apiKeyHint.textContent = "Connected in server memory only. Restarting the server clears this key.";
    elements.apiKeyForm.querySelector("button").textContent = "Update key";
    elements.modelName.classList.remove("model-unavailable");
    elements.modelName.classList.add("model-available");
    elements.providerStatus.textContent = "Gemini key set";
    elements.providerStatus.classList.add("configured");
    elements.setupStatus.textContent = "Key set; send a message to verify access";
    elements.setupStatus.classList.add("configured");
    showToast("Key sent to local server memory. Send a message to verify access and free quota.");
  } catch (error) {
    console.error("Could not configure Gemini:", error);
    elements.setupStatus.textContent = "Setup failed";
    showToast(error.message);
    button.textContent = "Connect";
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#new-chat").addEventListener("click", startConversation);
document.querySelector("#clear-conversations").addEventListener("click", () => {
  if (!state.conversations.length) {
    showToast("There are no conversations to clear.");
    return;
  }
  if (!window.confirm("Are you sure you want to clear all conversations?")) {
    return;
  }
  requestController?.abort();
  pendingResponse = null;
  state = createState();
  saveState();
  render();
  showToast("Conversation history cleared from this browser.");
});
document.querySelector("#help-button").addEventListener("click", () => {
  showToast("Add a rotated Gemini API key to the local .env.local file, then restart node server.mjs.");
});
document.querySelector("#theme-toggle").addEventListener("click", () => {
  const isLight = document.documentElement.classList.toggle("light-theme");
  try {
    localStorage.setItem(THEME_KEY, isLight ? "light" : "dark");
  } catch {
    // Ignore storage errors
  }
});
elements.messageList.addEventListener("click", (event) => {
  const copyBtn = event.target.closest(".copy-code-btn");
  if (copyBtn && copyBtn.dataset.code) {
    const code = decodeURIComponent(copyBtn.dataset.code);
    void copyToClipboard(code, copyBtn, "Copy code");
  }
});
document.querySelector("#open-sidebar").addEventListener("click", () => {
  elements.sidebar.classList.add("open");
  elements.sidebarBackdrop.classList.add("visible");
});
document.querySelector("#close-sidebar").addEventListener("click", closeSidebar);
elements.sidebarBackdrop.addEventListener("click", closeSidebar);
elements.conversationSearch.addEventListener("input", renderConversations);
document.querySelector("#stop-generation").addEventListener("click", () => {
  requestController?.abort();
});
document.querySelectorAll(".suggestion-card").forEach((card) => {
  card.addEventListener("click", () => {
    if (!activeConversation()) startConversation();
    const prompt = card.dataset.prompt;
    if (prompt) {
      elements.messageInput.value = prompt;
      elements.messageInput.focus();
      elements.messageInput.dispatchEvent(new Event("input"));
    }
  });
});
elements.messageForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const content = elements.messageInput.value.trim();
  if (!content || requestController) return;
  if (!activeConversation()) startConversation();

  const conversationId = state.activeConversationId;
  state = appendUserMessage(
    state,
    conversationId,
    content,
    Date.now(),
    crypto.randomUUID(),
  );
  elements.messageInput.value = "";
  elements.messageInput.style.height = "auto";
  saveState();
  render();
  void requestAssistantResponse(conversationId);
});
elements.messageInput.addEventListener("input", () => {
  elements.messageInput.style.height = "auto";
  elements.messageInput.style.height = `${Math.min(elements.messageInput.scrollHeight, 140)}px`;
});
elements.messageInput.addEventListener("keydown", (event) => {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    elements.messageForm.requestSubmit();
  }
});
document.addEventListener("keydown", (event) => {
  const activeTag = document.activeElement?.tagName;
  const isInputActive =
    activeTag === "INPUT" ||
    activeTag === "TEXTAREA" ||
    document.activeElement?.isContentEditable;

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    startConversation();
  } else if (event.key === "/" && !isInputActive) {
    event.preventDefault();
    elements.conversationSearch.focus();
  } else if (event.key === "Escape") {
    closeSidebar();
  }
});

render();
void loadProviderStatus();
