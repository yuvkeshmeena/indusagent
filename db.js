// Indus Agent - Cloudflare D1 Database Layer

export class Database {
  constructor(d1) {
    this.db = d1;
  }

  // --- User Operations ---
  async getUserById(id) {
    return await this.db
      .prepare('SELECT id, email, name, picture, created_at, last_login_at FROM users WHERE id = ?')
      .bind(id)
      .first();
  }

  async upsertUser({ id, email, name, picture }) {
    const now = Date.now();
    await this.db
      .prepare(`
        INSERT INTO users (id, email, name, picture, created_at, last_login_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          email = excluded.email,
          name = excluded.name,
          picture = excluded.picture,
          last_login_at = excluded.last_login_at
      `)
      .bind(id, email, name, picture || null, now, now)
      .run();

    return this.getUserById(id);
  }

  // --- Session Operations ---
  async createSession(userId, daysValid = 30) {
    const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
    const now = Date.now();
    const expiresAt = now + daysValid * 24 * 60 * 60 * 1000;

    await this.db
      .prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .bind(token, userId, now, expiresAt)
      .run();

    return { token, expiresAt };
  }

  async getSessionUser(token) {
    if (!token) return null;
    const now = Date.now();
    const row = await this.db
      .prepare(`
        SELECT u.id, u.email, u.name, u.picture, s.expires_at
        FROM sessions s
        JOIN users u ON s.user_id = u.id
        WHERE s.token = ? AND s.expires_at > ?
      `)
      .bind(token, now)
      .first();

    return row || null;
  }

  async deleteSession(token) {
    if (!token) return;
    await this.db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
  }

  // --- Chat Operations ---
  async listChats(userId) {
    const { results } = await this.db
      .prepare(`
        SELECT id, title, model, created_at, updated_at
        FROM chats
        WHERE user_id = ?
        ORDER BY updated_at DESC
      `)
      .bind(userId)
      .all();

    return results || [];
  }

  async getChat(chatId, userId) {
    return await this.db
      .prepare('SELECT id, user_id, title, model, created_at, updated_at FROM chats WHERE id = ? AND user_id = ?')
      .bind(chatId, userId)
      .first();
  }

  async createChat({ id, userId, title, model }) {
    const chatId = id || crypto.randomUUID();
    const now = Date.now();
    const chatTitle = title || 'New Chat';
    const chatModel = model || 'meta-llama/llama-3.3-70b-instruct';

    await this.db
      .prepare('INSERT INTO chats (id, user_id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(chatId, userId, chatTitle, chatModel, now, now)
      .run();

    return { id: chatId, user_id: userId, title: chatTitle, model: chatModel, created_at: now, updated_at: now };
  }

  async updateChat(chatId, userId, { title, model }) {
    const now = Date.now();
    if (title && model) {
      await this.db
        .prepare('UPDATE chats SET title = ?, model = ?, updated_at = ? WHERE id = ? AND user_id = ?')
        .bind(title, model, now, chatId, userId)
        .run();
    } else if (title) {
      await this.db
        .prepare('UPDATE chats SET title = ?, updated_at = ? WHERE id = ? AND user_id = ?')
        .bind(title, now, chatId, userId)
        .run();
    } else if (model) {
      await this.db
        .prepare('UPDATE chats SET model = ?, updated_at = ? WHERE id = ? AND user_id = ?')
        .bind(model, now, chatId, userId)
        .run();
    }
    return this.getChat(chatId, userId);
  }

  async deleteChat(chatId, userId) {
    // Foreign key with ON DELETE CASCADE automatically removes messages
    await this.db
      .prepare('DELETE FROM chats WHERE id = ? AND user_id = ?')
      .bind(chatId, userId)
      .run();
  }

  async clearUserChats(userId) {
    await this.db.prepare('DELETE FROM chats WHERE user_id = ?').bind(userId).run();
  }

  // --- Message Operations ---
  async listMessages(chatId) {
    const { results } = await this.db
      .prepare('SELECT id, chat_id, role, content, created_at FROM messages WHERE chat_id = ? ORDER BY created_at ASC')
      .bind(chatId)
      .all();

    return results || [];
  }

  async createMessage({ id, chatId, role, content }) {
    const messageId = id || crypto.randomUUID();
    const now = Date.now();

    await this.db
      .prepare('INSERT INTO messages (id, chat_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(messageId, chatId, role, content, now)
      .run();

    // Update parent chat's updated_at
    await this.db
      .prepare('UPDATE chats SET updated_at = ? WHERE id = ?')
      .bind(now, chatId)
      .run();

    return { id: messageId, chat_id: chatId, role, content, created_at: now };
  }
}
