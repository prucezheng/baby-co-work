// 火山方舟 OpenAI 兼容 API 适配器
// API Key 只允许在服务端读取，禁止进入浏览器端

export type ArkErrorCode = 'ARK_TIMEOUT' | 'ARK_UNAVAILABLE';

export class ArkError extends Error {
  readonly code: ArkErrorCode;

  constructor(code: ArkErrorCode, message: string) {
    super(message);
    this.name = 'ArkError';
    this.code = code;
  }
}

export type ArkChatContent = Array<
  | { type: 'video_url'; video_url: { url: string } }
  | { type: 'text'; text: string }
>;

export interface ArkClient {
  chat(content: ArkChatContent): Promise<string>;
}

export interface ArkClientOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export function createArkClient(options: ArkClientOptions): ArkClient {
  const baseUrl = options.baseUrl ?? 'https://ark.cn-beijing.volces.com/api/v3';
  const timeoutMs = options.timeoutMs ?? 90_000;

  return {
    async chat(content) {
      let response: Response;
      try {
        response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${options.apiKey}`
          },
          body: JSON.stringify({
            model: options.model,
            messages: [{ role: 'user', content }]
          }),
          signal: AbortSignal.timeout(timeoutMs)
        });
      } catch (error) {
        if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
          throw new ArkError('ARK_TIMEOUT', `模型请求超过 ${timeoutMs / 1000} 秒未响应`);
        }
        throw new ArkError('ARK_UNAVAILABLE', '无法连接模型服务');
      }

      if (!response.ok) {
        throw new ArkError('ARK_UNAVAILABLE', `模型服务返回 ${response.status}`);
      }

      const data = (await response.json()) as ChatCompletionResponse;
      const text = data.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || text.length === 0) {
        throw new ArkError('ARK_UNAVAILABLE', '模型服务返回了空内容');
      }
      return text;
    }
  };
}
