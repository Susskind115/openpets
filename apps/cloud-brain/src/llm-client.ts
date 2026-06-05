import { info, warn } from "./logger.js";

export interface LLMConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  maxTokens: number;
  temperature: number;
  enabled: boolean;
}

export interface LLMResponse {
  content: string;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

export function loadLLMConfig(): LLMConfig {
  return {
    enabled: process.env.LLM_ENABLED === "1",
    baseUrl: process.env.LLM_BASE_URL ?? "http://127.0.0.1:30000/v1",
    model: process.env.LLM_MODEL ?? "Qwen3-8B",
    apiKey: process.env.LLM_API_KEY ?? "EMPTY",
    maxTokens: Number(process.env.LLM_MAX_TOKENS ?? "150"),
    temperature: Number(process.env.LLM_TEMPERATURE ?? "0.7"),
  };
}

export async function callLLM(
  config: LLMConfig,
  messages: Array<{ role: string; content: string }>,
): Promise<LLMResponse | null> {
  if (!config.enabled) return null;

  try {
    const resp = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        max_tokens: config.maxTokens,
        temperature: config.temperature,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!resp.ok) {
      warn("llm", `request failed: HTTP ${resp.status}`);
      return null;
    }

    const data = (await resp.json()) as any;
    const content = data.choices?.[0]?.message?.content ?? "";
    info("llm", "response", { tokens: data.usage?.completion_tokens, model: config.model });
    return { content, usage: data.usage };
  } catch (err) {
    warn("llm", `call error: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
