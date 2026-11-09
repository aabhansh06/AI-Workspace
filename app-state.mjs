export function createState() {
  return { conversations: [], activeConversationId: null };
}

export function createConversation({
  id,
  title = "New chat",
  createdAt = Date.now(),
} = {}) {
  if (!id) {
    throw new Error("A conversation id is required.");
  }

  return { id, title, createdAt, messages: [] };
}

export function addConversation(state, conversation) {
  return {
    conversations: [
      conversation,
      ...state.conversations.filter(({ id }) => id !== conversation.id),
    ],
    activeConversationId: conversation.id,
  };
}

function appendMessage(state, conversationId, role, content, createdAt, id) {
  const text = content.trim();
  if (!text) {
    throw new Error("A message is required.");
  }

  const conversation = state.conversations.find(({ id }) => id === conversationId);
  if (!conversation) {
    throw new Error(`Conversation "${conversationId}" was not found.`);
  }

  return {
    ...state,
    conversations: state.conversations.map((item) =>
      item.id === conversationId
        ? {
            ...item,
            title:
              role === "user" && item.messages.length === 0
                ? text.replace(/\s+/g, " ").slice(0, 48)
                : item.title,
            messages: [
              ...item.messages,
              { id: id ?? String(createdAt), role, content: text, createdAt },
            ],
          }
        : item,
    ),
  };
}

export function appendUserMessage(
  state,
  conversationId,
  content,
  createdAt = Date.now(),
  id = String(createdAt),
) {
  return appendMessage(state, conversationId, "user", content, createdAt, id);
}

export function appendAssistantMessage(
  state,
  conversationId,
  content,
  createdAt = Date.now(),
  id = String(createdAt),
) {
  return appendMessage(state, conversationId, "assistant", content, createdAt, id);
}

export function deleteConversation(state, conversationId) {
  const conversations = state.conversations.filter(({ id }) => id !== conversationId);
  return {
    conversations,
    activeConversationId:
      state.activeConversationId === conversationId
        ? (conversations[0]?.id ?? null)
        : state.activeConversationId,
  };
}

export function filterConversations(conversations, query) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return conversations;
  }

  return conversations.filter(({ title }) =>
    title.toLocaleLowerCase().includes(normalizedQuery),
  );
}
