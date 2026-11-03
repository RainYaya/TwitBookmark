export type Source = 'twitter' | 'browser' | 'github';
export type Status = 'inbox' | 'later' | 'done' | 'reference';
export type AiState = 'none' | 'suggested' | 'accepted';

export interface Item {
  id: string;
  source: Source;
  title: string;
  url: string;
  created_at: string | null;
  saved_at: string;
  saved_source: string | null;
  imported_at: string;
  status: Status;
  read: boolean;
  is_todo: boolean;
  todo_done: boolean;
  metadata: Record<string, unknown>;
  ai_tags: string[];
  ai_summary: string | null;
  summary: string | null;
  ai_state: AiState;
  last_surfaced_at: string | null;
  deleted_at: string | null;
  tags: string[];
}

export interface Tag {
  id: number;
  name: string;
  count: number;
}

export interface ItemQuery {
  source?: Source[];
  status?: Status;
  tag?: string;
  q?: string;
  deleted?: boolean;
  cursor?: string;
  limit?: number;
}

export interface ItemPage {
  items: Item[];
  nextCursor?: string;
}

export interface ItemPatch {
  status?: Status;
  read?: boolean;
  is_todo?: boolean;
  todo_done?: boolean;
  summary?: string | null;
}

export interface BulkPayload {
  ids: string[];
  action: 'delete' | 'patch' | 'restore';
  patch?: ItemPatch;
}

export interface AcceptAiPayload {
  ids?: string[];
  source?: Source[];
  status?: Status;
  tag?: string;
  q?: string;
}

export interface ImportStats {
  seen: number;
  inserted: number;
  updated: number;
  skipped: number;
}

export interface SyncStats extends ImportStats {
  fetched: number;
}

export interface ImportFile {
  name: string;
  path: string;
  size: number;
  modified_at: string;
  kind: 'twitter' | 'browser' | 'other';
}

export interface TaxonomyTag {
  name: string;
  description: string;
}

export interface AiJob {
  id: string;
  kind: string;
  status: 'pending' | 'running' | 'paused' | 'done' | 'failed';
  total: number;
  done: number;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface Api {
  listItems(query?: ItemQuery): Promise<ItemPage>;
  patchItem(id: string, patch: ItemPatch): Promise<Item>;
  deleteItem(id: string): Promise<void>;
  bulk(payload: BulkPayload): Promise<{ updated: number }>;
  restore(id: string): Promise<Item>;
  listTags(): Promise<Tag[]>;
  createTag(name: string): Promise<Tag>;
  renameTag(id: number, name: string): Promise<Tag>;
  deleteTag(id: number): Promise<void>;
  setTags(id: string, tags: string[]): Promise<Item>;
  acceptAi(payload: AcceptAiPayload): Promise<{ updated: number }>;
  getDailyReview(count?: number): Promise<Item[]>;
}

export interface SettingsApi extends Api {
  scanImports(): Promise<ImportFile[]>;
  importTwitter(json: unknown): Promise<ImportStats>;
  importTwitterPath(path: string): Promise<ImportStats>;
  importBrowser(html: string): Promise<ImportStats>;
  importBrowserPath(path: string): Promise<ImportStats>;
  syncGithub(): Promise<SyncStats>;
  getSettings(): Promise<Record<string, string>>;
  putSettings(settings: Record<string, string>): Promise<Record<string, string>>;
  listModels(): Promise<string[]>;
  proposeTaxonomy(): Promise<TaxonomyTag[]>;
  classify(): Promise<AiJob>;
  getJob(id: string): Promise<AiJob>;
  getLatestJob(): Promise<AiJob | null>;
  pauseJob(id: string): Promise<AiJob>;
  resumeJob(id: string): Promise<AiJob>;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // keep the status message
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export class ApiClient implements SettingsApi {
  async listItems(query: ItemQuery = {}): Promise<ItemPage> {
    const params = new URLSearchParams();
    for (const source of query.source ?? []) params.append('source', source);
    if (query.status) params.set('status', query.status);
    if (query.tag) params.set('tag', query.tag);
    if (query.q) params.set('q', query.q);
    if (query.deleted) params.set('deleted', '1');
    if (query.cursor) params.set('cursor', query.cursor);
    if (query.limit) params.set('limit', String(query.limit));
    const suffix = params.toString();
    return request<ItemPage>(`/api/items${suffix ? `?${suffix}` : ''}`);
  }

  patchItem(id: string, patch: ItemPatch): Promise<Item> {
    return request<Item>(`/api/items/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  }

  async deleteItem(id: string): Promise<void> {
    await request<{ ok: boolean }>(`/api/items/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  bulk(payload: BulkPayload): Promise<{ updated: number }> {
    return request<{ updated: number }>('/api/items/bulk', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  restore(id: string): Promise<Item> {
    return request<Item>(`/api/items/${encodeURIComponent(id)}/restore`, {
      method: 'POST',
    });
  }

  async listTags(): Promise<Tag[]> {
    const body = await request<{ tags: Tag[] }>('/api/tags');
    return body.tags;
  }

  createTag(name: string): Promise<Tag> {
    return request<Tag>('/api/tags', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  }

  renameTag(id: number, name: string): Promise<Tag> {
    return request<Tag>(`/api/tags/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    });
  }

  async deleteTag(id: number): Promise<void> {
    await request<{ ok: boolean }>(`/api/tags/${id}`, { method: 'DELETE' });
  }

  setTags(id: string, tags: string[]): Promise<Item> {
    return request<Item>(`/api/items/${encodeURIComponent(id)}/tags`, {
      method: 'POST',
      body: JSON.stringify({ tags }),
    });
  }

  acceptAi(payload: AcceptAiPayload): Promise<{ updated: number }> {
    return request<{ updated: number }>('/api/items/accept-ai', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async getDailyReview(count = 3): Promise<Item[]> {
    const body = await request<{ items: Item[] }>(`/api/review/daily?count=${count}`);
    return body.items;
  }

  async scanImports(): Promise<ImportFile[]> {
    const body = await request<{ files: ImportFile[] }>('/api/import/scan');
    return body.files;
  }

  importTwitter(json: unknown): Promise<ImportStats> {
    return request<ImportStats>('/api/import/twitter', {
      method: 'POST',
      body: JSON.stringify({ json }),
    });
  }

  importTwitterPath(path: string): Promise<ImportStats> {
    return request<ImportStats>('/api/import/twitter', {
      method: 'POST',
      body: JSON.stringify({ path }),
    });
  }

  importBrowser(html: string): Promise<ImportStats> {
    return request<ImportStats>('/api/import/browser', {
      method: 'POST',
      body: JSON.stringify({ html }),
    });
  }

  importBrowserPath(path: string): Promise<ImportStats> {
    return request<ImportStats>('/api/import/browser', {
      method: 'POST',
      body: JSON.stringify({ path }),
    });
  }

  syncGithub(): Promise<SyncStats> {
    return request<SyncStats>('/api/sync/github', { method: 'POST' });
  }

  async getSettings(): Promise<Record<string, string>> {
    const body = await request<{ settings: Record<string, string> }>('/api/settings');
    return body.settings;
  }

  async putSettings(settings: Record<string, string>): Promise<Record<string, string>> {
    const body = await request<{ settings: Record<string, string> }>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ settings }),
    });
    return body.settings;
  }

  async listModels(): Promise<string[]> {
    const body = await request<{ models: string[] }>('/api/ai/models');
    return body.models;
  }

  async proposeTaxonomy(): Promise<TaxonomyTag[]> {
    const body = await request<{ tags: TaxonomyTag[] }>('/api/ai/taxonomy', {
      method: 'POST',
    });
    return body.tags;
  }

  async classify(): Promise<AiJob> {
    const body = await request<{ job: AiJob }>('/api/ai/classify', { method: 'POST' });
    return body.job;
  }

  getJob(id: string): Promise<AiJob> {
    return request<AiJob>(`/api/ai/jobs/${encodeURIComponent(id)}`);
  }

  async getLatestJob(): Promise<AiJob | null> {
    const body = await request<{ job: AiJob | null }>('/api/ai/jobs/latest');
    return body.job;
  }

  pauseJob(id: string): Promise<AiJob> {
    return request<AiJob>(`/api/ai/jobs/${encodeURIComponent(id)}/pause`, {
      method: 'POST',
    });
  }

  resumeJob(id: string): Promise<AiJob> {
    return request<AiJob>(`/api/ai/jobs/${encodeURIComponent(id)}/resume`, {
      method: 'POST',
    });
  }
}
