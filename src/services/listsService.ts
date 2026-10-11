import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  getDocs,
  getDoc,
  writeBatch,
  limit,
} from 'firebase/firestore';
import { db, auth, handleFirestoreError, logFirestoreError, OperationType } from '../firebase';
import { ExactVideoResource } from '../types';

export type ListCategory = 'general' | 'videos' | 'reading' | 'study' | 'favorites';
export type ListItemType = 'video' | 'summary' | 'book' | 'article' | 'note';
export type ActivityActionType =
  | 'video'
  | 'summary'
  | 'word_lookup'
  | 'research_search'
  | 'transcript_search'
  | 'ai_question'
  | 'artifact_saved'
  | 'audio_narration';

export interface ActivityHistoryItem {
  id: string;
  ownerId: string;
  actionType: ActivityActionType;
  queryOrTitle: string;
  detail: string;
  url: string;
  videoId: string;
  dateKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface SavedUserList {
  id: string;
  ownerId: string;
  name: string;
  description: string;
  category: ListCategory;
  createdAt: string;
  updatedAt: string;
}

export type UserList = SavedUserList;

export interface SavedListItem {
  id: string;
  listId: string;
  ownerId: string;
  itemType: ListItemType;
  title: string;
  url: string;
  subtitle: string;
  content: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface SavedCloudSummary {
  id: string;
  ownerId: string;
  videoId: string;
  videoUrl: string;
  videoTitle: string;
  authorName: string;
  summaryType: string;
  markdown: string;
  createdAt: string;
  updatedAt: string;
}

// Validation & Truncation Constants synced strictly with firebase-blueprint.json
const MAX_ID_LEN = 128;
const ID_REGEX = /^[a-zA-Z0-9_\-]+$/;
const MAX_LIST_NAME_LEN = 100;
const MAX_LIST_DESC_LEN = 500;
const MAX_ITEM_TITLE_LEN = 300;
const MAX_ITEM_URL_LEN = 1000;
const MAX_ITEM_SUBTITLE_LEN = 300;
const MAX_ITEM_CONTENT_LEN = 500000;
const MAX_ITEM_NOTES_LEN = 5000;
const MAX_VIDEO_ID_LEN = 64;
const MAX_AUTHOR_LEN = 200;
const MAX_SUMMARY_TYPE_LEN = 64;
const MAX_RESOURCE_TYPE_LEN = 64;
const MAX_RESOURCE_DESC_LEN = 2000;
const MAX_RESOURCE_QUOTE_LEN = 2000;
const MAX_FORMATTED_TIME_LEN = 32;

const ALLOWED_CATEGORIES: ListCategory[] = ['general', 'videos', 'reading', 'study', 'favorites'];
const ALLOWED_ITEM_TYPES: ListItemType[] = ['video', 'summary', 'book', 'article', 'note'];
const ALLOWED_ACTIVITY_TYPES: ActivityActionType[] = [
  'video',
  'summary',
  'word_lookup',
  'research_search',
  'transcript_search',
  'ai_question',
  'artifact_saved',
  'audio_narration',
];

export function formatDateKey(dateInput?: Date | string): string {
  const d = dateInput ? new Date(dateInput) : new Date();
  if (isNaN(d.getTime())) {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function formatDateKeyReadable(dateKey: string): string {
  const todayKey = formatDateKey();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = formatDateKey(yesterday);

  const parts = dateKey.split('-').map(Number);
  if (parts.length === 3 && !parts.some(isNaN)) {
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    const formatted = d.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    if (dateKey === todayKey) return `Today — ${formatted}`;
    if (dateKey === yesterdayKey) return `Yesterday — ${formatted}`;
    return formatted;
  }
  return dateKey;
}

function generateSafeId(prefix: string): string {
  const raw = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const cleaned = raw.replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, MAX_ID_LEN);
  return ID_REGEX.test(cleaned) ? cleaned : `id_${Date.now()}`;
}

function computeStableHash(input: string): string {
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return ((h2 >>> 0).toString(36) + (h1 >>> 0).toString(36)).slice(0, 16);
}

export function isContentTruncatedForStorage(content?: string): boolean {
  return Boolean(content && content.length > MAX_ITEM_CONTENT_LEN);
}

export function getDefaultCloudListId(userId: string): string {
  const cleanUid = userId.replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 64) || 'user';
  return `list_fav_${cleanUid}`;
}

function sanitizeListPayload(
  ownerId: string,
  name: string,
  description: string,
  category: ListCategory
) {
  const safeName = (name || 'Untitled List').trim().slice(0, MAX_LIST_NAME_LEN) || 'Untitled List';
  const safeDesc = (description || '').trim().slice(0, MAX_LIST_DESC_LEN);
  const safeCategory: ListCategory = ALLOWED_CATEGORIES.includes(category) ? category : 'general';
  return {
    ownerId: ownerId.slice(0, MAX_ID_LEN),
    name: safeName,
    description: safeDesc,
    category: safeCategory,
  };
}

function sanitizeListItemPayload(
  listId: string,
  ownerId: string,
  input: {
    itemType: ListItemType;
    title: string;
    url?: string;
    subtitle?: string;
    content?: string;
    notes?: string;
  }
) {
  const safeType: ListItemType = ALLOWED_ITEM_TYPES.includes(input.itemType) ? input.itemType : 'note';
  const safeTitle = (input.title || 'Saved Item').trim().slice(0, MAX_ITEM_TITLE_LEN) || 'Saved Item';
  const safeUrl = (input.url || '').trim().slice(0, MAX_ITEM_URL_LEN);
  const safeSubtitle = (input.subtitle || '').trim().slice(0, MAX_ITEM_SUBTITLE_LEN);
  const safeContent = (input.content || '').slice(0, MAX_ITEM_CONTENT_LEN);
  const safeNotes = (input.notes || '').slice(0, MAX_ITEM_NOTES_LEN);
  return {
    listId: listId.slice(0, MAX_ID_LEN),
    ownerId: ownerId.slice(0, MAX_ID_LEN),
    itemType: safeType,
    title: safeTitle,
    url: safeUrl,
    subtitle: safeSubtitle,
    content: safeContent,
    notes: safeNotes,
  };
}

function sanitizeSavedSummaryPayload(
  ownerId: string,
  input: {
    videoId?: string;
    videoUrl?: string;
    videoTitle: string;
    authorName?: string;
    summaryType?: string;
    markdown: string;
  }
) {
  return {
    ownerId: ownerId.slice(0, MAX_ID_LEN),
    videoId: (input.videoId || '').trim().slice(0, MAX_VIDEO_ID_LEN),
    videoUrl: (input.videoUrl || '').trim().slice(0, MAX_ITEM_URL_LEN),
    videoTitle: (input.videoTitle || 'YouTube Video Summary').trim().slice(0, MAX_ITEM_TITLE_LEN) || 'YouTube Video Summary',
    authorName: (input.authorName || 'YouTube').trim().slice(0, MAX_AUTHOR_LEN),
    summaryType: (input.summaryType || 'massive').trim().slice(0, MAX_SUMMARY_TYPE_LEN) || 'massive',
    markdown: (input.markdown || 'Summary').slice(0, MAX_ITEM_CONTENT_LEN) || 'Summary',
  };
}

function sanitizeCustomResourcePayload(
  ownerId: string,
  input: {
    videoId?: string;
    title: string;
    type?: ExactVideoResource['type'] | string;
    description?: string;
    primaryUrl: string;
    authorOrCreator?: string;
    formattedTime?: string;
    exactQuote?: string;
  }
) {
  const safeTitle = (input.title || 'Exact Resource').trim().slice(0, MAX_ITEM_TITLE_LEN) || 'Exact Resource';
  const rawUrl = (input.primaryUrl || '').trim();
  const isSafeScheme = /^https?:\/\//i.test(rawUrl);
  const safeUrl = (isSafeScheme ? rawUrl : `https://scholar.google.com/scholar?q=${encodeURIComponent(safeTitle)}`).slice(0, MAX_ITEM_URL_LEN);

  return {
    ownerId: ownerId.slice(0, MAX_ID_LEN),
    videoId: (input.videoId || '').trim().slice(0, MAX_VIDEO_ID_LEN),
    title: safeTitle,
    resourceType: (input.type || 'Custom Resource').trim().slice(0, MAX_RESOURCE_TYPE_LEN) || 'Custom Resource',
    description: (input.description || '').trim().slice(0, MAX_RESOURCE_DESC_LEN),
    primaryUrl: safeUrl,
    authorOrCreator: (input.authorOrCreator || '').trim().slice(0, MAX_AUTHOR_LEN),
    formattedTime: (input.formattedTime || '').trim().slice(0, MAX_FORMATTED_TIME_LEN),
    exactQuote: (input.exactQuote || '').trim().slice(0, MAX_RESOURCE_QUOTE_LEN),
  };
}

const LOCAL_LISTS_KEY = 'opentranscript_saved_lists_v1';
const LOCAL_ITEMS_KEY = 'opentranscript_saved_list_items_v1';
const LOCAL_SUMMARIES_KEY = 'opentranscript_saved_summaries_v1';
const LOCAL_RESOURCES_KEY = 'opentranscript_custom_exact_resources_v1';
const LOCAL_HISTORY_KEY = 'opentranscript_activity_history_v1';
const LAST_SYNCED_USER_KEY = 'opentranscript_last_synced_uid_v1';
const DEVICE_INSTALL_KEY = 'opentranscript_device_install_id_v1';

export function getDeviceInstallationId(): string {
  if (typeof window === 'undefined') return 'server_install';
  try {
    let id = localStorage.getItem(DEVICE_INSTALL_KEY);
    if (!id) {
      id = `dev_${computeStableHash(`${navigator.userAgent}:${Date.now()}:${Math.random()}`)}`;
      localStorage.setItem(DEVICE_INSTALL_KEY, id);
    }
    return id;
  } catch {
    return 'ephemeral_device';
  }
}

const historyListeners = new Set<(items: ActivityHistoryItem[]) => void>();
let lastRecordedSignature = '';
let lastRecordedTimestamp = 0;

function sanitizeActivityHistoryPayload(
  ownerId: string,
  input: {
    actionType: ActivityActionType;
    queryOrTitle: string;
    detail?: string;
    url?: string;
    videoId?: string;
    dateKey?: string;
  }
) {
  const safeAction: ActivityActionType = ALLOWED_ACTIVITY_TYPES.includes(input.actionType)
    ? input.actionType
    : 'research_search';
  const safeQuery = (input.queryOrTitle || 'Activity').trim().slice(0, MAX_ITEM_TITLE_LEN) || 'Activity';
  const safeDetail = (input.detail || '').trim().slice(0, MAX_RESOURCE_DESC_LEN);
  const safeUrl = (input.url || '').trim().slice(0, MAX_ITEM_URL_LEN);
  const safeVideoId = (input.videoId || '').trim().slice(0, MAX_VIDEO_ID_LEN);
  const rawDate = (input.dateKey || '').trim();
  const safeDateKey = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(rawDate) ? rawDate : formatDateKey();

  return {
    ownerId: ownerId.slice(0, MAX_ID_LEN),
    actionType: safeAction,
    queryOrTitle: safeQuery,
    detail: safeDetail,
    url: safeUrl,
    videoId: safeVideoId,
    dateKey: safeDateKey,
  };
}

export function loadLocalActivityHistory(): ActivityHistoryItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LOCAL_HISTORY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (err) {
    console.warn('Could not read local activity history:', err);
  }
  const todayKey = formatDateKey();
  const nowIso = new Date().toISOString();
  const initialHistory: ActivityHistoryItem[] = [
    {
      id: 'hist_initial_stanford_2005',
      ownerId: 'local_user',
      actionType: 'video',
      queryOrTitle: "Steve Jobs' 2005 Stanford Commencement Address",
      detail: 'Stanford University · Connecting the Dots, Love & Loss, Stay Hungry Stay Foolish',
      url: 'https://www.youtube.com/watch?v=UF8uR6Z6KLc',
      videoId: 'UF8uR6Z6KLc',
      dateKey: todayKey,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
  ];
  return initialHistory;
}

export function saveLocalActivityHistory(items: ActivityHistoryItem[]) {
  if (typeof window === 'undefined') return;
  try {
    const bounded = items.slice(0, 400);
    localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(bounded));
    historyListeners.forEach((cb) => cb(bounded));
  } catch (err) {
    console.warn('Local storage quota exceeded while saving activity history:', err);
  }
}

export function subscribeToLocalActivityHistory(
  onUpdate: (items: ActivityHistoryItem[]) => void
): () => void {
  historyListeners.add(onUpdate);
  return () => {
    historyListeners.delete(onUpdate);
  };
}

export function loadLocalLists(): SavedUserList[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LOCAL_LISTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (err) {
    console.warn('Could not read local lists from storage:', err);
  }
  const defaultList: SavedUserList = {
    id: 'list_default_favorites',
    ownerId: 'local_user',
    name: 'My Favorite Video Summaries',
    description: 'Saved videos, summaries, books, and key takeaways.',
    category: 'favorites',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  };
  return [defaultList];
}

export function saveLocalLists(lists: SavedUserList[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LOCAL_LISTS_KEY, JSON.stringify(lists));
  } catch (err) {
    console.warn('Local storage quota exceeded while saving lists:', err);
  }
}

export function loadLocalListItems(): SavedListItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LOCAL_ITEMS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (err) {
    console.warn('Could not read local list items from storage:', err);
  }
  return [];
}

export function saveLocalListItems(items: SavedListItem[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LOCAL_ITEMS_KEY, JSON.stringify(items));
  } catch (err) {
    console.warn('Local storage quota exceeded while saving list items:', err);
  }
}

export function loadLocalSummaries(): SavedCloudSummary[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LOCAL_SUMMARIES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (err) {
    console.warn('Could not read local summaries from storage:', err);
  }
  return [];
}

export function saveLocalSummaries(summaries: SavedCloudSummary[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LOCAL_SUMMARIES_KEY, JSON.stringify(summaries));
  } catch (err) {
    console.warn('Local storage quota exceeded while saving summaries:', err);
  }
}

export function loadLocalCustomResources(): ExactVideoResource[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LOCAL_RESOURCES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (err) {
    console.warn('Could not read local custom resources from storage:', err);
  }
  return [];
}

export function saveLocalCustomResources(resources: ExactVideoResource[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LOCAL_RESOURCES_KEY, JSON.stringify(resources));
  } catch (err) {
    console.warn('Local storage quota exceeded while saving custom resources:', err);
  }
}

function formatFirestoreTimestamp(val: any): string {
  if (!val) return new Date().toISOString();
  if (typeof val === 'string') return val;
  if (typeof val.toDate === 'function') {
    try {
      return val.toDate().toISOString();
    } catch {
      return new Date().toISOString();
    }
  }
  return new Date().toISOString();
}

function parseTimeSeconds(formattedTime?: string): number | undefined {
  if (!formattedTime) return undefined;
  const parts = formattedTime.replace(/[\[\]]/g, '').split(':').map(Number);
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return undefined;
}

// Listener hub to broadcast D1 data changes across UI panels (F-08)
const changeListeners = new Set<() => void>();

export function registerChangeListener(fn: () => void): () => void {
  changeListeners.add(fn);
  return () => {
    changeListeners.delete(fn);
  };
}

export function notifyDataChange(): void {
  changeListeners.forEach((fn) => {
    try {
      fn();
    } catch {}
  });
}

/**
 * Ensure a parent list exists in D1 for the signed-in user before adding subcollection items (F-08)
 */
export async function ensureCloudListExists(
  requestedListId?: string,
  fallbackName = 'My Favorite Video Summaries'
): Promise<string> {
  const user = auth.currentUser;
  if (!user) return requestedListId || 'list_default_favorites';

  const targetListId =
    !requestedListId || requestedListId === 'list_default_favorites' || !ID_REGEX.test(requestedListId)
      ? getDefaultCloudListId(user.uid)
      : requestedListId.slice(0, MAX_ID_LEN);

  try {
    const headers = await getAuthHeaders();
    if (headers['Authorization']) {
      const res = await fetch('/api/lists', { headers });
      if (res.ok) {
        const data = (await res.json()) as any;
        const exists = Array.isArray(data.lists) && data.lists.some((l: any) => l.id === targetListId);
        if (!exists) {
          await fetch('/api/lists', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify({
              name: fallbackName,
              description: 'Videos, summaries, books, and exact citations synced with Cloudflare D1.',
              category: 'favorites',
            }),
          });
          notifyDataChange();
        }
      }
    }
  } catch (err) {
    console.warn('ensureCloudListExists D1 error:', err);
  }

  return targetListId;
}

/**
 * Subscribe to the signed-in user's lists via D1 Worker API (`/api/lists`) (F-08)
 */
export function subscribeToUserLists(
  userId: string,
  onUpdate: (lists: SavedUserList[]) => void,
  onError?: (errMessage: string) => void
): () => void {
  let active = true;

  const fetchLists = async () => {
    try {
      const headers = await getAuthHeaders();
      if (headers['Authorization']) {
        const res = await fetch('/api/lists', { headers });
        if (res.ok) {
          const data = (await res.json()) as any;
          if (active && Array.isArray(data.lists)) {
            const mapped: SavedUserList[] = data.lists.map((d: any) => ({
              id: d.id,
              ownerId: d.owner_id || d.ownerId || userId,
              name: d.name,
              description: d.description || '',
              category: d.category || 'general',
              createdAt: d.created_at || d.createdAt || new Date().toISOString(),
              updatedAt: d.updated_at || d.updatedAt || new Date().toISOString(),
            }));
            onUpdate(mapped);
            saveLocalLists(mapped);
            return;
          }
        }
      }
    } catch (e: any) {
      if (active && onError) onError(e.message);
    }
    if (active) {
      onUpdate(loadLocalLists());
    }
  };

  fetchLists();
  const unsubListener = registerChangeListener(fetchLists);

  return () => {
    active = false;
    unsubListener();
  };
}

/**
 * Subscribe to items in a specific list via D1 Worker API (`/api/lists/{listId}/items`) (F-08)
 */
export function subscribeToListItems(
  listId: string,
  userId: string,
  onUpdate: (items: SavedListItem[]) => void,
  onError?: (errMessage: string) => void
): () => void {
  if (!listId || !userId || listId === 'list_default_favorites') {
    onUpdate([]);
    return () => {};
  }
  let active = true;

  const fetchItems = async () => {
    try {
      const headers = await getAuthHeaders();
      if (headers['Authorization']) {
        const res = await fetch(`/api/lists/${encodeURIComponent(listId)}/items`, { headers });
        if (res.ok) {
          const data = (await res.json()) as any;
          if (active && Array.isArray(data.items)) {
            const mapped: SavedListItem[] = data.items.map((d: any) => ({
              id: d.id,
              listId: d.list_id || d.listId || listId,
              ownerId: d.owner_id || d.ownerId || userId,
              itemType: d.item_type || d.itemType || 'note',
              title: d.title || 'Saved Item',
              url: d.url || '',
              subtitle: d.subtitle || '',
              content: d.content || '',
              notes: d.notes || '',
              createdAt: d.created_at || d.createdAt || new Date().toISOString(),
              updatedAt: d.updated_at || d.updatedAt || new Date().toISOString(),
            }));
            onUpdate(mapped);
            return;
          }
        }
      }
    } catch (e: any) {
      if (active && onError) onError(e.message);
    }
    if (active) {
      onUpdate(loadLocalListItems().filter((it) => it.listId === listId));
    }
  };

  fetchItems();
  const unsubListener = registerChangeListener(fetchItems);

  return () => {
    active = false;
    unsubListener();
  };
}

/**
 * Subscribe to the signed-in user's saved summaries via D1 Worker API (`/api/summaries`) (F-08)
 */
export function subscribeToSavedSummaries(
  userId: string,
  onUpdate: (summaries: SavedCloudSummary[]) => void,
  onError?: (errMessage: string) => void
): () => void {
  let active = true;

  const fetchSummaries = async () => {
    try {
      const headers = await getAuthHeaders();
      if (headers['Authorization']) {
        const res = await fetch('/api/summaries', { headers });
        if (res.ok) {
          const data = (await res.json()) as any;
          if (active && Array.isArray(data.summaries)) {
            const mapped: SavedCloudSummary[] = data.summaries.map((d: any) => ({
              id: d.id,
              ownerId: d.owner_id || d.ownerId || userId,
              videoId: d.video_id || d.videoId || '',
              videoUrl: d.video_url || d.videoUrl || '',
              videoTitle: d.video_title || d.videoTitle || 'YouTube Video Summary',
              authorName: d.author_name || d.authorName || 'YouTube',
              summaryType: d.summary_type || d.summaryType || 'massive',
              markdown: d.markdown || '',
              createdAt: d.created_at || d.createdAt || new Date().toISOString(),
              updatedAt: d.updated_at || d.updatedAt || new Date().toISOString(),
            }));
            onUpdate(mapped);
            saveLocalSummaries(mapped);
            return;
          }
        }
      }
    } catch (e: any) {
      if (active && onError) onError(e.message);
    }
    if (active) {
      onUpdate(loadLocalSummaries());
    }
  };

  fetchSummaries();
  const unsubListener = registerChangeListener(fetchSummaries);

  return () => {
    active = false;
    unsubListener();
  };
}

/**
 * Subscribe to the signed-in user's custom exact resources (F-08)
 */
export function subscribeToCustomResources(
  userId: string,
  onUpdate: (resources: ExactVideoResource[]) => void,
  _onError?: (errMessage: string) => void
): () => void {
  onUpdate(loadLocalCustomResources());
  const unsubListener = registerChangeListener(() => {
    onUpdate(loadLocalCustomResources());
  });
  return unsubListener;
}

/**
 * Create a new list in Cloudflare D1 (if signed in) or localStorage (F-08)
 */
export async function createUserList(
  name: string,
  description: string,
  category: ListCategory,
  customId?: string
): Promise<SavedUserList> {
  const user = auth.currentUser;
  const listId =
    customId && ID_REGEX.test(customId)
      ? customId.slice(0, MAX_ID_LEN)
      : generateSafeId('list');
  const sanitized = sanitizeListPayload(user ? user.uid : 'local_user', name, description, category);

  if (user) {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          name: sanitized.name,
          description: sanitized.description,
          category: sanitized.category,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as any;
        const created: SavedUserList = {
          id: data.id || listId,
          ...sanitized,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        const current = loadLocalLists().filter((l) => l.id !== created.id);
        saveLocalLists([created, ...current]);
        notifyDataChange();
        return created;
      }
    } catch (err) {
      console.warn('D1 createUserList error:', err);
    }
  }

  const newList: SavedUserList = {
    id: listId,
    ...sanitized,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const current = loadLocalLists();
  saveLocalLists([newList, ...current]);
  notifyDataChange();
  return newList;
}

/**
 * Update an existing list's name, description, or category
 */
export async function updateUserList(
  listId: string,
  name: string,
  description: string,
  category: ListCategory
): Promise<void> {
  const user = auth.currentUser;
  const safeName = name.trim().slice(0, MAX_LIST_NAME_LEN);
  const safeDesc = description.trim().slice(0, MAX_LIST_DESC_LEN);

  if (user) {
    try {
      const headers = await getAuthHeaders();
      await fetch(`/api/lists/${encodeURIComponent(listId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          name: safeName,
          description: safeDesc,
          category,
        }),
      });
    } catch (err) {
      console.warn('D1 updateUserList error:', err);
    }
  }

  const current = loadLocalLists();
  const updated = current.map((l) =>
    l.id === listId
      ? {
          ...l,
          name: safeName || l.name,
          description: safeDesc,
          category,
          updatedAt: new Date().toISOString(),
        }
      : l
  );
  saveLocalLists(updated);
  notifyDataChange();
}

/**
 * Delete a user list and its items in Cloudflare D1 (F-08)
 */
export async function deleteUserList(listId: string): Promise<void> {
  const user = auth.currentUser;
  if (user) {
    try {
      const headers = await getAuthHeaders();
      await fetch(`/api/lists/${encodeURIComponent(listId)}`, {
        method: 'DELETE',
        headers,
      });
    } catch (err) {
      console.warn('D1 deleteUserList error:', err);
    }
  }

  const lists = loadLocalLists().filter((l) => l.id !== listId);
  saveLocalLists(lists);
  const items = loadLocalListItems().filter((i) => i.listId !== listId);
  saveLocalListItems(items);
  notifyDataChange();
}

/**
 * Add an item to a specific list in Cloudflare D1 (F-08)
 */
export async function addItemToUserList(
  listId: string,
  input: {
    itemType: ListItemType;
    title: string;
    url?: string;
    subtitle?: string;
    content?: string;
    notes?: string;
  }
): Promise<SavedListItem> {
  const user = auth.currentUser;
  const itemId = generateSafeId('item');

  if (user) {
    const targetListId = await ensureCloudListExists(listId);
    const sanitized = sanitizeListItemPayload(targetListId, user.uid, input);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/lists/${encodeURIComponent(targetListId)}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(sanitized),
      });
      if (res.ok) {
        const data = (await res.json()) as any;
        const created: SavedListItem = {
          id: data.id || itemId,
          ...sanitized,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        const current = loadLocalListItems();
        saveLocalListItems([created, ...current]);
        notifyDataChange();
        return created;
      }
    } catch (err) {
      console.warn('D1 addItemToUserList error:', err);
    }
  }

  const sanitized = sanitizeListItemPayload(listId || 'list_default_favorites', 'local_user', input);
  const newItem: SavedListItem = {
    id: itemId,
    ...sanitized,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const current = loadLocalListItems();
  saveLocalListItems([newItem, ...current]);
  notifyDataChange();
  return newItem;
}

/**
 * Update personal notes or title on a saved item
 */
export async function updateListItemNotes(
  listId: string,
  itemId: string,
  notes: string,
  title?: string
): Promise<void> {
  const user = auth.currentUser;
  const safeNotes = (notes || '').slice(0, MAX_ITEM_NOTES_LEN);
  const safeTitle = title !== undefined ? title.trim().slice(0, MAX_ITEM_TITLE_LEN) : undefined;

  if (user) {
    try {
      const headers = await getAuthHeaders();
      await fetch(
        `/api/lists/${encodeURIComponent(listId)}/items/${encodeURIComponent(itemId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify({
            notes: safeNotes,
            title: safeTitle,
          }),
        }
      );
    } catch (err) {
      console.warn('D1 updateListItemNotes error:', err);
    }
  }

  const items = loadLocalListItems().map((it) =>
    it.id === itemId && it.listId === listId
      ? {
          ...it,
          notes: safeNotes,
          title: safeTitle !== undefined ? safeTitle || it.title : it.title,
          updatedAt: new Date().toISOString(),
        }
      : it
  );
  saveLocalListItems(items);
  notifyDataChange();
}

/**
 * Delete a saved item from a list in Cloudflare D1 (F-08)
 */
export async function deleteItemFromUserList(listId: string, itemId: string): Promise<void> {
  const user = auth.currentUser;
  if (user) {
    try {
      const headers = await getAuthHeaders();
      await fetch(`/api/lists/${encodeURIComponent(listId)}/items/${encodeURIComponent(itemId)}`, {
        method: 'DELETE',
        headers,
      });
    } catch (err) {
      console.warn('D1 deleteItemFromUserList error:', err);
    }
  }

  const items = loadLocalListItems().filter((i) => !(i.id === itemId && i.listId === listId));
  saveLocalListItems(items);
  notifyDataChange();
}

/**
 * Save or update a Video Summary in Cloudflare D1 (`/api/summaries`) (F-08)
 */
export async function saveSummaryToFirestore(input: {
  videoId?: string;
  videoUrl?: string;
  videoTitle: string;
  authorName?: string;
  summaryType?: string;
  markdown: string;
}): Promise<SavedCloudSummary> {
  const user = auth.currentUser;
  const rawVideoId = (input.videoId || '').trim().replace(/[^a-zA-Z0-9_\-]/g, '');
  const uniqueKey =
    rawVideoId.length >= 6
      ? rawVideoId.slice(0, 36)
      : `doc_${computeStableHash(`${input.videoTitle || ''}:${input.videoUrl || ''}:${(input.markdown || '').slice(0, 250)}`)}`;

  const summaryId = `sum_${uniqueKey}`;
  const sanitized = sanitizeSavedSummaryPayload(user ? user.uid : 'local_user', input);

  if (user) {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/summaries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(sanitized),
      });
      if (res.ok) {
        const data = (await res.json()) as any;
        const created: SavedCloudSummary = {
          id: data.id || summaryId,
          ...sanitized,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        const current = loadLocalSummaries().filter((s) => s.videoId !== input.videoId);
        saveLocalSummaries([created, ...current]);
        notifyDataChange();
        return created;
      }
    } catch (err) {
      console.warn('D1 saveSummary error:', err);
    }
  }

  const localSummary: SavedCloudSummary = {
    id: summaryId,
    ...sanitized,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const current = loadLocalSummaries().filter((s) => s.videoId !== input.videoId);
  saveLocalSummaries([localSummary, ...current]);
  notifyDataChange();
  return localSummary;
}

/**
 * Create a custom Exact Video Resource in Firestore (`/resources/{resourceId}`) or localStorage
 */
export async function createCustomExactResource(input: {
  videoId?: string;
  title: string;
  type: ExactVideoResource['type'];
  description: string;
  primaryUrl: string;
  authorOrCreator?: string;
  formattedTime?: string;
  exactQuote?: string;
}): Promise<ExactVideoResource> {
  const user = auth.currentUser;
  const resourceId = generateSafeId('res');
  const ownerId = user ? user.uid : 'local_user';
  const sanitized = sanitizeCustomResourcePayload(ownerId, input);

  const createdResource: ExactVideoResource = {
    id: resourceId,
    title: sanitized.title,
    type: sanitized.resourceType as ExactVideoResource['type'],
    description: sanitized.description,
    primaryUrl: sanitized.primaryUrl,
    primaryLabel: 'Open Exact Resource',
    authorOrCreator: sanitized.authorOrCreator || undefined,
    formattedTime: sanitized.formattedTime || undefined,
    timestampSeconds: parseTimeSeconds(sanitized.formattedTime),
    exactQuote: sanitized.exactQuote || undefined,
    verified: true,
    secondaryLinks: [
      {
        label: 'Google Scholar',
        url: `https://scholar.google.com/scholar?q=${encodeURIComponent(sanitized.title)}`,
        sourceName: 'Google Scholar',
      },
      {
        label: 'Wikipedia',
        url: `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(sanitized.title)}`,
        sourceName: 'Wikipedia',
      },
      {
        label: 'OpenLibrary',
        url: `https://openlibrary.org/search?q=${encodeURIComponent(sanitized.title)}`,
        sourceName: 'OpenLibrary',
      },
    ],
  };

  if (user) {
    try {
      const defaultListId = await ensureCloudListExists(getDefaultCloudListId(user.uid));
      await addItemToUserList(defaultListId, {
        itemType: 'note',
        title: sanitized.title,
        url: sanitized.primaryUrl,
        subtitle: sanitized.authorOrCreator,
        content: sanitized.description,
        notes: sanitized.exactQuote,
      });
    } catch {}
  }

  // Update local cache and notify listeners
  const currentLocal = loadLocalCustomResources();
  saveLocalCustomResources([createdResource, ...currentLocal]);
  notifyDataChange();

  return createdResource;
}

/**
 * Delete a custom Exact Video Resource from local cache (F-08)
 */
export async function deleteCustomExactResource(resourceId: string): Promise<void> {
  const updatedLocal = loadLocalCustomResources().filter((r) => r.id !== resourceId);
  saveLocalCustomResources(updatedLocal);
  notifyDataChange();
}

/**
 * Automatically migrate any local lists, items, summaries, and activity into Cloudflare D1 upon sign-in (F-08),
 * preserving list mappings, deduplicating, isolating per-item errors, and clearing migrated local storage.
 */
export async function syncLocalDataToCloud(): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;

  const lastUid = typeof window !== 'undefined' ? localStorage.getItem(LAST_SYNCED_USER_KEY) : null;
  if (lastUid && lastUid !== user.uid) {
    console.info('Preserving distinct user session boundaries for account:', user.uid);
  }
  if (typeof window !== 'undefined') {
    localStorage.setItem(LAST_SYNCED_USER_KEY, user.uid);
  }

  try {
    const headers = await getAuthHeaders();
    if (!headers['Authorization']) return;

    const defaultListId = await ensureCloudListExists(getDefaultCloudListId(user.uid));
    const oldToNewListIdMap = new Map<string, string>();

    // 1. Sync custom local lists to D1
    const rawListsStr = typeof window !== 'undefined' ? localStorage.getItem(LOCAL_LISTS_KEY) : null;
    if (rawListsStr) {
      const localLists = loadLocalLists();
      const unmigratedLists: UserList[] = [];

      for (const l of localLists) {
        if (!l || l.id === 'list_default_favorites') continue;
        try {
          const res = await fetch('/api/lists', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify({
              name: l.name,
              description: l.description,
              category: l.category,
            }),
          });
          if (res.ok) {
            const data = (await res.json()) as any;
            if (data.id) {
              oldToNewListIdMap.set(l.id, data.id);
            }
          } else {
            unmigratedLists.push(l);
          }
        } catch {
          unmigratedLists.push(l);
        }
      }

      if (unmigratedLists.length === 0) {
        try {
          localStorage.removeItem(LOCAL_LISTS_KEY);
        } catch {}
      } else {
        saveLocalLists(unmigratedLists);
      }
    }

    // 2. Sync local list items to D1
    const localItems = loadLocalListItems();
    if (localItems.length > 0) {
      const unmigratedItems: SavedListItem[] = [];
      for (const item of localItems) {
        try {
          const mappedTargetListId = (item.listId && oldToNewListIdMap.get(item.listId)) || defaultListId;
          const sanitized = sanitizeListItemPayload(mappedTargetListId, user.uid, item);
          const res = await fetch(`/api/lists/${encodeURIComponent(mappedTargetListId)}/items`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify(sanitized),
          });
          if (!res.ok) {
            unmigratedItems.push(item);
          }
        } catch {
          unmigratedItems.push(item);
        }
      }
      saveLocalListItems(unmigratedItems);
    }

    // 3. Sync local summaries to D1
    const localSummaries = loadLocalSummaries();
    if (localSummaries.length > 0) {
      const unmigratedSummaries: SavedCloudSummary[] = [];
      for (const s of localSummaries) {
        try {
          const sanitized = sanitizeSavedSummaryPayload(user.uid, s);
          const res = await fetch('/api/summaries', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify(sanitized),
          });
          if (!res.ok) {
            unmigratedSummaries.push(s);
          }
        } catch {
          unmigratedSummaries.push(s);
        }
      }
      saveLocalSummaries(unmigratedSummaries);
    }

    // 4. Sync local activity history to D1
    const localHistory = loadLocalActivityHistory();
    if (localHistory.length > 0) {
      const unmigratedHistory: ActivityHistoryItem[] = [];
      for (const h of localHistory) {
        try {
          const sanitized = sanitizeActivityHistoryPayload(user.uid, h);
          const res = await fetch('/api/activity', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify(sanitized),
          });
          if (!res.ok) {
            unmigratedHistory.push(h);
          }
        } catch {
          unmigratedHistory.push(h);
        }
      }
      saveLocalActivityHistory(unmigratedHistory);
    }

    notifyDataChange();
  } catch (err) {
    console.warn('Background Cloudflare D1 sync warning:', err);
  }
}

export const syncLocalDataToFirestore = syncLocalDataToCloud;

/**
 * Migration helper to export legacy Firestore collections to Cloudflare D1 (F-08)
 */
export async function migrateFirestoreToD1(): Promise<{ lists: number; summaries: number; history: number }> {
  const user = auth.currentUser;
  if (!user) return { lists: 0, summaries: 0, history: 0 };

  const headers = await getAuthHeaders();
  if (!headers['Authorization']) return { lists: 0, summaries: 0, history: 0 };

  let migratedLists = 0;
  let migratedSummaries = 0;
  let migratedHistory = 0;

  try {
    // Read legacy Firestore lists
    const listsSnap = await getDocs(query(collection(db, 'lists'), where('ownerId', '==', user.uid), limit(50)));
    for (const d of listsSnap.docs) {
      const data = d.data();
      const res = await fetch('/api/lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          name: data.name || 'Migrated List',
          description: data.description || '',
          category: data.category || 'general',
        }),
      });
      if (res.ok) {
        const listData = (await res.json()) as any;
        migratedLists++;
        try {
          const itemsSnap = await getDocs(collection(db, 'lists', d.id, 'items'));
          for (const itemDoc of itemsSnap.docs) {
            const itemData = itemDoc.data();
            await fetch(`/api/lists/${encodeURIComponent(listData.id)}/items`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...headers },
              body: JSON.stringify({
                item_type: itemData.itemType || itemData.item_type || 'note',
                title: itemData.title || 'Item',
                url: itemData.url || '',
                subtitle: itemData.subtitle || '',
                content: itemData.content || '',
                notes: itemData.notes || '',
              }),
            });
          }
        } catch {}
      }
    }

    // Read legacy Firestore summaries
    const sumSnap = await getDocs(query(collection(db, 'summaries'), where('ownerId', '==', user.uid), limit(50)));
    for (const d of sumSnap.docs) {
      const data = d.data();
      const res = await fetch('/api/summaries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          video_id: data.videoId || data.video_id || '',
          video_url: data.videoUrl || data.video_url || '',
          video_title: data.videoTitle || data.video_title || 'Summary',
          author_name: data.authorName || data.author_name || 'YouTube',
          summary_type: data.summaryType || data.summary_type || 'massive',
          markdown: data.markdown || '',
        }),
      });
      if (res.ok) migratedSummaries++;
    }

    // Read legacy Firestore history
    const histSnap = await getDocs(query(collection(db, 'history'), where('ownerId', '==', user.uid), limit(100)));
    for (const d of histSnap.docs) {
      const data = d.data();
      const res = await fetch('/api/activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          action_type: data.actionType || data.action_type || 'video',
          query_or_title: data.queryOrTitle || data.query_or_title || '',
          detail: data.detail || '',
          url: data.url || '',
          video_id: data.videoId || data.video_id || '',
          date_key: data.dateKey || data.date_key,
        }),
      });
      if (res.ok) migratedHistory++;
    }

    notifyDataChange();
  } catch (err) {
    console.warn('migrateFirestoreToD1 warning:', err);
  }

  return { lists: migratedLists, summaries: migratedSummaries, history: migratedHistory };
}

/**
 * Subscribe to the signed-in user's chronological activity & search history in Cloudflare D1 (`/api/activity`) (F-08)
 */
export function subscribeToActivityHistory(
  userId: string,
  onUpdate: (items: ActivityHistoryItem[]) => void,
  onError?: (errMessage: string) => void
): () => void {
  let active = true;

  const fetchActivity = async () => {
    try {
      const headers = await getAuthHeaders();
      if (headers['Authorization']) {
        const res = await fetch('/api/activity', { headers });
        if (res.ok) {
          const data = (await res.json()) as any;
          if (active && Array.isArray(data.items)) {
            const mapped: ActivityHistoryItem[] = data.items.map((d: any) => ({
              id: d.id,
              ownerId: d.owner_id || d.ownerId || userId,
              actionType: ALLOWED_ACTIVITY_TYPES.includes(d.action_type || d.actionType)
                ? (d.action_type || d.actionType)
                : 'research_search',
              queryOrTitle: d.query_or_title || d.queryOrTitle || 'Activity',
              detail: d.detail || '',
              url: d.url || '',
              videoId: d.video_id || d.videoId || '',
              dateKey:
                typeof (d.date_key || d.dateKey) === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(d.date_key || d.dateKey)
                  ? (d.date_key || d.dateKey)
                  : formatDateKey(d.created_at || d.createdAt),
              createdAt: d.created_at || d.createdAt || new Date().toISOString(),
              updatedAt: d.updated_at || d.updatedAt || new Date().toISOString(),
            }));
            onUpdate(mapped);
            saveLocalActivityHistory(mapped);
            return;
          }
        }
      }
    } catch (e: any) {
      if (active && onError) onError(e.message);
    }
    if (active) {
      onUpdate(loadLocalActivityHistory());
    }
  };

  fetchActivity();
  const unsubListener = registerChangeListener(fetchActivity);

  return () => {
    active = false;
    unsubListener();
  };
}

/**
 * Record any user search or action into date-grouped history (Cloudflare D1 + localStorage fallback) (F-08)
 */
export async function recordUserActivity(input: {
  actionType:
    | ActivityActionType
    | 'search'
    | 'dictionary'
    | 'techword'
    | 'knowledge'
    | 'chat'
    | 'transcript'
    | 'artifact';
  queryOrTitle?: string;
  title?: string;
  query?: string;
  detail?: string;
  details?: string;
  url?: string;
  videoUrl?: string;
  videoTitle?: string;
  videoId?: string;
}): Promise<ActivityHistoryItem | null> {
  const actionMap: Record<string, ActivityActionType> = {
    video: 'video',
    summary: 'summary',
    word_lookup: 'word_lookup',
    dictionary: 'word_lookup',
    techword: 'word_lookup',
    knowledge: 'word_lookup',
    research_search: 'research_search',
    search: 'research_search',
    transcript_search: 'transcript_search',
    transcript: 'transcript_search',
    ai_question: 'ai_question',
    chat: 'ai_question',
    artifact_saved: 'artifact_saved',
    artifact: 'artifact_saved',
    audio_narration: 'audio_narration',
  };
  const normalizedAction: ActivityActionType = actionMap[input.actionType] || 'research_search';
  const cleanTitle = (input.queryOrTitle || input.title || input.query || '').trim();
  if (!cleanTitle || cleanTitle.length < 2) return null;

  const combinedDetail = [
    input.detail || input.details || '',
    input.videoTitle && !(input.detail || input.details || '').includes(input.videoTitle)
      ? `Video: ${input.videoTitle}`
      : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const resolvedUrl = input.url || input.videoUrl || '';

  const nowMs = Date.now();
  const signature = `${normalizedAction}::${cleanTitle.toLowerCase()}::${input.videoId || ''}`;
  if (signature === lastRecordedSignature && nowMs - lastRecordedTimestamp < 2500) {
    return null;
  }
  lastRecordedSignature = signature;
  lastRecordedTimestamp = nowMs;

  const user = auth.currentUser;
  const dateKey = formatDateKey();
  const historyId = generateSafeId('hist');
  const nowIso = new Date().toISOString();

  if (user) {
    const sanitized = sanitizeActivityHistoryPayload(user.uid, {
      actionType: normalizedAction,
      queryOrTitle: cleanTitle,
      detail: combinedDetail,
      url: resolvedUrl,
      videoId: input.videoId,
      dateKey,
    });
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(sanitized),
      });
      if (res.ok) {
        const data = (await res.json()) as any;
        const createdItem: ActivityHistoryItem = {
          id: data.id || historyId,
          ...sanitized,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        const current = loadLocalActivityHistory();
        saveLocalActivityHistory([createdItem, ...current]);
        notifyDataChange();
        return createdItem;
      }
    } catch (err) {
      console.warn('D1 recordUserActivity error:', err);
    }
  }

  const sanitizedLocal = sanitizeActivityHistoryPayload('local_user', {
    actionType: normalizedAction,
    queryOrTitle: cleanTitle,
    detail: combinedDetail,
    url: resolvedUrl,
    videoId: input.videoId,
    dateKey,
  });
  const localItem: ActivityHistoryItem = {
    id: historyId,
    ...sanitizedLocal,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  const current = loadLocalActivityHistory();
  saveLocalActivityHistory([localItem, ...current]);
  notifyDataChange();
  return localItem;
}

export async function deleteActivityHistoryItem(historyId: string): Promise<void> {
  const user = auth.currentUser;
  if (user && ID_REGEX.test(historyId)) {
    try {
      const headers = await getAuthHeaders();
      await fetch(`/api/activity/${encodeURIComponent(historyId)}`, {
        method: 'DELETE',
        headers,
      });
    } catch (err) {
      console.warn('D1 deleteActivityHistoryItem error:', err);
    }
  }
  const current = loadLocalActivityHistory().filter((h) => h.id !== historyId);
  saveLocalActivityHistory(current);
  notifyDataChange();
}

export async function clearActivityHistoryByDate(dateKey: string): Promise<void> {
  const user = auth.currentUser;
  if (user) {
    try {
      const headers = await getAuthHeaders();
      await fetch(`/api/activity?dateKey=${encodeURIComponent(dateKey)}`, {
        method: 'DELETE',
        headers,
      });
    } catch (err) {
      console.warn('D1 clearActivityHistoryByDate error:', err);
    }
  }
  const current = loadLocalActivityHistory().filter((h) => h.dateKey !== dateKey);
  saveLocalActivityHistory(current);
  notifyDataChange();
}

export const clearActivityHistoryForDate = clearActivityHistoryByDate;

export async function clearAllActivityHistory(): Promise<void> {
  const user = auth.currentUser;
  if (user) {
    try {
      const headers = await getAuthHeaders();
      await fetch('/api/activity?all=true', {
        method: 'DELETE',
        headers,
      });
    } catch (err) {
      console.warn('D1 clearAllActivityHistory error:', err);
    }
  }
  saveLocalActivityHistory([]);
  notifyDataChange();
}

