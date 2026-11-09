# ✦ AI Workspace

A modern, lightweight, privacy-focused AI chat workspace powered by **Google Gemini** streamed responses and a zero-dependency **Node.js** backend.

---

## 📑 Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Tech Stack & Architecture](#tech-stack--architecture)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
  - [1. Clone / Navigate](#1-clone--navigate)
  - [2. Environment Configuration](#2-environment-configuration)
  - [3. Start the Server](#3-start-the-server)
  - [4. Open in Browser](#4-open-in-browser)
- [API Endpoints](#api-endpoints)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Running Tests](#running-tests)
- [Troubleshooting & FAQs](#troubleshooting--faqs)
- [Security & Privacy](#security--privacy)
- [License](#license)

---

## 🌟 Overview

**AI Workspace** provides a clean, responsive web interface for interacting with Google Gemini models. It uses **Server-Sent Events (SSE)** for real-time token streaming and local browser storage to keep your conversation history completely private on your device.

The backend is built entirely with **pure Node.js standard libraries**—no external npm runtime packages, no heavy bundlers, and minimal setup required.

---

## ✨ Key Features

- **⚡ Real-time SSE Streaming:** Generative responses stream directly into the chat interface as tokens are produced.
- **🛡️ Zero-Dependency Backend:** Built with native Node.js (`node:http`, `node:fs`, `node:path`), ensuring blazing-fast startup and zero supply-chain risk.
- **🔒 Secure API Key Management:**
  - API keys can be passed via `.env.local` or submitted in the browser UI.
  - In-app entered keys are stored **only in server process memory**—never stored in client `localStorage` and never returned in API payloads.
- **💾 Local Conversation History:**
  - Chat history is stored exclusively in the browser's `localStorage`.
  - Supports multiple conversations, search/filter chats, and quick deletion.
- **🛑 Stream Cancellation & Retry:**
  - Stop ongoing text generation with the built-in abort button.
  - Robust error handling for rate limits (429), quota exhaustion, and invalid credentials.
- **🎨 Modern Responsive UI:**
  - Dark mode by default with clean typography and fluid animations.
  - Collapsible sidebar for desktop and mobile viewports.
  - Interactive prompt suggestions to jumpstart brainstorming.
- **🚦 Protection & Rate Limiting:**
  - Per-IP rate limiting (20 requests/minute default).
  - Strict payload size limits (32 KB request body limit, 12,000 char per message, 40 messages max).
  - Security headers enabled by default (CSP, X-Frame-Options, X-Content-Type-Options).

---

## 🛠️ Tech Stack & Architecture

### **Frontend**
- **HTML5 & CSS3:** Semantic markup, CSS Custom Properties (variables), Flexbox & Grid layouts.
- **JavaScript (ES Modules):** Clean modular design (`app.mjs` for UI orchestration, `app-state.mjs` for state management).
- **Storage:** Browser `localStorage`.

### **Backend**
- **Runtime:** Node.js (v20.11+ recommended).
- **Server:** Native `node:http` HTTP server.
- **Protocol:** HTTP/1.1 with Server-Sent Events (`text/event-stream`).
- **AI Provider:** Google Gemini API (`streamGenerateContent`).

---

## 📂 Project Structure

```text
AI-Workspace/
├── .env.example         # Template for environment configuration
├── .gitignore           # Git ignore list (ignores .env.local, logs, node_modules)
├── app.mjs              # Main frontend controller (UI events, DOM rendering, SSE consumer)
├── app-state.mjs        # Client-side state machine (conversations, messages, search, active chat)
├── index.html           # Main single-page interface
├── package.json         # Project metadata and test/dev run scripts
├── README.md            # Comprehensive project documentation
├── server.mjs           # Zero-dependency Node.js HTTP server & Gemini SSE proxy
├── styles.css           # Modern styles, responsive layouts, and themes
└── tests/
    ├── app-state.test.mjs  # Unit tests for frontend state management
    └── server.test.mjs     # Integration & unit tests for HTTP routes and Gemini streaming
```

---

## 📋 Prerequisites

- **Node.js** v20.11.0 or newer. Check your version with:
  ```bash
  node -v
  ```
- A **Google Gemini API Key** (Get one free at [Google AI Studio](https://aistudio.google.com/apikey)).

---

## 🚀 Quick Start

### 1. Clone / Navigate

Open your terminal in the workspace root directory:
```bash
cd AI-Workspace
```

### 2. Environment Configuration

You have **two options** to configure your Gemini API key:

#### Option A: Using `.env.local` (Recommended for development)
Copy the example environment file:
```powershell
Copy-Item .env.example .env.local
```
*(On Linux/macOS: `cp .env.example .env.local`)*

Open `.env.local` and add your settings:
```dotenv
GEMINI_API_KEY=your_actual_gemini_api_key_here
GEMINI_MODEL=gemini-3.8-flash
HOST=127.0.0.1
PORT=5173
```

#### Option B: Configure inside the UI
You can start the server without setting `.env.local`. Once you open the application, paste your API key into the **Connect your AI** panel on the right sidebar and click **Connect**.

---

### 3. Start the Server

Run one of the following commands:

- **Standard Run:**
  ```bash
  npm start
  ```
  *(or `node server.mjs`)*

- **Development Mode (Auto-reloads on file changes):**
  ```bash
  npm run dev
  ```

Output:
```text
AI Workspace running at http://127.0.0.1:5173
```

---

### 4. Open in Browser

Open your browser and navigate to:
```text
http://127.0.0.1:5173
```
*or*
```text
http://localhost:5173
```

---

## 🔌 API Endpoints

The server exposes lightweight JSON & SSE endpoints:

| Endpoint | Method | Description |
| :--- | :---: | :--- |
| `/api/health` | `GET` | Returns server readiness, model in use, and whether Gemini is configured. |
| `/api/config` | `POST` | Sets the Gemini API key in server memory at runtime (restricted to loopback origin). |
| `/api/chat` | `POST` | Accepts conversation history, validates inputs, and streams back responses via SSE. |
| `/*` | `GET` | Serves static assets (`index.html`, `styles.css`, `app.mjs`, `app-state.mjs`). |

### Chat SSE Event Format (`/api/chat`)
- **`delta`**: Contains streamed chunk: `event: delta\ndata: {"text":"..."}\n\n`
- **`error`**: Emitted on upstream failure: `event: error\ndata: {"error":"..."}\n\n`
- **`done`**: Emitted when completion finishes: `event: done\ndata: {}\n\n`

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| <kbd>Ctrl</kbd> + <kbd>K</kbd> / <kbd>Cmd</kbd> + <kbd>K</kbd> | Start a new chat |
| <kbd>/</kbd> | Focus the search conversations input |
| <kbd>Enter</kbd> | Send current message |
| <kbd>Shift</kbd> + <kbd>Enter</kbd> | Insert a new line in the text area |
| <kbd>Esc</kbd> | Close mobile sidebar / clear focus |

---

## 🧪 Running Tests

The project includes unit and integration tests powered by Node's built-in test runner (`node:test`). Tests use mocked Gemini API responses, requiring **no network access** and **no real API key**.

Run the test suite:
```bash
npm test
```
*or*
```bash
node --test
```

All 18 tests will execute in under a second:
```text
✔ creates a conversation with a stable empty message list
✔ streams assistant text from Gemini while keeping credentials safe
✔ validates a bounded user and assistant conversation history
...
ℹ pass 18
ℹ fail 0
```

---

## ❓ Troubleshooting & FAQs

### Q: Why does `http://127.0.0.1:5173` work in VS Code preview but not in Google Chrome?
1. **Automatic HTTPS Redirect:** Chrome often forces URLs to `https://`. Make sure the URL begins with `http://` and not `https://`.
2. **`localhost` vs `127.0.0.1`:** In Chrome, try visiting `http://localhost:5173` instead.
3. **Incognito Window:** Extensions (VPNs, proxies, adblockers) can intercept loopback addresses. Test in Chrome Incognito mode (`Ctrl + Shift + N`).
4. **Change Host Binding:** If accessing across WSL or local network, set `HOST=0.0.0.0` in `.env.local` and restart the server.

### Q: I'm seeing error `429: Resource Exhausted`
- **Reason:** You have reached Google's Gemini free-tier rate limits or quota for the specified model.
- **Solution:** Wait a minute and retry, or review your project quota in [Google AI Studio Rate Limits](https://aistudio.google.com/rate-limit?timeRange=last-28-days).

### Q: How do I change the Gemini model?
Add `GEMINI_MODEL` to your `.env.local` file:
```dotenv
GEMINI_MODEL=gemini-1.5-flash
```
*(Default model: `gemini-3.8-flash`)*

---

## 🔐 Security & Privacy

1. **Credential Safety:** Your Google Gemini API key is never rendered on the client or exposed in browser storage. All communication with Google's API occurs strictly on the server backend via HTTP headers (`x-goog-api-key`).
2. **Local Data Persistence:** Conversations are saved solely in the browser's `localStorage`. No database or remote storage stores your conversations.
3. **Loopback Protection:** The runtime configuration endpoint (`/api/config`) can only be accessed from the local machine (loopback addresses `127.0.0.1` / `::1`).

---

## 📄 License

ISC License. See [package.json](package.json) for details.
