// Indus Agent - Cloudflare Worker Entrypoint
// Handles API routing, Google OAuth, Cloudflare D1 persistence, and OpenRouter streaming

import { Database } from './db.js';
import { AuthService } from './auth.js';
import { AVAILABLE_MODELS, callOpenRouterStream } from './openrouter.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = url.origin;
    const isHttps = url.protocol === 'https:';

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: getCorsHeaders(origin)
      });
    }

    // Initialize D1 Database & Auth services
    const db = new Database(env.DB);
    const auth = new AuthService(env, db);

    try {
      // 1. Health check & status
      if (url.pathname === '/api/health' && request.method === 'GET') {
        let dbOk = false;
        try {
          await env.DB.prepare('SELECT 1').first();
          dbOk = true;
        } catch (e) {
          console.error('D1 check failed:', e);
        }

        return jsonResponse({
          status: 'ok',
          app: env.APP_NAME || 'Indus Agent',
          database: dbOk ? 'connected' : 'error',
          googleAuth: !!env.GOOGLE_CLIENT_ID,
          openRouterConfigured: !!env.OPENROUTER_API_KEY,
          timestamp: new Date().toISOString()
        }, 200, origin);
      }

      // 2. Client configuration
      if (url.pathname === '/api/config' && request.method === 'GET') {
        return jsonResponse({
          appName: env.APP_NAME || 'Indus Agent',
          googleClientId: env.GOOGLE_CLIENT_ID || null,
          hasServerOpenRouterKey: !!env.OPENROUTER_API_KEY,
          defaultModel: env.DEFAULT_MODEL || 'meta-llama/llama-3.3-70b-instruct'
        }, 200, origin);
      }

      // 3. Models list
      if (url.pathname === '/api/models' && request.method === 'GET') {
        return jsonResponse({ models: AVAILABLE_MODELS }, 200, origin);
      }

      // ----------------------------------------------------
      // AUTHENTICATION ROUTES (Google OAuth + Sessions in D1)
      // ----------------------------------------------------

      // A. Get Google OAuth URL
      if (url.pathname === '/api/auth/google/url' && request.method === 'GET') {
        if (!env.GOOGLE_CLIENT_ID) {
          return jsonResponse({
            error: 'Google OAuth is not configured. Please add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to environment variables.'
          }, 400, origin);
        }
        const state = crypto.randomUUID();
        const authUrl = auth.getGoogleAuthUrl(origin, state);
        return jsonResponse({ url: authUrl, state }, 200, origin);
      }

      // B. Google OAuth Callback (Code exchange -> D1 user -> D1 session)
      if (url.pathname === '/api/auth/google/callback' && request.method === 'GET') {
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        if (error) {
          return new Response(`Authentication cancelled or failed: ${error}`, {
            status: 302,
            headers: { Location: '/?error=' + encodeURIComponent(error) }
          });
        }

        if (!code) {
          return new Response('Missing authorization code', { status: 400 });
        }

        try {
          const tokenData = await auth.exchangeGoogleCode(code, origin);
          const userInfo = await auth.getGoogleUserInfo(tokenData.access_token, tokenData.id_token);

          // Upsert user in Cloudflare D1
          const user = await db.upsertUser({
            id: userInfo.id,
            email: userInfo.email,
            name: userInfo.name,
            picture: userInfo.picture
          });

          // Create session in Cloudflare D1
          const { token, expiresAt } = await db.createSession(user.id);
          const cookieHeader = AuthService.createSessionCookie(token, expiresAt, isHttps);

          return new Response(null, {
            status: 302,
            headers: {
              'Location': '/',
              'Set-Cookie': cookieHeader
            }
          });
        } catch (err) {
          console.error('Google callback error:', err);
          return new Response(`Authentication error: ${err.message}`, {
            status: 302,
            headers: { Location: '/?error=' + encodeURIComponent(err.message) }
          });
        }
      }

      // C. Google Identity Services (GSI) Credential Token (One-Tap / Fast Sign-In)
      if (url.pathname === '/api/auth/google/credential' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const credential = body.credential;

        if (!credential) {
          return jsonResponse({ error: 'Missing Google credential token' }, 400, origin);
        }

        try {
          const userInfo = await auth.verifyGoogleCredential(credential);

          // Upsert user in Cloudflare D1
          const user = await db.upsertUser({
            id: userInfo.id,
            email: userInfo.email,
            name: userInfo.name,
            picture: userInfo.picture
          });

          // Create session in Cloudflare D1
          const { token, expiresAt } = await db.createSession(user.id);
          const cookieHeader = AuthService.createSessionCookie(token, expiresAt, isHttps);

          return jsonResponse({
            user,
            token
          }, 200, origin, { 'Set-Cookie': cookieHeader });
        } catch (err) {
          return jsonResponse({ error: err.message }, 401, origin);
        }
      }

      // D. Demo / Guest Login (For instant local testing before Google Cloud credentials are added)
      if (url.pathname === '/api/auth/demo' && request.method === 'POST') {
        const guestUser = await db.upsertUser({
          id: 'google_guest_' + crypto.randomUUID().slice(0, 8),
          email: 'guest@indusagent.ai',
          name: 'Guest Explorer',
          picture: null
        });

        const { token, expiresAt } = await db.createSession(guestUser.id);
        const cookieHeader = AuthService.createSessionCookie(token, expiresAt, isHttps);

        return jsonResponse({
          user: guestUser,
          token
        }, 200, origin, { 'Set-Cookie': cookieHeader });
      }

      // E. Get Current User profile (/api/auth/me)
      if (url.pathname === '/api/auth/me' && request.method === 'GET') {
        const user = await auth.authenticateRequest(request);
        if (!user) {
          return jsonResponse({ user: null }, 200, origin);
        }
        return jsonResponse({ user }, 200, origin);
      }

      // E. Logout (/api/auth/logout)
      if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
        const cookies = AuthService.parseCookies(request);
        const token = cookies['indus_session'] || (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
        if (token) {
          await db.deleteSession(token);
        }
        const clearCookie = AuthService.createClearCookie(isHttps);
        return jsonResponse({ success: true }, 200, origin, { 'Set-Cookie': clearCookie });
      }

      // ----------------------------------------------------
      // PROTECTED CHAT & MESSAGE ROUTES
      // ----------------------------------------------------

      // Require authenticated user for chat endpoints
      if (url.pathname.startsWith('/api/chats')) {
        const user = await auth.authenticateRequest(request);
        if (!user) {
          return jsonResponse({ error: 'Unauthorized. Please sign in with Google to continue.' }, 401, origin);
        }

        // List chats: GET /api/chats
        if (url.pathname === '/api/chats' && request.method === 'GET') {
          const chats = await db.listChats(user.id);
          return jsonResponse({ chats }, 200, origin);
        }

        // Clear all chats: DELETE /api/chats
        if (url.pathname === '/api/chats' && request.method === 'DELETE') {
          await db.clearUserChats(user.id);
          return jsonResponse({ success: true }, 200, origin);
        }

        // Create new chat: POST /api/chats
        if (url.pathname === '/api/chats' && request.method === 'POST') {
          const body = await request.json().catch(() => ({}));
          const chat = await db.createChat({
            userId: user.id,
            title: body.title || 'New Chat',
            model: body.model || env.DEFAULT_MODEL || 'meta-llama/llama-3.3-70b-instruct'
          });
          return jsonResponse({ chat }, 201, origin);
        }

        // Match /api/chats/:id
        const chatMatch = url.pathname.match(/^\/api\/chats\/([a-zA-Z0-9_-]+)$/);
        if (chatMatch) {
          const chatId = chatMatch[1];

          // GET chat & its messages
          if (request.method === 'GET') {
            const chat = await db.getChat(chatId, user.id);
            if (!chat) {
              return jsonResponse({ error: 'Chat not found' }, 404, origin);
            }
            const messages = await db.listMessages(chatId);
            return jsonResponse({ chat, messages }, 200, origin);
          }

          // PATCH chat (rename or update model)
          if (request.method === 'PATCH') {
            const body = await request.json().catch(() => ({}));
            const updated = await db.updateChat(chatId, user.id, {
              title: body.title,
              model: body.model
            });
            return jsonResponse({ chat: updated }, 200, origin);
          }

          // DELETE chat
          if (request.method === 'DELETE') {
            await db.deleteChat(chatId, user.id);
            return jsonResponse({ success: true }, 200, origin);
          }
        }

        // Match /api/chats/:id/messages
        const msgMatch = url.pathname.match(/^\/api\/chats\/([a-zA-Z0-9_-]+)\/messages$/);
        if (msgMatch && request.method === 'POST') {
          const chatId = msgMatch[1];
          const chat = await db.getChat(chatId, user.id);
          if (!chat) {
            return jsonResponse({ error: 'Chat not found' }, 404, origin);
          }

          const body = await request.json().catch(() => ({}));
          const userPrompt = (body.content || '').trim();
          if (!userPrompt) {
            return jsonResponse({ error: 'Message content cannot be empty' }, 400, origin);
          }

          // Save user message in Cloudflare D1
          await db.createMessage({
            chatId,
            role: 'user',
            content: userPrompt
          });

          // Fetch message history for context
          const existingMessages = await db.listMessages(chatId);
          const historyForAI = existingMessages.map((m) => ({
            role: m.role,
            content: m.content
          }));

          // Determine model and API key
          const modelToUse = body.model || chat.model || env.DEFAULT_MODEL || 'meta-llama/llama-3.3-70b-instruct';
          const userApiKey = request.headers.get('X-OpenRouter-Key');
          const effectiveApiKey = userApiKey || env.OPENROUTER_API_KEY;

          if (!effectiveApiKey) {
            return jsonResponse({
              error: 'OpenRouter API key is not configured. Please provide your OpenRouter key in Settings or set OPENROUTER_API_KEY in worker secrets.'
            }, 400, origin);
          }

          // Auto-generate title if this is the first message or current title is "New Chat"
          if (chat.title === 'New Chat') {
            const autoTitle = generateTitle(userPrompt);
            ctx.waitUntil(db.updateChat(chatId, user.id, { title: autoTitle }));
          }

          // Call OpenRouter with streaming
          try {
            const stream = await callOpenRouterStream({
              apiKey: effectiveApiKey,
              model: modelToUse,
              messages: historyForAI,
              temperature: body.temperature || 0.7,
              onComplete: async (fullAssistantResponse) => {
                if (fullAssistantResponse && fullAssistantResponse.trim()) {
                  await db.createMessage({
                    chatId,
                    role: 'assistant',
                    content: fullAssistantResponse
                  });
                }
              }
            });

            return new Response(stream, {
              headers: {
                ...getCorsHeaders(origin),
                'Content-Type': 'text/event-stream; charset=utf-8',
                'Cache-Control': 'no-cache, no-transform',
                'Connection': 'keep-alive',
                'X-Accel-Buffering': 'no'
              }
            });
          } catch (streamErr) {
            console.error('OpenRouter stream error:', streamErr);
            return jsonResponse({ error: streamErr.message }, 502, origin);
          }
        }
      }

      // Static assets (Cloudflare Workers Assets or Pages)
      if (env.ASSETS) {
        return await env.ASSETS.fetch(request);
      }

      return new Response('Not Found', { status: 404 });
    } catch (err) {
      console.error('Unhandled Worker error:', err);
      return jsonResponse({ error: 'Internal Server Error', message: err.message }, 500, origin);
    }
  }
};

// Auto title generator for first message
function generateTitle(prompt) {
  const clean = prompt.replace(/\n/g, ' ').replace(/[#*_`]/g, '').trim();
  const words = clean.split(/\s+/).slice(0, 6).join(' ');
  if (!words) return 'New Chat';
  return words.length > 36 ? words.substring(0, 36) + '...' : words;
}

// Helpers
function getCorsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-OpenRouter-Key',
    'Access-Control-Allow-Credentials': 'true'
  };
}

function jsonResponse(data, status = 200, origin = '*', extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...getCorsHeaders(origin),
      ...extraHeaders
    }
  });
}
