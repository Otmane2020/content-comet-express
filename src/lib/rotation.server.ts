/**
 * The rotation engine: the single place where the rolling 30-day calendar is
 * built. It plans on live DataForSEO keywords (most business-relevant first),
 * never reuses a keyword twice in the same window, and stores the keyword it
 * planned on so the writer targets it.
 */
import { getEligibleFormats, planWindow, type ContentType } from "./geo";
import type { CanonicalProfileFacts } from "./plan.server";

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
  business_profile?:
    | (CanonicalProfileFacts & {
        has_physical_location?: boolean | null;
        has_service_area?: boolean | null;
      })
    | null;
};

export type PickedKeyword = { id: string; keyword: string; intent?: string | null; origin?: string | null };

/**
 * Which search intents suit each content format. Used to pair a keyword with a
 * day whose format fits it, rather than to change the format itself — the
 * five-way rotation is what keeps the calendar varied.
 */
const INTENT_FIT: Record<ContentType, string[]> = {
  shopping: ["transactional", "commercial"],
  seo: ["commercial", "informational"],
  aeo: ["commercial", "transactional", "informational"],
  // These are writing formats, not marketing topics. A commercial buyer
  // query therefore remains the strongest fit for a GEO/AEO article.
  geo: ["commercial", "transactional", "informational", "navigational"],
  local_aeo: ["commercial", "transactional", "navigational", "informational"],
};

/**
 * Pairs each slot with the best-fitting unused keyword from `pool` (a
 * transactional term on a Shopping day, a question on an AEO day), never
 * reusing a keyword twice in the same window. Falls back to plain order when
 * a slot's format has no intent-matching keyword left. Shared by the daily
 * rotation (ensureWindow, below) and the /test calendar diagnostic so both
 * exercise the same pairing instead of /test's own naive
 * `index % pool.length`, which is what mechanically paired an informational
 * "how to rank on ChatGPT" query with a Shopping pricing template.
 */
export function assignKeywordsToSlots(
  pool: { keyword: string; intent?: string | null; origin?: string | null }[],
  slots: { date: string; type: ContentType }[],
) {
  const normalised = pool.map((k) => ({ keyword: k.keyword, intent: (k.intent ?? "").toLowerCase(), origin: k.origin ?? "" }));
  const claimed = new Set<number>();
  const takeFor = (type: ContentType) => {
    const fits = INTENT_FIT[type] ?? [];
    let index = type === "local_aeo"
      ? normalised.findIndex((k, i) => !claimed.has(i) && k.origin === "local")
      : -1;
    if (index < 0) index = normalised.findIndex((k, i) => !claimed.has(i) && k.intent && fits.includes(k.intent));
    if (index < 0) index = normalised.findIndex((_, i) => !claimed.has(i));
    if (index < 0) return null;
    claimed.add(index);
    return normalised[index]!.keyword;
  };
  return slots.map((slot) => ({ ...slot, keyword: takeFor(slot.type) }));
}

/** Unused keywords for this project, most business-relevant first. */
export async function pickKeywords(
  supabase: Sb,
  projectId: string,
  limit: number,
): Promise<PickedKeyword[]> {
  const { data } = await supabase
    .from("keyword_research")
    .select("id, keyword, intent, relevance_score, search_volume")
    .eq("project_id", projectId)
    .eq("used", false)
    .gte("relevance_score", 60)
    .order("search_volume", { ascending: false, nullsFirst: false })
    .order("relevance_score", { ascending: false, nullsFirst: false })
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

  // The rotation only ever offers formats this business is eligible for: a
  // globally-sold SaaS or service never gets a Local AEO day, and the
  // commercial slot renders as software/service content instead of a product
  // comparison when there is no catalogue (see writeArticle).
  const eligible = getEligibleFormats(project.business_profile ?? {});
  const window = planWindow(new Date(), days, eligible);
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
    locations: project.business_profile?.locations ?? null,
    profile: project.business_profile ?? null,
  };

  // One keyword per day, and never the same one twice in a window. The list
  // used to rotate modulo-style when there were fewer keywords than days,
  // which planned several near-identical articles on the same term — and marked
  // it `used` only once. Days past the end are planned from the brief instead.
  const pool: { keyword: string; intent: string; origin: string }[] = picked.length
    ? picked.map((k) => ({ keyword: k.keyword, intent: (k.intent ?? "").toLowerCase(), origin: k.origin ?? "" }))
    : brief.keywords.map((keyword) => ({ keyword, intent: "", origin: "" }));
  const slots = assignKeywordsToSlots(
    pool,
    missing.map((m) => ({ date: m.date, type: m.type as ContentType })),
  );

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

  // Mark exactly the keywords that were claimed above. Marking a prefix of the
  // list was wrong once assignment stopped being sequential.
  if (picked.length) {
    const usedKeywords = new Set(slots.map((s) => s.keyword).filter((k): k is string => Boolean(k)));
    const usedIds = picked.filter((k) => usedKeywords.has(k.keyword)).map((k) => k.id);
    if (usedIds.length) {
      await supabase.from("keyword_research").update({ used: true }).in("id", usedIds);
    }
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
