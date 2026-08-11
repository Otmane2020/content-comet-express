const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

export const DEFAULT_MODEL = "deepseek/deepseek-chat";

async function callDeepSeek(opts: {
  system: string;
  user: string;
  json?: boolean;
  maxTokens?: number;
}): Promise<string> {
  const apiKey = process.env["DEEPSEEK_API_KEY"];
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not configured");
  const res = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "deepseek-chat",
      max_tokens: opts.maxTokens ?? 2600,
      temperature: 0.6,
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`DeepSeek failed [${res.status}]: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("DeepSeek returned an empty response");
  return content;
}

/**
 * Calls DeepSeek through OpenRouter, and falls back to the DeepSeek API
 * directly when OpenRouter refuses (out of credits, rate limit, outage) so
 * the generation pipeline never stops on a billing hiccup.
 */
export async function callOpenRouter(opts: {
  system: string;
  user: string;
  model?: string;
  json?: boolean;
  maxTokens?: number;
}): Promise<string> {
  const apiKey = process.env["OPENROUTER_API_KEY"];
  if (!apiKey) return callDeepSeek(opts);

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Title": "Ranki.ai",
    },
    body: JSON.stringify({
      model: opts.model ?? DEFAULT_MODEL,
      max_tokens: opts.maxTokens ?? 2600,
      temperature: 0.6,
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    try {
      return await callDeepSeek(opts);
    } catch {
      throw new Error(`OpenRouter failed [${res.status}]: ${body.slice(0, 500)}`);
    }
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    error?: { message?: string };
  };
  if (data.error?.message || !data.choices?.[0]?.message?.content) {
    return callDeepSeek(opts);
  }
  const content = data.choices[0].message.content;
  return content;
}

export function parseJsonLoose<T>(raw: string): T {
  const fenced = raw.replace(/```json|```/g, "").trim();
  const start = fenced.indexOf("{");
  const arrStart = fenced.indexOf("[");
  const from =
    start === -1 ? arrStart : arrStart === -1 ? start : Math.min(start, arrStart);
  const slice = from > 0 ? fenced.slice(from) : fenced;
  try {
    return JSON.parse(slice) as T;
  } catch {
    // Some providers add one explanatory sentence after an otherwise valid
    // JSON object. Extract the first balanced JSON value instead of treating a
    // useful AI answer as an empty result.
    const opening = slice[0];
    const closing = opening === "[" ? "]" : "}";
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = 0; index < slice.length; index += 1) {
      const char = slice[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') quoted = false;
        continue;
      }
      if (char === '"') {
        quoted = true;
      } else if (char === opening) {
        depth += 1;
      } else if (char === closing && --depth === 0) {
        return JSON.parse(slice.slice(0, index + 1)) as T;
      }
    }
    throw new Error("AI response did not contain a complete JSON value");
  }
}
