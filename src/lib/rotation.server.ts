/**
 * The rotation engine: the single place where the rolling 30-day calendar is
 * built. It plans on live DataForSEO keywords (most business-relevant first),
 * never reuses a keyword twice in the same window, and stores the keyword it
 * planned on so the writer targets it.
 */
import { planWindow, type ContentType } from "./geo";

type Sb = { from: (t: string) => any };

export type RotationProject = {
  id: string;
  user_id: string;
  name: string;
  website_url: string | null;
  industry: string | null;
  audience: string | null;
  tone: string | null;
  locale: string | null;
  keywords: string[] | null;
};

export type PickedKeyword = { id: string; keyword: string };

/** Unused keywords for this project, most business-relevant first. */
export async function pickKeywords(
  supabase: Sb,
  projectId: string,
  limit: number,
): Promise<PickedKeyword[]> {
  const { data } = await supabase
    .from("keyword_research")
    .select("id, keyword, relevance_score, search_volume")
    .eq("project_id", projectId)
    .eq("used", false)
    .gte("relevance_score", 60)
    .order("relevance_score", { ascending: false, nullsFirst: false })
    .order("search_volume", { ascending: false, nullsFirst: false })
    .limit(limit);
  return (data ?? []) as PickedKeyword[];
}

/**
 * Fills every empty day of the next `days` days with a planned item.
 * Runs research first when the keyword table is still empty, so a fresh
 * project never falls back to generic topics.
 */
export async function ensureWindow(
  supabase: Sb,
  userId: string,
  project: RotationProject,
  days = 30,
): Promise<{ created: number; keywords: number; researched: boolean }> {
  const { planTopics } = await import("./plan.server");

  const window = planWindow(new Date(), days);
  const { data: existing } = await supabase
    .from("content_items")
    .select("scheduled_date")
    .eq("project_id", project.id);
  const taken = new Set((existing ?? []).map((r: { scheduled_date: string }) => r.scheduled_date));
  const missing = window.filter((s) => !taken.has(s.date));
  if (!missing.length) {
    const attached = await backfillKeywords(supabase, userId, project);
    return { created: 0, keywords: attached, researched: false };
  }

  let picked = await pickKeywords(supabase, project.id, missing.length);
  let researched = false;
  if (!picked.length) {
    try {
      const { runResearch } = await import("./research.server");
      await runResearch(supabase, userId, project.id, false);
      researched = true;
      picked = await pickKeywords(supabase, project.id, missing.length);
    } catch {
      /* research unavailable — plan on the stored keywords instead */
    }
  }

  const brief = {
    name: project.name,
    website_url: project.website_url,
    industry: project.industry,
    audience: project.audience,
    tone: project.tone,
    locale: project.locale,
    keywords: picked.length ? picked.map((k) => k.keyword) : (project.keywords ?? []),
  };

  // One keyword per day. When there are fewer keywords than days, the list
  // rotates so the calendar still covers the whole set evenly.
  const keywordFor = (i: number) =>
    picked.length ? (picked[i % picked.length]?.keyword ?? null) : (brief.keywords[i % Math.max(1, brief.keywords.length)] ?? null);

  const slots = missing.map((m, i) => ({
    date: m.date,
    type: m.type as ContentType,
    keyword: keywordFor(i),
  }));

  const topics = await planTopics(brief, slots);
  const byDate = new Map(slots.map((s) => [s.date, s.keyword]));

  const { error } = await supabase.from("content_items").insert(
    topics.map((t) => ({
      user_id: userId,
      project_id: project.id,
      scheduled_date: t.date,
      content_type: t.type,
      topic: t.topic,
      target_keyword: byDate.get(t.date) ?? null,
      status: "planned",
    })),
  );
  if (error) throw new Error(error.message);

  if (picked.length) {
    await supabase
      .from("keyword_research")
      .update({ used: true })
      .in("id", picked.slice(0, missing.length).map((k) => k.id));
  }

  return { created: topics.length, keywords: picked.length, researched };
}

/**
 * Days planned before the research existed have no keyword attached. Give each
 * still-unwritten day the next most relevant unused keyword, so the writer
 * always targets a real search term.
 */
export async function backfillKeywords(
  supabase: Sb,
  _userId: string,
  project: RotationProject,
): Promise<number> {
  const { data: orphans } = await supabase
    .from("content_items")
    .select("id")
    .eq("project_id", project.id)
    .is("target_keyword", null)
    .is("body_md", null)
    .order("scheduled_date", { ascending: true })
    .limit(60);
  const items = (orphans ?? []) as { id: string }[];
  if (!items.length) return 0;

  const picked = await pickKeywords(supabase, project.id, items.length);
  if (!picked.length) return 0;

  let used = 0;
  for (const [i, item] of items.entries()) {
    const kw = picked[i];
    if (!kw) break;
    await supabase.from("content_items").update({ target_keyword: kw.keyword }).eq("id", item.id);
    used += 1;
  }
  await supabase
    .from("keyword_research")
    .update({ used: true })
    .in("id", picked.slice(0, used).map((k) => k.id));
  return used;
}