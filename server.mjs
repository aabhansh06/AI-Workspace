import { createServer as createHttpServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = import.meta.dirname;
const MAX_BODY_BYTES = 32 * 1024;
const MAX_MESSAGES = 40;
const MAX_MESSAGE_LENGTH = 12_000;
const MAX_HISTORY_LENGTH = 30_000;
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;
const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
]);
const STATIC_FILES = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/styles.css", "styles.css"],
  ["/app.mjs", "app.mjs"],
  ["/app-state.mjs", "app-state.mjs"],
]);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function validateChatMessages(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_MESSAGES) {
    throw new HttpError(400, `Send between 1 and ${MAX_MESSAGES} messages.`);
  }

  let totalLength = 0;
  const messages = value.map((message) => {
    if (
      !message ||
      !["user", "assistant"].includes(message.role) ||
      typeof message.content !== "string"
    ) {
      throw new HttpError(400, "Each message must have a supported role and text.");
    }

    const content = message.content.trim();
    if (!content) {
      throw new HttpError(400, "Messages cannot be empty.");
    }
    if (content.length > MAX_MESSAGE_LENGTH) {
      throw new HttpError(400, "A message is too long.");
    }

    totalLength += content.length;
    if (totalLength > MAX_HISTORY_LENGTH) {
      throw new HttpError(400, "Conversation history is too long.");
    }

    return { role: message.role, content };
  });

  if (messages.at(-1).role !== "user") {
    throw new HttpError(400, "The latest message must be from the user.");
  }

  return messages;
}

export function parseGeminiEvent(payload) {
  try {
    const event = JSON.parse(payload);
    return (event.candidates ?? [])
      .flatMap((candidate) => candidate.content?.parts ?? [])
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .join("");
  } catch {
    return "";
  }
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}

function setSecurityHeaders(response) {
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader(
    "content-security-policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  );
}

async function readJsonBody(request) {
  if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "Send the request as JSON.");
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new HttpError(413, "Request body is too large.");
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}

function writeEvent(response, eventName, value) {
  response.write(`event: ${eventName}\ndata: ${JSON.stringify(value)}\n\n`);
}

async function streamGeminiResponse(response, upstreamResponse, controller) {
  if (!upstreamResponse.body) {
    throw new Error("Gemini returned an empty stream.");
  }

  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });

  const reader = upstreamResponse.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let finished = false;

  const processLine = (line) => {
    const normalized = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (!normalized.startsWith("data:")) return;
    const payload = normalized.slice(5).trim();
    if (!payload || payload === "[DONE]") return;

    try {
      const parsed = JSON.parse(payload);
      if (parsed?.error) {
        const [, message] = safeProviderError(parsed.error.code ?? 502, parsed.error);
        writeEvent(response, "error", { error: message });
        return;
      }
    } catch {
      // Ignore JSON parse errors for non-JSON lines
    }

    const text = parseGeminiEvent(payload);
    if (text) writeEvent(response, "delta", { text });
  };

  try {
    while (!finished && !controller.signal.aborted) {
      const { value, done } = await reader.read();
      if (done) {
        finished = true;
        pending += decoder.decode();
      } else {
        pending += decoder.decode(value, { stream: true });
      }

      let newline;
      while ((newline = pending.indexOf("\n")) !== -1) {
        processLine(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
      }
    }

    if (!controller.signal.aborted) {
      if (pending) processLine(pending);
      writeEvent(response, "done", {});
      response.end();
    }
  } finally {
    reader.releaseLock();
  }
}

function safeProviderError(status, providerError = {}) {
  const providerStatus = providerError.status ?? "";
  const providerMessage =
    typeof providerError.message === "string" ? providerError.message.toLowerCase() : "";

  if (status === 429 || providerStatus === "RESOURCE_EXHAUSTED") {
    return [
      429,
      "Gemini free-tier quota or rate limit reached for this project/model. Check your current limits in Google AI Studio and retry later.",
    ];
  }
  if (
    status === 401 ||
    status === 403 ||
    /api key not valid|api_key_invalid|permission_denied|key is invalid/.test(providerMessage)
  ) {
    return [
      502,
      "Google rejected this API key. Create a Gemini API key in AI Studio, check its restrictions, and replace the local key.",
    ];
  }
  if (status === 404 || providerStatus === "NOT_FOUND") {
    return [
      502,
      "This Gemini model is not available to the configured project. Check the model name or choose one available in AI Studio.",
    ];
  }
  if (status === 400 || providerStatus === "INVALID_ARGUMENT") {
    return [
      502,
      "Gemini rejected this request. Check that the selected model and API key type are supported for the project.",
    ];
  }
  return [502, "Gemini could not complete this request. Please try again."];
}

function isLoopbackAddress(address = "") {
  return (
    address === "::1" ||
    address === "127.0.0.1" ||
    address.startsWith("127.") ||
    address.startsWith("::ffff:127.")
  );
}

export function createServer({
  apiKey = process.env.GEMINI_API_KEY ?? "",
  model = process.env.GEMINI_MODEL ?? "gemini-3.8-flash",
  fetchImpl = fetch,
} = {}) {
  const recentRequests = new Map();
  let activeApiKey = apiKey;

  return createHttpServer(async (request, response) => {
    setSecurityHeaders(response);
    const url = new URL(request.url, "http://localhost");

    if (url.pathname === "/api/health" && request.method === "GET") {
      return sendJson(response, 200, {
        configured: Boolean(activeApiKey),
        provider: "Google Gemini",
        model,
      });
    }

    if (url.pathname === "/api/config") {
      if (request.method !== "POST") {
        response.setHeader("allow", "POST");
        return sendJson(response, 405, { error: "Method not allowed." });
      }

      if (!isLoopbackAddress(request.socket.remoteAddress)) {
        return sendJson(response, 403, { error: "Provider setup is only available locally." });
      }

      const origin = request.headers.origin;
      if (origin && origin !== `http://${request.headers.host}`) {
        return sendJson(response, 403, { error: "Cross-origin requests are not allowed." });
      }

      try {
        const body = await readJsonBody(request);
        const key = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
        if (key.length < 20 || key.length > 512) {
          throw new HttpError(400, "Enter a valid Gemini API key (20–512 characters).");
        }
        activeApiKey = key;
        return sendJson(response, 200, { configured: true });
      } catch (error) {
        const status = error instanceof HttpError ? error.status : 400;
        const message = error instanceof HttpError ? error.message : "Invalid configuration.";
        return sendJson(response, status, { error: message });
      }
    }

    if (url.pathname === "/api/chat") {
      if (request.method !== "POST") {
        response.setHeader("allow", "POST");
        return sendJson(response, 405, { error: "Method not allowed." });
      }

      const origin = request.headers.origin;
      if (origin && origin !== `http://${request.headers.host}`) {
        return sendJson(response, 403, { error: "Cross-origin requests are not allowed." });
      }

      const now = Date.now();
      const client = request.socket.remoteAddress ?? "unknown";
      const requests = (recentRequests.get(client) ?? []).filter(
        (timestamp) => now - timestamp < RATE_WINDOW_MS,
      );
      if (requests.length >= RATE_LIMIT) {
        recentRequests.set(client, requests);
        return sendJson(response, 429, { error: "Too many requests. Please wait a minute." });
      }
      recentRequests.set(client, [...requests, now]);

      let messages;
      try {
        const body = await readJsonBody(request);
        messages = validateChatMessages(body?.messages);
      } catch (error) {
        const status = error instanceof HttpError ? error.status : 400;
        const message = error instanceof HttpError ? error.message : "Invalid request.";
        return sendJson(response, status, { error: message });
      }

      if (!activeApiKey) {
        return sendJson(response, 503, {
          error: "Gemini is not configured. Enter a key in the setup panel or add GEMINI_API_KEY to .env.local.",
        });
      }

      const controller = new AbortController();
      response.on("close", () => {
        if (!response.writableEnded) controller.abort();
      });

      try {
        const upstream = await fetchImpl(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-goog-api-key": activeApiKey,
            },
            body: JSON.stringify({
              contents: messages.map(({ role, content }) => ({
                role: role === "assistant" ? "model" : "user",
                parts: [{ text: content }],
              })),
              generationConfig: { maxOutputTokens: 2048, temperature: 0.7 },
            }),
            signal: controller.signal,
          },
        );

        if (!upstream.ok) {
          let providerError = {};
          try {
            const body = await upstream.json();
            providerError = body?.error ?? {};
          } catch {
            providerError = {};
          }
          const [status, message] = safeProviderError(upstream.status, providerError);
          return sendJson(response, status, { error: message });
        }

        await streamGeminiResponse(response, upstream, controller);
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error("Gemini request failed.", error);
        if (!response.headersSent) {
          return sendJson(response, 502, {
            error: "Could not connect to Gemini. Check your connection and try again.",
          });
        }
        writeEvent(response, "error", { error: "The response stream ended unexpectedly." });
        response.end();
      }
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      response.setHeader("allow", "GET, HEAD");
      return sendJson(response, 405, { error: "Method not allowed." });
    }

    const file = STATIC_FILES.get(url.pathname);
    if (!file) return sendJson(response, 404, { error: "Not found." });

    try {
      const content = await readFile(resolve(ROOT, file));
      response.writeHead(200, {
        "content-type": MIME_TYPES.get(extname(file)),
        "cache-control": "no-store",
      });
      response.end(request.method === "HEAD" ? undefined : content);
    } catch (error) {
      console.error(`Could not serve ${file}.`, error);
      sendJson(response, 500, { error: "Could not load the application." });
    }
  });
}

function loadLocalEnvironment() {
  const envFile = resolve(ROOT, ".env.local");
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || Object.hasOwn(process.env, match[1])) continue;
      const value = match[2].replace(/^(['"])(.*)\1$/, "$2");
      process.env[match[1]] = value;
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  loadLocalEnvironment();
  const port = Number(process.env.PORT ?? 5173);
  const host = process.env.HOST ?? "127.0.0.1";
  const server = createServer();
  server.listen(port, host, () => {
    console.log(`AI Workspace running at http://${host}:${port}`);
    if (!process.env.GEMINI_API_KEY) {
      console.log("Gemini is not configured yet. Enter a key in the local setup panel.");
    }
  });
}
