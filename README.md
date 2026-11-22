# Indus Agent - ChatGPT Web Clone

**Indus Agent** is a full-featured ChatGPT web clone built with modern Web Standards, powered by:
- **Cloudflare Pages & Workers** for high-speed edge compute and static asset serving
- **Cloudflare D1** for lightning-fast, persistent SQLite relational storage
- **Google OAuth 2.0 & Google Identity Services** for authentication (without Firebase or Supabase)
- **OpenRouter API** for AI reasoning and real-time Server-Sent Events (SSE) streaming (no Google AI Studio)

---

## 🚀 Key Features

- **ChatGPT UI & UX**:
  - Dark & Light mode (defaulting to ChatGPT's sleek dark theme)
  - Collapsible sidebar with chat history grouped by date
  - Keyboard shortcuts (`Ctrl+K` for new chat, `Enter` to send, `Shift+Enter` for newline)
  - Code syntax highlighting with auto-detected languages and one-click "Copy code" button
  - Stop generation button to abort streams mid-flight
  - One-click copy and regeneration for assistant messages
  - Prompt suggestion cards on empty chat screens

- **Multi-Model AI Support via OpenRouter**:
  - `meta-llama/llama-3.3-70b-instruct` (State of the art, fast & cost-efficient)
  - `deepseek/deepseek-chat` (DeepSeek V3)
  - `deepseek/deepseek-r1` (DeepSeek Reasoning model)
  - `anthropic/claude-3.5-sonnet` (Industry-leading coding & logic)
  - `openai/gpt-4o` & `openai/gpt-4o-mini`
  - `mistralai/mistral-large-2411`
  - `google/gemini-2.0-flash-exp:free` (Free tier on OpenRouter)

- **Pure Cloudflare Authentication (No Firebase / No Supabase)**:
  - Custom Google OAuth 2.0 code exchange flow
  - Google Identity Services (GSI) One-Tap & standard button support
  - High-entropy crypto session tokens stored securely in Cloudflare D1
  - `HttpOnly`, `SameSite=Lax` secure session cookies

- **Cloudflare D1 Persistence**:
  - Database: `indus-agent-db`
  - Tables: `users`, `sessions`, `chats`, `messages`
  - Foreign keys with `ON DELETE CASCADE` and targeted indexes for sub-millisecond lookups

---

## 📁 Project Structure

```
indus-agent/
├── wrangler.jsonc          # Cloudflare Worker & D1 configuration
├── schema.sql              # Cloudflare D1 SQLite database schema
├── .dev.vars               # Local development secrets (OpenRouter & Google OAuth)
├── .dev.vars.example       # Example template for secrets
├── package.json            # Node.js project scripts and dependencies
├── worker/
│   ├── index.js            # Main Cloudflare Worker router & API endpoints
│   ├── auth.js             # Google OAuth & session management
│   ├── db.js               # Cloudflare D1 database operations
│   └── openrouter.js       # OpenRouter SSE streaming client & model catalog
└── public/
    ├── index.html          # ChatGPT-clone responsive UI
    ├── style.css           # ChatGPT design styles (dark/light)
    ├── app.js              # Frontend chat state, streaming, & auth handling
    └── favicon.svg         # Indus Agent brand icon
```

---

## 🛠️ Quickstart: Running Locally

### 1. Configure Secrets in `.dev.vars`
Open `.dev.vars` and insert your credentials:

```ini
# OpenRouter API Key (https://openrouter.ai/keys)
OPENROUTER_API_KEY=sk-or-v1-...

# Google OAuth 2.0 (Google Cloud Console -> APIs & Services -> Credentials)
GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret

# Local app origin
APP_URL=http://localhost:8787
```

> **Note**: In Google Cloud Console, add `http://localhost:8787` to **Authorized JavaScript origins** and `http://localhost:8787/api/auth/google/callback` to **Authorized redirect URIs**.

### 2. Start the Local Dev Server
Run the following command:
```bash
npm run dev
```
Wrangler will launch the local edge server at `http://localhost:8787` with local D1 emulation and live reload.

---

## ☁️ Deploying to Cloudflare

The Cloudflare D1 database `indus-agent-db` is already created and migrated on your Cloudflare account!

To deploy your worker and frontend live to Cloudflare:

```bash
# 1. Set your OpenRouter API Key secret in Cloudflare
npx wrangler secret put OPENROUTER_API_KEY

# 2. Set your Google OAuth Client Secret
npx wrangler secret put GOOGLE_CLIENT_SECRET

# 3. Deploy
npm run deploy
```

Once deployed, add your live Worker URL (e.g. `https://indus-agent.<your-subdomain>.workers.dev`) to your Google Cloud Console OAuth Authorized Origins and Redirect URIs.

---

## 📡 REST API Reference

| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `GET` | `/api/health` | Service and database health check | No |
| `GET` | `/api/config` | Client configuration and app metadata | No |
| `GET` | `/api/models` | List of supported OpenRouter models | No |
| `GET` | `/api/auth/google/url` | Get Google OAuth 2.0 login URL | No |
| `GET` | `/api/auth/google/callback` | Google OAuth code exchange callback | No |
| `POST` | `/api/auth/google/credential` | Verify Google One-Tap credential | No |
| `GET` | `/api/auth/me` | Current user profile | Session Cookie |
| `POST` | `/api/auth/logout` | Invalidate session in D1 | Session Cookie |
| `GET` | `/api/chats` | List user conversation threads | Yes |
| `POST` | `/api/chats` | Create a new chat thread | Yes |
| `GET` | `/api/chats/:id` | Fetch chat details and message history | Yes |
| `PATCH` | `/api/chats/:id` | Rename chat title or change model | Yes |
| `DELETE` | `/api/chats/:id` | Delete conversation and messages | Yes |
| `DELETE` | `/api/chats` | Clear all conversations for user | Yes |
| `POST` | `/api/chats/:id/messages` | Send message & stream OpenRouter response | Yes |
