export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LanguageModelClient {
  listModels(): Promise<string[]>;
  chat(messages: ChatMessage[]): Promise<string>;
}

export interface LmStudioOptions {
  baseUrl: string;
  model: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class LmStudioClient implements LanguageModelClient {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: LmStudioOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.model = options.model;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  async listModels(): Promise<string[]> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/models`, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new Error(
        `LM Studio 连接失败（${this.baseUrl}）：${messageOf(error)}。请确认 LM Studio 已启动并开启了本地服务。`,
      );
    }
    if (!response.ok) {
      throw new Error(`LM Studio 返回 ${response.status}`);
    }
    const body = (await response.json()) as {
      data?: Array<{ id?: string } | string>;
      models?: Array<{ id?: string } | string>;
    };
    const list = Array.isArray(body.data) ? body.data : Array.isArray(body.models) ? body.models : [];
    return list
      .map((entry) => (typeof entry === 'string' ? entry : entry.id ?? ''))
      .filter((id): id is string => id.length > 0);
  }

  async chat(messages: ChatMessage[]): Promise<string> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: 0.2,
          stream: false,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new Error(`LM Studio 连接失败（${this.baseUrl}）：${messageOf(error)}`);
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`LM Studio 返回 ${response.status}${detail ? `：${detail.slice(0, 200)}` : ''}`);
    }
    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new Error('LM Studio 的回复里没有内容');
    }
    return content;
  }
}
