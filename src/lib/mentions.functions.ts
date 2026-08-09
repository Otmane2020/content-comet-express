import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const projectInput = z.object({ projectId: z.string().uuid() });

/** Ask ChatGPT, Perplexity and Gemini buyer questions and record brand mentions. */
export const scanAiMentions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => projectInput.parse(input))
  .handler(async ({ data, context }) => {
    const { askEngine, findBrandRank, mentionPrompts, ENGINE_MODELS } = await import("./mentions.server");
    const { supabase, userId } = context;
    const { data: project } = await supabase
      .from("projects")
      .select("name, industry, locale, website_url, keywords")
      .eq("id", data.projectId)
      .maybeSingle();
    const p = (project ?? {}) as {
      name?: string | null;
      industry?: string | null;
      website_url?: string | null;
      keywords?: string[] | null;
    };
    const brand = p.name?.trim();
    if (!brand) throw new Error("Add your brand name in Settings first.");

    const prompts = mentionPrompts({
      brand,
      industry: p.industry,
      keywords: p.keywords ?? null,
    });
    const engines = Object.keys(ENGINE_MODELS) as (keyof typeof ENGINE_MODELS)[];

    const jobs = engines.flatMap((engine) =>
      prompts.map(async (prompt) => {
        try {
          const res = await askEngine(engine, prompt);
          const rank = findBrandRank(res.brands, brand, p.website_url);
          return {
            user_id: userId,
            project_id: data.projectId,
            engine,
            prompt,
            mentioned: rank !== null,
            rank,
            brands: res.brands,
            answer: res.answer,
            checked_at: new Date().toISOString(),
          };
        } catch {
          return null;
        }
      }),
    );
    const rows = (await Promise.all(jobs)).filter((r): r is NonNullable<typeof r> => r !== null);
    if (rows.length) {
      const { error } = await supabase
        .from("ai_mentions")
        .upsert(rows, { onConflict: "project_id,engine,prompt" });
      if (error) throw new Error(error.message);
    }
    return { checked: rows.length, mentioned: rows.filter((r) => r.mentioned).length };
  });
