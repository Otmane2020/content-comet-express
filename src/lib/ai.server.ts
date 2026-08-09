const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export const DEFAULT_MODEL = "deepseek/deepseek-chat";

export async function callOpenRouter(opts: {
  system: string;
  user: string;
  model?: string;
  json?: boolean;
  maxTokens?: number;
}): Promise<string> {
  const apiKey = process.env["OPENROUTER_API_KEY"];
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured");

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
    throw new Error(`OpenRouter failed [${res.status}]: ${body.slice(0, 500)}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    error?: { message?: string };
  };
  if (data.error?.message) throw new Error(`OpenRouter: ${data.error.message}`);
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenRouter returned an empty response");
  return content;
}

export function parseJsonLoose<T>(raw: string): T {
  const fenced = raw.replace(/```json|```/g, "").trim();
  const start = fenced.indexOf("{");
  const arrStart = fenced.indexOf("[");
  const from =
    start === -1 ? arrStart : arrStart === -1 ? start : Math.min(start, arrStart);
  const slice = from > 0 ? fenced.slice(from) : fenced;
  return JSON.parse(slice) as T;
}