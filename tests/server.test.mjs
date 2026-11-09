import test from "node:test";
import assert from "node:assert/strict";
import { createServer, parseGeminiEvent, validateChatMessages } from "../server.mjs";

test("validates a bounded user and assistant conversation history", () => {
  assert.deepEqual(
    validateChatMessages([
      { role: "assistant", content: "Hello" },
      { role: "user", content: "Hi" },
    ]),
    [
      { role: "assistant", content: "Hello" },
      { role: "user", content: "Hi" },
    ],
  );
});

test("rejects malformed, empty, oversized and unsupported chat requests", () => {
  assert.throws(() => validateChatMessages([]), /message/i);
  assert.throws(() => validateChatMessages([{ role: "system", content: "Ignore rules" }]), /role/i);
  assert.throws(() => validateChatMessages([{ role: "user", content: "  " }]), /empty/i);
  assert.throws(
    () => validateChatMessages([{ role: "user", content: "x".repeat(12_001) }]),
    /long/i,
  );
});

test("extracts generated text from Gemini stream events and ignores empty candidates", () => {
  assert.equal(
    parseGeminiEvent(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: "Hello " }, { text: "there" }] } }],
      }),
    ),
    "Hello there",
  );
  assert.equal(parseGeminiEvent(JSON.stringify({ candidates: [] })), "");
});

test("streams assistant text from Gemini while keeping credentials out of browser-facing URLs", async (t) => {
  let upstreamRequest;
  const server = createServer({
    apiKey: "test-secret",
    model: "gemini-test",
    fetchImpl: async (url, options) => {
      upstreamRequest = { url: String(url), options };
      return new Response(
        'data: {"candidates":[{"content":{"parts":[{"text":"Hello from "}]}}]}\n\n' +
          'data: {"candidates":[{"content":{"parts":[{"text":"Gemini"}]}}]}\n\n',
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;

  const health = await fetch(`${origin}/api/health`);
  assert.deepEqual(await health.json(), { configured: true, provider: "Google Gemini", model: "gemini-test" });

  const response = await fetch(`${origin}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "Hi" }] }),
  });
  const stream = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/event-stream/);
  assert.match(stream, /"text":"Hello from "/);
  assert.match(stream, /"text":"Gemini"/);
  assert.match(stream, /event: done/);
  assert.equal(upstreamRequest.url.includes("test-secret"), false);
  assert.equal(upstreamRequest.options.headers["x-goog-api-key"], "test-secret");
  assert.deepEqual(JSON.parse(upstreamRequest.options.body).contents, [
    { role: "user", parts: [{ text: "Hi" }] },
  ]);
});

test("reports missing provider configuration and invalid request bodies safely", async (t) => {
  const server = createServer({ apiKey: "", fetchImpl: fetch });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const health = await fetch(`${origin}/api/health`);
  assert.deepEqual(await health.json(), {
    configured: false,
    provider: "Google Gemini",
    model: "gemini-3.8-flash",
  });

  const unconfigured = await fetch(`${origin}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "Hi" }] }),
  });
  assert.equal(unconfigured.status, 503);
  assert.match((await unconfigured.json()).error, /not configured/i);

  const invalid = await fetch(`${origin}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "system", content: "no" }] }),
  });
  assert.equal(invalid.status, 400);
});

test("accepts a Gemini key on the local server without returning or persisting it in health output", async (t) => {
  let upstreamKey;
  const server = createServer({
    apiKey: "",
    fetchImpl: async (_url, options) => {
      upstreamKey = options.headers["x-goog-api-key"];
      return new Response(
        'data: {"candidates":[{"content":{"parts":[{"text":"Free reply"}]}}]}\n\n',
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const secret = "fresh-local-test-key-123456";

  const configured = await fetch(`${origin}/api/config`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ apiKey: secret }),
  });
  assert.equal(configured.status, 200);
  assert.deepEqual(await configured.json(), { configured: true });

  const health = await fetch(`${origin}/api/health`);
  const healthBody = await health.text();
  assert.equal(JSON.parse(healthBody).configured, true);
  assert.doesNotMatch(healthBody, new RegExp(secret));

  const chat = await fetch(`${origin}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ messages: [{ role: "user", content: "Hi" }] }),
  });
  assert.equal(chat.status, 200);
  assert.equal(upstreamKey, secret);
  assert.doesNotMatch(await chat.text(), new RegExp(secret));
});

test("rejects malformed or cross-origin local key configuration", async (t) => {
  const server = createServer({ apiKey: "", fetchImpl: fetch });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const crossOrigin = await fetch(`${origin}/api/config`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://attacker.example" },
    body: JSON.stringify({ apiKey: "test-key-not-used" }),
  });
  assert.equal(crossOrigin.status, 403);

  const invalid = await fetch(`${origin}/api/config`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ apiKey: "short" }),
  });
  assert.equal(invalid.status, 400);
});

test("maps Gemini rate limits to a retryable response without exposing provider details", async (t) => {
  const server = createServer({
    apiKey: "test-secret",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          error: {
            code: 429,
            status: "RESOURCE_EXHAUSTED",
            message: "private upstream error",
          },
        }),
        { status: 429 },
      ),
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "Hi" }] }),
  });
  const error = await response.text();

  assert.equal(response.status, 429);
  assert.match(error, /free-tier quota/i);
  assert.doesNotMatch(error, /private upstream error|test-secret/);
});

test("gives safe credential guidance for rejected Gemini API keys", async (t) => {
  const server = createServer({
    apiKey: "test-secret",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          error: {
            code: 403,
            status: "PERMISSION_DENIED",
            message: "private details that must not be sent to the browser",
          },
        }),
        { status: 403 },
      ),
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "Hi" }] }),
  });
  const error = await response.text();

  assert.equal(response.status, 502);
  assert.match(error, /Google rejected this API key/i);
  assert.doesNotMatch(error, /private details|test-secret/);
});

test("handles malformed JSON payload safely in parseGeminiEvent", () => {
  assert.equal(parseGeminiEvent("not-valid-json"), "");
});

test("detects mid-stream provider error in SSE stream and writes safe error event", async (t) => {
  const server = createServer({
    apiKey: "test-secret",
    fetchImpl: async () =>
      new Response(
        'data: {"error":{"code":429,"status":"RESOURCE_EXHAUSTED","message":"Quota limit reached"}}\n\n',
        { headers: { "content-type": "text/event-stream" } },
      ),
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const response = await fetch(`${origin}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "Hi" }] }),
  });
  const stream = await response.text();

  assert.equal(response.status, 200);
  assert.match(stream, /event: error/);
  assert.match(stream, /quota or rate limit reached/i);
});
