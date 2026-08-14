/**
 * The rotation engine: the single place where the rolling 30-day calendar is
 * built. It plans on live DataForSEO keywords (most business-relevant first),
 * never reuses a keyword twice in the same window, and stores the keyword it
 * planned on so the writer targets it.
 */
import { getEligibleFormats, planWindow, type ContentType } from "./geo";
import type { CanonicalProfileFacts } from "./plan.server";
import { angleFitsIntent, formatFitsKeyword, resolveSlotIntent, type CalendarSlot } from "./angles.server";

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
 * Pairs each slot with a HARD-fitting keyword from `pool` (formatFitsKeyword,
 * angles.server.ts) — a transactional term on a Shopping day, a question on
 * an AEO day. A keyword whose intent doesn't fit the day's preferred format
 * is never forced onto it: the day's format can shift to any of the
 * business's OTHER eligible formats that a keyword does fit, and only once
 * nothing fits any eligible format does the slot go keyword-less.
 *
 * Every qualified keyword legitimately supports MULTIPLE distinct articles
 * (e.g. "generative engine optimization" → comparison, alternatives,
 * implementation, buyer_guide are all valid angles on the same commercial
 * keyword) — so keywords are reused round-robin (least-used first) rather
 * than claimed once and discarded. With N qualified keywords and 30 slots,
 * a `keyword: null` slot must never happen just because N < 30; it only
 * happens when NO keyword in the pool structurally fits ANY eligible format
 * at all. Angle-level anti-duplication for a reused keyword is handled
 * downstream by dedupeTopics' (keyword, angle) pair tracking — this layer's
 * only job is to never leave a slot keyword-less while a fitting keyword
 * exists. Shared by the daily rotation (ensureWindow, below) and the /test
 * calendar diagnostic so both exercise the same pairing.
 */
export function assignKeywordsToSlots(
  pool: { keyword: string; intent?: string | null; origin?: string | null }[],
  slots: { date: string; type: ContentType }[],
  eligibleFormats: ContentType[],
): CalendarSlot[] {
  const normalised = pool.map((k) => ({ keyword: k.keyword, intent: resolveSlotIntent(k) }));
  const useCount = new Array(normalised.length).fill(0);
  // Both gates must hold: a format the intent is allowed on, AND at least one
  // natural editorial angle for that (intent, format) pair — angleFitsIntent
  // returns [] rather than a fallback angle, so an empty set here must be
  // treated the same as a format mismatch, never assigned anyway. Among
  // keywords that fit, pick the least-used one so all 30 slots spread across
  // the whole pool instead of exhausting keyword[0] before touching keyword[1].
  const findFor = (format: ContentType) => {
    let best = -1;
    for (let i = 0; i < normalised.length; i++) {
      const k = normalised[i]!;
      if (!formatFitsKeyword(k.intent, format) || angleFitsIntent(k.intent, format).length === 0) continue;
      if (best < 0 || useCount[i]! < useCount[best]!) best = i;
    }
    return best;
  };

  return slots.map((slot) => {
    // The slot's own rotation-assigned format first, then the business's
    // other eligible formats in order — inverting the old "format decided
    // before any keyword is considered" behaviour.
    const tryOrder = [slot.type, ...eligibleFormats.filter((f) => f !== slot.type)];
    for (const format of tryOrder) {
      const index = findFor(format);
      if (index >= 0) {
        useCount[index]!++;
        const picked = normalised[index]!;
        return { ...slot, type: format, keyword: picked.keyword, intent: picked.intent, angle: null };
      }
    }
    return { ...slot, keyword: null, intent: null, angle: null };
  });
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
    .gte("relevance_score", 75)
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
  const { planTopics, summariseTopicGeneration } = await import("./plan.server");
  const { buildContentStrategy } = await import("./strategy.server");

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
    eligible,
  );

  const topics = await planTopics(brief, slots);
  const byDate = new Map(slots.map((s) => [s.date, s.keyword]));

  // /test's diagnostic calendar stage has hard invariants (strategy
  // eligibility, completeness, fallback rate) that this production path never
  // had — it silently shipped whatever planTopics returned. Per the rule that
  // the app must stay functional for the merchant, this only logs; a
  // production calendar is never blocked or rolled back on these. It is what
  // turns a future "why is my calendar mechanical" report into a Vercel log
  // line instead of requiring a fresh /test run to even see the counters.
  const gen = summariseTopicGeneration(topics);
  if (gen.fallbackRate > 0.25) {
    console.warn("[ensureWindow] high calendar fallback rate", { projectId: project.id, ...gen });
  }
  const strategy = buildContentStrategy(project.business_profile ?? {});
  const strategyViolations = topics.filter((t) => !strategy.formats[t.type]?.eligible);
  if (strategyViolations.length) {
    console.error("[ensureWindow] strategy violation: slot assigned an ineligible format", {
      projectId: project.id,
      violations: strategyViolations.map((t) => ({ date: t.date, type: t.type })),
    });
  }
  const orphaned = topics.filter((t) => !t.keyword || !t.intent || !t.type || !t.angle);
  if (orphaned.length) {
    console.error("[ensureWindow] orphaned slot(s): missing keyword/intent/format/angle", {
      projectId: project.id,
      count: orphaned.length,
      dates: orphaned.map((t) => t.date),
    });
  }

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
