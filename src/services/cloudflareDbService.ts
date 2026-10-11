/**
 * Cloudflare D1 Database Service
 * 
 * Replaces Firebase Firestore for data persistence in Cloudflare Workers.
 * Provides type-safe database operations for lists, summaries, and activity history.
 */

import type { D1Database } from '@cloudflare/workers-types';

// Types
export interface SavedList {
  id: string;
  owner_id: string;
  name: string;
  description: string;
  category: 'general' | 'videos' | 'reading' | 'study' | 'favorites';
  created_at: string;
  updated_at: string;
}

export interface ListItem {
  id: string;
  list_id: string;
  owner_id: string;
  item_type: 'video' | 'summary' | 'book' | 'article' | 'note';
  title: string;
  url: string;
  subtitle: string;
  content: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface SavedSummary {
  id: string;
  owner_id: string;
  video_id: string;
  video_url: string;
  video_title: string;
  author_name: string;
  summary_type: string;
  markdown: string;
  created_at: string;
  updated_at: string;
}

export interface ActivityItem {
  id: string;
  owner_id: string;
  action_type: 'video' | 'summary' | 'word_lookup' | 'research_search' | 'transcript_search' | 'ai_question' | 'artifact_saved' | 'audio_narration';
  query_or_title: string;
  detail: string;
  url: string;
  video_id: string;
  date_key: string;
  created_at: string;
  updated_at: string;
}

export class CloudflareDbService {
  constructor(private db: D1Database) {}

  // List operations
  async getLists(ownerId: string): Promise<SavedList[]> {
    const result = await this.db
      .prepare('SELECT * FROM saved_lists WHERE owner_id = ? ORDER BY updated_at DESC')
      .bind(ownerId)
      .all<SavedList>();
    return result.results;
  }

  async getList(listId: string, ownerId: string): Promise<SavedList | null> {
    const result = await this.db
      .prepare('SELECT * FROM saved_lists WHERE id = ? AND owner_id = ?')
      .bind(listId, ownerId)
      .first<SavedList>();
    return result;
  }

  async createList(
    ownerId: string,
    name: string,
    description: string,
    category: SavedList['category'] = 'general'
  ): Promise<string> {
    const id = `list_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    
    await this.db
      .prepare(`
        INSERT INTO saved_lists (id, owner_id, name, description, category, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `)
      .bind(id, ownerId, name, description, category)
      .run();

    return id;
  }

  async updateList(
    listId: string,
    ownerId: string,
    updates: Partial<Pick<SavedList, 'name' | 'description' | 'category'>>
  ): Promise<boolean> {
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.description !== undefined) {
      fields.push('description = ?');
      values.push(updates.description);
    }
    if (updates.category !== undefined) {
      fields.push('category = ?');
      values.push(updates.category);
    }

    if (fields.length === 0) return false;

    fields.push("updated_at = datetime('now')");
    values.push(listId, ownerId);

    await this.db
      .prepare(`UPDATE saved_lists SET ${fields.join(', ')} WHERE id = ? AND owner_id = ?`)
      .bind(...values)
      .run();

    return true;
  }

  async deleteList(listId: string, ownerId: string): Promise<boolean> {
    // Delete list items first (cascade handled by foreign keys)
    await this.db
      .prepare('DELETE FROM list_items WHERE list_id = ? AND owner_id = ?')
      .bind(listId, ownerId)
      .run();

    // Delete the list
    const result = await this.db
      .prepare('DELETE FROM saved_lists WHERE id = ? AND owner_id = ?')
      .bind(listId, ownerId)
      .run();

    return result.success;
  }

  // List item operations
  async getListItems(listId: string, ownerId: string): Promise<ListItem[]> {
    const result = await this.db
      .prepare('SELECT * FROM list_items WHERE list_id = ? AND owner_id = ? ORDER BY created_at DESC')
      .bind(listId, ownerId)
      .all<ListItem>();
    return result.results;
  }

  async addListItem(
    listId: string,
    ownerId: string,
    item: {
      item_type: ListItem['item_type'];
      title: string;
      url?: string;
      subtitle?: string;
      content?: string;
      notes?: string;
    }
  ): Promise<string> {
    const id = `item_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    await this.db
      .prepare(`
        INSERT INTO list_items (id, list_id, owner_id, item_type, title, url, subtitle, content, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `)
      .bind(
        id,
        listId,
        ownerId,
        item.item_type,
        item.title,
        item.url || '',
        item.subtitle || '',
        item.content || '',
        item.notes || ''
      )
      .run();

    return id;
  }

  async updateListItem(
    itemId: string,
    ownerId: string,
    updates: Partial<Pick<ListItem, 'notes' | 'title'>>
  ): Promise<boolean> {
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.title !== undefined) {
      fields.push('title = ?');
      values.push(updates.title);
    }
    if (updates.notes !== undefined) {
      fields.push('notes = ?');
      values.push(updates.notes);
    }

    if (fields.length === 0) return false;

    fields.push("updated_at = datetime('now')");
    values.push(itemId, ownerId);

    await this.db
      .prepare(`UPDATE list_items SET ${fields.join(', ')} WHERE id = ? AND owner_id = ?`)
      .bind(...values)
      .run();

    return true;
  }

  async deleteListItem(itemId: string, ownerId: string): Promise<boolean> {
    const result = await this.db
      .prepare('DELETE FROM list_items WHERE id = ? AND owner_id = ?')
      .bind(itemId, ownerId)
      .run();

    return result.success;
  }

  // Summary operations
  async getSummaries(ownerId: string, limit = 50): Promise<SavedSummary[]> {
    const result = await this.db
      .prepare('SELECT * FROM saved_summaries WHERE owner_id = ? ORDER BY updated_at DESC LIMIT ?')
      .bind(ownerId, limit)
      .all<SavedSummary>();
    return result.results;
  }

  async getSummaryByVideoId(videoId: string, ownerId: string): Promise<SavedSummary | null> {
    const result = await this.db
      .prepare('SELECT * FROM saved_summaries WHERE video_id = ? AND owner_id = ?')
      .bind(videoId, ownerId)
      .first<SavedSummary>();
    return result;
  }

  async saveSummary(
    ownerId: string,
    summary: {
      video_id: string;
      video_url: string;
      video_title: string;
      author_name?: string;
      summary_type?: string;
      markdown: string;
    }
  ): Promise<string> {
    const id = `summary_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    await this.db
      .prepare(`
        INSERT INTO saved_summaries (id, owner_id, video_id, video_url, video_title, author_name, summary_type, markdown, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `)
      .bind(
        id,
        ownerId,
        summary.video_id,
        summary.video_url,
        summary.video_title,
        summary.author_name || 'YouTube',
        summary.summary_type || 'massive',
        summary.markdown
      )
      .run();

    return id;
  }

  async deleteSummary(summaryId: string, ownerId: string): Promise<boolean> {
    const result = await this.db
      .prepare('DELETE FROM saved_summaries WHERE id = ? AND owner_id = ?')
      .bind(summaryId, ownerId)
      .run();

    return result.success;
  }

  // Activity history operations
  async getActivityHistory(ownerId: string, limit = 100): Promise<ActivityItem[]> {
    const result = await this.db
      .prepare('SELECT * FROM activity_history WHERE owner_id = ? ORDER BY created_at DESC LIMIT ?')
      .bind(ownerId, limit)
      .all<ActivityItem>();
    return result.results;
  }

  async logActivity(
    ownerId: string,
    activity: {
      action_type: ActivityItem['action_type'];
      query_or_title: string;
      detail?: string;
      url?: string;
      video_id?: string;
      date_key?: string;
    }
  ): Promise<string> {
    const id = `activity_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const dateKey = activity.date_key || new Date().toISOString().split('T')[0];

    await this.db
      .prepare(`
        INSERT INTO activity_history (id, owner_id, action_type, query_or_title, detail, url, video_id, date_key, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `)
      .bind(
        id,
        ownerId,
        activity.action_type,
        activity.query_or_title,
        activity.detail || '',
        activity.url || '',
        activity.video_id || '',
        dateKey
      )
      .run();

    return id;
  }

  async deleteActivity(activityId: string, ownerId: string): Promise<boolean> {
    const result = await this.db
      .prepare('DELETE FROM activity_history WHERE id = ? AND owner_id = ?')
      .bind(activityId, ownerId)
      .run();

    return result.success;
  }

  // User operations (for session management)
  async createUser(user: { id: string; email?: string; display_name?: string; photo_url?: string }): Promise<void> {
    await this.db
      .prepare(`
        INSERT OR IGNORE INTO users (id, email, display_name, photo_url, created_at, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
      `)
      .bind(user.id, user.email || '', user.display_name || '', user.photo_url || '')
      .run();
  }

  async getUser(userId: string): Promise<{ id: string; email: string; display_name: string; photo_url: string } | null> {
    return await this.db
      .prepare('SELECT * FROM users WHERE id = ?')
      .bind(userId)
      .first();
  }
}

// Export a factory function
export function createDbService(db: D1Database): CloudflareDbService {
  return new CloudflareDbService(db);
}
