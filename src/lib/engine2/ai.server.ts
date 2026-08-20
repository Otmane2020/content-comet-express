// Thin DeepSeek JSON client used by every engine service.
export async function askJson<T>(apiKey: string, system: string, prompt: string, maxTokens = 4000): Promise<T> {
  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "deepseek-chat", response_format: { type: "json_object" }, max_tokens: maxTokens, messages: [
      { role: "system", content: `${system}\nTu réponds UNIQUEMENT avec du JSON valide. Aucune donnée inventée : si une information n'est pas établie, renvoie une valeur vide ou null.` },
      { role: "user", content: prompt },
    ] }),
    signal: AbortSignal.timeout(120000),
  });
  if (res.status === 429) throw new Error("Limite de requêtes DeepSeek atteinte.");
  if (res.status === 402) throw new Error("Crédits DeepSeek épuisés.");
  if (!res.ok) throw new Error(`DeepSeek [${res.status}]: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const raw: string = data?.choices?.[0]?.message?.content ?? "";
  const cleaned = raw.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{"); const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Réponse IA non exploitable (JSON absent).");
  return JSON.parse(cleaned.slice(start, end + 1)) as T;
}
export function asArray<T>(v: unknown): T[] { return Array.isArray(v) ? (v as T[]) : []; }
export function asString(v: unknown, fallback = ""): string { return typeof v === "string" ? v : fallback; }
export function asNumber(v: unknown): number { return typeof v === "number" && Number.isFinite(v) ? v : 0; }
