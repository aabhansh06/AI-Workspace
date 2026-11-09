import test from "node:test";
import assert from "node:assert/strict";
import {
  addConversation,
  appendAssistantMessage,
  appendUserMessage,
  createConversation,
  createState,
  deleteConversation,
  filterConversations,
} from "../app-state.mjs";

test("creates a conversation with a stable empty message list", () => {
  assert.deepEqual(
    createConversation({ id: "c1", title: "New chat", createdAt: 123 }),
    { id: "c1", title: "New chat", createdAt: 123, messages: [] },
  );
});

test("adding a conversation makes it active without mutating prior state", () => {
  const initial = createState();
  const next = addConversation(initial, createConversation({ id: "c1" }));

  assert.equal(initial.activeConversationId, null);
  assert.deepEqual(initial.conversations, []);
  assert.equal(next.activeConversationId, "c1");
  assert.equal(next.conversations[0].id, "c1");
});

test("appends trimmed user messages only to the requested conversation", () => {
  const state = addConversation(
    createState(),
    createConversation({ id: "c1", createdAt: 1 }),
  );
  const next = appendUserMessage(state, "c1", "  Hello  ", 99);

  assert.deepEqual(next.conversations[0].messages, [
    { id: "99", role: "user", content: "Hello", createdAt: 99 },
  ]);
  assert.deepEqual(state.conversations[0].messages, []);
});

test("appends an assistant response to its conversation without changing the user message", () => {
  const withUser = addConversation(
    createState(),
    createConversation({ id: "c1", createdAt: 1 }),
  );
  const withUserMessage = appendUserMessage(withUser, "c1", "Question", 10);
  const withReply = appendAssistantMessage(withUserMessage, "c1", "Answer", 20, "reply");

  assert.deepEqual(withReply.conversations[0].messages, [
    { id: "10", role: "user", content: "Question", createdAt: 10 },
    { id: "reply", role: "assistant", content: "Answer", createdAt: 20 },
  ]);
  assert.equal(withUserMessage.conversations[0].messages.length, 1);
});

test("rejects empty messages and unknown conversations", () => {
  const state = createState();
  assert.throws(() => appendUserMessage(state, "missing", "Hello"), /not found/);
  assert.throws(() => appendUserMessage(state, "missing", "  "), /required/);
});

test("deleting the active conversation selects the newest remaining one", () => {
  const first = createConversation({ id: "first" });
  const second = createConversation({ id: "second" });
  const state = addConversation(addConversation(createState(), first), second);
  const next = deleteConversation(state, "second");

  assert.equal(next.activeConversationId, "first");
  assert.deepEqual(next.conversations.map(({ id }) => id), ["first"]);
});

test("filters conversation titles without regard to case or surrounding whitespace", () => {
  const conversations = [
    createConversation({ id: "1", title: "Product planning" }),
    createConversation({ id: "2", title: "Weekly notes" }),
  ];

  assert.deepEqual(
    filterConversations(conversations, "  PRODUCT "),
    [conversations[0]],
  );
});
