import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Probes behind /test — one per stage of the research pipeline, so a failing
 * stage can be seen on its own instead of being inferred from an empty scan.
 *
 * Every probe requires a session: they fetch an arbitrary URL server-side and
 * the last three spend real DataForSEO and model credits.
 */

const siteInput = z.object({ website: z.string().min(3).max(300) });

/**
 * `String(err)` on a plain object (not an Error instance) produces the
 * useless "[object Object]" — exactly what a Vercel platform-level failure
 * (a 504 timeout, a non-Error rejection from the RPC layer) throws as. Every
 * catch block in this file and in /test's client code funnels through this
 * so a stage's error box always shows something diagnosable instead of that
 * literal string.
 */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const asRecord = err as Record<string, unknown>;
    const nested = asRecord["message"] ?? (asRecord["error"] as Record<string, unknown> | string | undefined);
    if (typeof nested === "string") return nested;
    if (nested && typeof nested === "object") {
      const inner = (nested as Record<string, unknown>)["message"];
      if (typeof inner === "string") return inner;
    }
    const details = asRecord["details"];
    if (typeof details === "string") return details;
    try {
      return JSON.stringify(err);
    } catch {
      /* fall through */
    }
  }
  return String(err);
}

/** A storefront theme's html lang is often English even on a French shop. */
function marketLocale(website: string, declared: string | null | undefined) {
  try {
    const host = new URL(website.startsWith("http") ? website : `https://${website}`).hostname.toLowerCase();
    const byTld: Record<string, string> = { ".fr": "fr", ".es": "es", ".de": "de", ".it": "it", ".nl": "nl", ".pt": "pt" };
    const match = Object.entries(byTld).find(([tld]) => host.endsWith(tld));
    if (match) return match[1];
  } catch {
    /* validation happens in the scraper */
  }
  return declared?.slice(0, 2).toLowerCase() || "en";
}

export type PipelineDiagnosticStage = {
  id: "landing" | "profile" | "keywords" | "serp" | "rivals" | "calendar" | "article";
  ok: boolean;
  ms: number;
  summary: string;
  error: string | null;
  data: unknown;
};

type DiagnosticBatch = PipelineDiagnosticStage["id"];
type DiagnosticContext = {
  website: string;
  site?: any;
  profile?: any;
  writingLocale?: string;
  qualified?: any[];
  competitors?: any[];
  localCompetitors?: any[];
  rivals?: any[];
  calendar?: any[];
};

const diagnosticBatchInput = z.object({
  website: z.string().min(3).max(300),
  batch: z.enum(["landing", "profile", "keywords", "serp", "rivals", "calendar", "article"]),
  context: z.unknown().optional(),
});

function diagnosticContext(website: string, value: unknown): DiagnosticContext {
  const context = value && typeof value === "object" ? value as DiagnosticContext : { website };
  if (context.website !== website) throw new Error("Diagnostic context belongs to a different website.");
  return context;
}

function missingBatchInput(batch: DiagnosticBatch): never {
  throw new Error(`Run the previous diagnostic batch before ${batch}.`);
}

/**
 * The interactive full run deliberately makes one server request per batch.
 * It prevents a 30-day article preview from keeping a DataForSEO/LLM request
 * alive long enough to time out and preserves every successful result client-side.
 */
export const runPipelineDiagnosticBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => diagnosticBatchInput.parse(input))
  .handler(async ({ data }): Promise<{ stage: PipelineDiagnosticStage; context: DiagnosticContext }> => {
    const context = diagnosticContext(data.website, data.context);
    const started = Date.now();
    const finish = (summary: string, result: unknown, next: DiagnosticContext) => ({
      stage: { id: data.batch, ok: true, ms: Date.now() - started, summary, error: null, data: JSON.parse(JSON.stringify(result)) },
      context: next,
    });
    try {
      if (data.batch === "landing") {
        const { scrapeSite } = await import("./scrape.server");
        const site = await scrapeSite(data.website);
        return finish(`${site.landing?.title ? "SEO title found" : "SEO title missing"}; ${site.landing?.bodyExcerpt.length ?? 0} characters of page copy`, site, { website: data.website, site });
      }
      if (data.batch === "profile") {
        if (!context.site) missingBatchInput(data.batch);
        const { buildCanonicalProfile } = await import("./relevance.server");
        const { getEligibleFormats } = await import("./geo");
        const profile = await buildCanonicalProfile(context.site, { website_url: data.website });
        if (!profile.reliable) throw new Error("The canonical profile did not find enough verified business evidence.");
        const eligible = getEligibleFormats(profile);
        return finish(
          `${profile.sales_model ?? "unknown sales model"}; ${profile.products?.length ?? 0} confirmed product categories; entity=${profile.primary_entity ?? "n/a"}; eligible formats=${eligible.join(", ")}`,
          profile,
          { ...context, profile },
        );
      }
      if (data.batch === "keywords") {
        if (!context.site || !context.profile) missingBatchInput(data.batch);
        const { candidateKeywords, scoreRelevance, MIN_RELEVANCE, MIN_USABLE_KEYWORDS, MIN_QUALIFIED_KEYWORDS, TARGET_CANDIDATES, hasMeasurableDemand } = await import("./relevance.server");
        const { searchVolumeFor } = await import("./dataforseo.server");
        const { localeOpts, requireLiveDataForSeo, classifyIntent } = await import("./research.server");
        await requireLiveDataForSeo();
        const proposed = await candidateKeywords(context.profile, context.site.landing ?? null, TARGET_CANDIDATES);
        if (!proposed.length) throw new Error("The AI returned no buyer-query candidates from this landing page.");
        const writingLocale = marketLocale(data.website, context.site.landing?.lang);
        const measured = (await searchVolumeFor(proposed, localeOpts(writingLocale))).map((row) => ({
          ...row,
          intent: row.intent ?? classifyIntent(row.keyword),
        }));
        if (!measured.length) throw new Error("DataForSEO returned no measured search volume for the AI candidates.");
        // Score relevance only for keywords that actually have search-volume
        // data — a null-volume keyword can't be used regardless of how
        // relevant it reads, and this makes the drop-off between stages
        // (no market data vs. off-topic) visible instead of one opaque
        // "measured -> qualified" number.
        const withDemand = measured.filter(hasMeasurableDemand);
        if (!withDemand.length) throw new Error(`${measured.length} candidate(s) measured, but none had real search-volume data (all null).`);
        const scores = await scoreRelevance(context.profile, withDemand.map((row) => row.keyword));
        const scored = withDemand.map((row) => ({ ...row, relevance_score: scores[row.keyword.toLowerCase()] ?? 0 }));
        const relevant = scored.filter((row) => (row.relevance_score ?? 0) >= MIN_RELEVANCE);
        // Logged unconditionally, before any throw below, so a hard-fail run
        // is still diagnosable from server logs instead of only reporting
        // its final count with no way to tell which stage actually lost
        // the keywords (DataForSEO demand vs. the relevance gate).
        console.info("[test:keywords] stage breakdown", {
          website: data.website,
          proposed: proposed.length,
          measured: measured.length,
          withDemand: withDemand.length,
          relevancePassed: relevant.length,
          withDemandKeywords: withDemand.map((r) => ({ keyword: r.keyword, search_volume: r.search_volume })),
          scoredBelowThreshold: scored.filter((r) => (r.relevance_score ?? 0) < MIN_RELEVANCE).map((r) => ({ keyword: r.keyword, relevance_score: r.relevance_score })),
        });
        if (!relevant.length) throw new Error(`${withDemand.length} keyword(s) had real search-volume data, but none matched this business's buyer profile (relevance gate).`);
        const qualified = relevant;
        if (qualified.length < MIN_USABLE_KEYWORDS) {
          throw new Error(
            `Only ${qualified.length} keyword(s) had real, measurable demand and passed the relevance gate — not enough reliable search data to plan from.`,
          );
        }
        const warning =
          qualified.length < MIN_QUALIFIED_KEYWORDS
            ? `Only ${qualified.length} qualified keyword(s) (ideal is ${MIN_QUALIFIED_KEYWORDS}+) — the calendar will diversify angles per keyword instead of drawing from a wide pool.`
            : null;
        // Every rejected candidate with why, so a thin scan is diagnosable
        // instead of a single opaque count: was it no market data at all
        // (no_volume) or genuinely off-topic (irrelevant)?
        const rejected = [
          ...measured.filter((row) => !hasMeasurableDemand(row)).map((row) => ({ keyword: row.keyword, reason: "no_volume" as const })),
          ...scored.filter((row) => (row.relevance_score ?? 0) < MIN_RELEVANCE).map((row) => ({ keyword: row.keyword, reason: "irrelevant" as const })),
        ];
        const result = { proposed, measured, withDemand: withDemand.length, relevancePassed: relevant.length, qualified, rejected, warning };
        return finish(
          `${proposed.length} proposed; ${measured.length} measured; ${withDemand.length} with volume; ${relevant.length} relevant; ${qualified.length} qualified${warning ? ` — ${warning}` : ""}`,
          result,
          { ...context, writingLocale, qualified },
        );
      }
      if (data.batch === "serp") {
        if (!context.profile || !context.qualified?.length) missingBatchInput(data.batch);
        const { discoverCompetitorsFromSerp } = await import("./research.server");
        const competitors = await discoverCompetitorsFromSerp(context.profile, context.writingLocale ?? "en", null, null, 8, context.qualified.slice(0, 5).map((row) => row.keyword), 5);
        if (!competitors.length) throw new Error("No SERP competitor candidates were found across the commercial queries.");
        return finish(`${competitors.length} SERP candidate domains (confirmation happens after landing-page analysis)`, competitors, { ...context, competitors });
      }
      if (data.batch === "rivals") {
        if (!context.competitors?.length || !context.profile || !context.qualified?.length) missingBatchInput(data.batch);
        const { analyseCompetitorLandings } = await import("./research.server");
        const { isLocalEligible } = await import("./geo");
        const { defaultCountryForLanguage } = await import("./industries");
        const organicRivals = await analyseCompetitorLandings(context.competitors.map((row) => row.domain), 5);
        // A Google Maps local-pack search is meaningless for a business with no
        // confirmed location — running it anyway for Ranki.ai (locations: [])
        // is what surfaced "Content Creation Studios" in Lewisville and an NYC
        // SEO agency as its "rivals", and was also the single slowest stage
        // (~27s) because of the extra SerpApi Maps round trip.
        const locallyEligible = isLocalEligible(context.profile);
        let localMarket: Awaited<ReturnType<typeof import("./local-market.server").researchLocalMarket>> | null = null;
        if (locallyEligible) {
          const { researchLocalMarket } = await import("./local-market.server");
          localMarket = await researchLocalMarket({
            business: context.profile,
            locale: context.writingLocale ?? "en",
            targetCountry: defaultCountryForLanguage(context.writingLocale),
            buyerKeywords: context.qualified.slice(0, 5).map((row) => row.keyword),
            limit: 3,
          });
        }
        const localPack = localMarket?.competitors.slice(0, 3) ?? [];
        const localDomains = localPack.map((row) => row.domain).filter((domain): domain is string => Boolean(domain));
        const localRivals = localDomains.length ? await analyseCompetitorLandings(localDomains, 3) : [];
        const rivals = Array.from(new Map([...organicRivals, ...localRivals].map((row) => [row.domain, row])).values());
        if (!rivals.length && !localPack.length && locallyEligible) throw new Error("No competitor landing pages or Local Pack businesses could be read.");
        if (!rivals.length && !locallyEligible) throw new Error("No competitor landing pages could be read, and this business has no confirmed location to search Google Maps for.");
        const result = {
          organicLandingPages: organicRivals,
          locallyEligible,
          localLocation: localMarket?.location ?? null,
          localPack,
          localLandingPages: localRivals,
          localQueries: localMarket?.localQueries ?? [],
          localGaps: localMarket?.gaps ?? [],
        };
        const summary = locallyEligible
          ? `${organicRivals.length} organic rival pages + ${localPack.length} top Google Maps businesses`
          : `${organicRivals.length} organic rival pages — Google Maps skipped, no confirmed location`;
        return finish(summary, result, { ...context, rivals, localCompetitors: localPack });
      }
      if (data.batch === "calendar") {
        if (!context.profile || !context.qualified?.length) missingBatchInput(data.batch);
        const { planWindow, getEligibleFormats } = await import("./geo");
        const { planTopics, validateCalendarTopic } = await import("./plan.server");
        const { assignKeywordsToSlots } = await import("./rotation.server");
        const { buildContentStrategy } = await import("./strategy.server");
        const brief = { name: context.profile.name ?? new URL(data.website).hostname, website_url: data.website, industry: context.profile.industry ?? null, audience: context.profile.audience ?? null, tone: "expert", locale: context.writingLocale ?? "en", keywords: context.qualified.map((row) => row.keyword), locations: context.profile.locations ?? null, profile: context.profile };
        const eligible = getEligibleFormats(context.profile);
        const strategy = buildContentStrategy(context.profile);
        console.info("[pipeline-diagnostic] content strategy", strategy.formats);
        const slots = assignKeywordsToSlots(
          context.qualified.map((row) => ({ keyword: row.keyword, intent: row.intent, origin: row.origin })),
          planWindow(new Date(), 30, eligible).map((slot) => ({ date: slot.date, type: slot.type })),
          eligible,
        );
        const calendar = await planTopics(brief, slots);
        const invalid = calendar.find((item) => { const c = validateCalendarTopic(brief, item, item.topic); return !c.keywordAligned || !c.formatFit || !c.angleFit || !c.titleNonEmpty || !c.titleNatural || !c.locationValid; });
        if (invalid) throw new Error(`Calendar mismatch: \"${invalid.keyword}\" -> \"${invalid.topic}\"`);
        // Completeness invariant: with fewer qualified keywords than days,
        // assignKeywordsToSlots must CYCLE the pool (reuse each keyword
        // across several compatible format/angle combos) rather than leaving
        // a slot orphaned once every keyword has been used once. A null
        // keyword/intent past the first N slots, or a date/number appended to
        // force uniqueness instead of a genuinely different angle, both mean
        // the planner silently gave up instead of reusing the pool.
        const orphaned = calendar.filter((item) => !item.keyword || !item.intent || !item.type || !item.angle);
        if (orphaned.length) {
          throw new Error(
            `Calendar completeness violation: ${orphaned.length}/${calendar.length} slot(s) missing keyword/intent/format/angle (first: ${orphaned[0]!.date}).`,
          );
        }
        // Strategy invariant: every assigned format must be the same one
        // buildContentStrategy independently declares eligible with a reason —
        // this is what would have caught the Vends-Le contradiction (Local AEO
        // assigned to a slot despite has_physical_location/has_service_area
        // both false) structurally, instead of only being visible in a
        // human-reviewed live report.
        const strategyViolation = calendar.find((item) => !strategy.formats[item.type]?.eligible);
        if (strategyViolation) {
          throw new Error(
            `Strategy violation: slot ${strategyViolation.date} assigned format "${strategyViolation.type}", which buildContentStrategy declares ineligible.`,
          );
        }
        const uniqueTitles = new Set(calendar.map((item) => item.topic.trim().toLowerCase()));
        if (uniqueTitles.size !== calendar.length) {
          throw new Error(`Calendar completeness violation: ${calendar.length - uniqueTitles.size} duplicate title(s) among ${calendar.length} slots.`);
        }
        // Diagnostic only, never fails the stage: a high fallback rate can be
        // legitimate (e.g. a marketing-topic AI title correctly rejected), but
        // making it visible is what lets a future domain's "templates in
        // series" symptom be diagnosed as an AI-path failure instead of guessed at.
        const { summariseTopicGeneration } = await import("./plan.server");
        const gen = summariseTopicGeneration(calendar);
        const reasonBreakdown = Object.entries(gen.byReason)
          .sort((a, b) => b[1] - a[1])
          .map(([reason, count]) => `${reason}=${count}`)
          .join(", ");
        if (gen.fallbackRate > 0.25) {
          // Diagnostic only — never fails the stage. A high rate can be
          // legitimate, but WHICH reason dominates is what distinguishes a bad
          // strategy from a broken AI path (a provider error, or every title
          // rejected by one check).
          console.warn("[pipeline-diagnostic] high calendar fallback rate", gen);
        }
        return finish(
          `${calendar.length} planned topics — eligible formats: ${eligible.join(", ")} — AI: ${gen.aiAccepted}, fallback: ${gen.fallbackUsed} (${Math.round(gen.fallbackRate * 100)}%)` +
            (reasonBreakdown ? ` — reasons: ${reasonBreakdown}` : ""),
          calendar,
          { ...context, calendar },
        );
      }
      if (!context.profile || !context.calendar?.length || !context.rivals?.length) missingBatchInput(data.batch);
      const { writeArticle } = await import("./plan.server");
      const first = context.calendar[0]!;
      const article = await writeArticle({ name: context.profile.name ?? new URL(data.website).hostname, website_url: data.website, industry: context.profile.industry ?? null, audience: context.profile.audience ?? null, tone: "expert", locale: context.writingLocale ?? "en", keywords: [context.qualified?.[0]?.keyword ?? ""] }, { content_type: first.type, topic: first.topic, angle: first.angle }, { profile: context.profile, competitors: context.rivals, qualityMode: "report" });
      return finish(article.quality.ok ? `Article preview generated: ${article.title}` : `Completed with quality failures: ${article.quality.failures.join("; ")}`, article, context);
    } catch (error) {
      const message = errorMessage(error);
      console.error("[pipeline-diagnostic] batch failed", { id: data.batch, website: data.website, error: message, stack: error instanceof Error ? error.stack : undefined });
      return { stage: { id: data.batch, ok: false, ms: Date.now() - started, summary: "Failed", error: message, data: null }, context };
    }
  });

/**
 * One URL, one complete run. Each dependency is recorded independently so a
 * failure such as a blocked page, malformed AI response or DataForSEO outage
 * remains observable instead of collapsing into "0 competitors".
 */
export const runPipelineDiagnostic = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => siteInput.parse(input))
  .handler(async ({ data }): Promise<{ stages: PipelineDiagnosticStage[] }> => {
    const stages: PipelineDiagnosticStage[] = [];
    const take = async <T,>(
      id: PipelineDiagnosticStage["id"],
      work: () => Promise<T>,
      summary: (value: T) => string,
    ): Promise<T | null> => {
      const started = Date.now();
      console.info("[pipeline-diagnostic] stage started", { id, website: data.website });
      try {
        const value = await work();
        // Server-function transport accepts JSON values only. Keep the runtime
        // diagnostic payload deliberately serializable so a rich provider
        // result can never turn a useful stage error into an opaque HTTP 500.
        const safeData = JSON.parse(JSON.stringify(value)) as unknown;
        stages.push({ id, ok: true, ms: Date.now() - started, summary: summary(value), error: null, data: safeData });
        console.info("[pipeline-diagnostic] stage completed", { id, ms: Date.now() - started });
        return value;
      } catch (error) {
        console.error("[pipeline-diagnostic] stage failed", {
          id,
          website: data.website,
          error: errorMessage(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        stages.push({
          id,
          ok: false,
          ms: Date.now() - started,
          summary: "Failed",
          error: errorMessage(error),
          data: null,
        });
        return null;
      }
    };

    const { scrapeSite } = await import("./scrape.server");
    const site = await take("landing", () => scrapeSite(data.website), (value) => {
      const landing = value.landing;
      return `${landing?.title ? "SEO title found" : "SEO title missing"}; ${landing?.bodyExcerpt.length ?? 0} characters of page copy`;
    });
    if (!site) return { stages };

    const { buildCanonicalProfile, candidateKeywords, scoreRelevance, MIN_RELEVANCE, MIN_QUALIFIED_KEYWORDS, TARGET_CANDIDATES, hasMeasurableDemand } = await import("./relevance.server");
    const profile = await take("profile", () => buildCanonicalProfile(site, { website_url: data.website }), (value) =>
      `${value.sales_model ?? "unknown sales model"}; ${value.products?.length ?? 0} confirmed product categories`,
    );
    if (!profile?.reliable) {
      if (profile) stages[stages.length - 1]!.ok = false;
      return { stages };
    }

    const { searchVolumeFor } = await import("./dataforseo.server");
    const { localeOpts, discoverCompetitorsFromSerp, analyseCompetitorLandings, requireLiveDataForSeo } = await import("./research.server");
    const keywordStage = await take("keywords", async () => {
      await requireLiveDataForSeo();
      const proposed = await candidateKeywords(profile, site.landing ?? null, TARGET_CANDIDATES);
      if (!proposed.length) throw new Error("The AI returned no buyer-query candidates from this landing page.");
      const locale = marketLocale(data.website, site.landing?.lang);
      const opts = localeOpts(locale);
      const measured = await searchVolumeFor(proposed, opts);
      if (!measured.length) {
        throw new Error(
          `DataForSEO returned no measured search volume for ${proposed.length} AI candidates in ${opts.locationName} / ${opts.languageCode}. First candidates: ${proposed.slice(0, 5).join(" | ")}`,
        );
      }
      const scores = await scoreRelevance(profile, measured.map((row) => row.keyword));
      const qualified = measured.filter((row) => (scores[row.keyword.toLowerCase()] ?? 0) >= MIN_RELEVANCE && hasMeasurableDemand(row));
      if (!qualified.length) throw new Error("Every measurable keyword failed the business-audience relevance gate.");
      if (qualified.length < MIN_QUALIFIED_KEYWORDS) {
        throw new Error(
          `Only ${qualified.length} keyword(s) had real, measurable demand (not null) and passed the relevance gate — need at least ${MIN_QUALIFIED_KEYWORDS} to plan a non-repetitive 30-day calendar.`,
        );
      }
      return { proposed, measured, qualified };
    }, (value) => `${value.proposed.length} proposed; ${value.measured.length} measured; ${value.qualified.length} qualified`);
    if (!keywordStage) return { stages };

    const writingLocale = marketLocale(data.website, site.landing?.lang);
    const competitors = await take("serp", () =>
      discoverCompetitorsFromSerp(
        profile,
        writingLocale,
        null,
        null,
        8,
        // /test is an interactive diagnostic, not a production batch. One
        // representative buyer query plus five landing profiles prevents a
        // single server request from timing out before it can report a stage.
        keywordStage.qualified.slice(0, 1).map((row) => row.keyword),
        5,
      ),
    (value) => `${value.length} buyer-matched competitors from Google, DataForSEO and SerpApi`);
    if (!competitors?.length) return { stages };

    const rivals = await take("rivals", () => analyseCompetitorLandings(competitors.map((row) => row.domain), 5), (value) =>
      `${value.length} rival landing pages read for article-generation context`,
    );
    if (!rivals?.length) return { stages };

    // Preview only: plan the next 30 days from the validated market output.
    // No project, content item, article or external destination is written.
    const { planWindow, getEligibleFormats } = await import("./geo");
    const { planTopics, validateCalendarTopic, writeArticle } = await import("./plan.server");
    const eligibleFormats = getEligibleFormats(profile);
    const calendar = await take("calendar", async () => {
      const slots = planWindow(new Date(), 30, eligibleFormats).map((slot, index) => ({
        ...slot,
        keyword: keywordStage.qualified[index % keywordStage.qualified.length]?.keyword ?? null,
      }));
      const brief = {
        name: profile.name ?? new URL(data.website).hostname,
        website_url: data.website,
        industry: profile.industry ?? null,
        audience: profile.audience ?? null,
        tone: "expert",
        locale: writingLocale,
        keywords: keywordStage.qualified.map((row) => row.keyword),
        locations: profile.locations ?? null,
        profile,
      };
      const planned = await planTopics(brief, slots);
      const validation = planned.map((item) => ({
        targetKeyword: item.keyword ?? "",
        contentType: item.type,
        topic: item.topic,
        ...validateCalendarTopic(brief, item, item.topic),
      }));
      console.info("[pipeline-diagnostic] calendar target alignment", validation);
      const invalid = validation.find((item) => !item.keywordAligned || !item.formatFit || !item.angleFit || !item.titleNonEmpty || !item.titleNatural || !item.locationValid);
      if (invalid) {
        throw new Error(`Calendar mismatch: \"${invalid.targetKeyword}\" -> \"${invalid.topic}\"`);
      }
      return planned;
    }, (value) => `${value.length} planned topics derived from validated buyer keywords`);
    if (!calendar?.length) return { stages };

    await take("article", async () => {
      const first = calendar[0]!;
      return writeArticle(
        {
          name: profile.name ?? new URL(data.website).hostname,
          website_url: data.website,
          industry: profile.industry ?? null,
          audience: profile.audience ?? null,
          tone: "expert",
          locale: writingLocale,
          keywords: [keywordStage.qualified[0]!.keyword],
        },
        { content_type: first.type, topic: first.topic },
        { profile, competitors: rivals },
      );
    }, (value) => `Article preview generated: ${value.title}`);
    return { stages };
  });

/** Stage 1 — landing page. No API cost: one HTTP GET. */
export const probeLanding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => siteInput.parse(input))
  .handler(async ({ data }) => {
    const { scrapeLandingProfile } = await import("./scrape.server");
    const started = Date.now();
    const landing = await scrapeLandingProfile(data.website);
    return { landing, ms: Date.now() - started };
  });

/** Stage 2 — canonical profile + the sales-model call that sets the audience. */
export const probeProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => siteInput.parse(input))
  .handler(async ({ data }) => {
    const { scrapeSite } = await import("./scrape.server");
    const { buildCanonicalProfile } = await import("./relevance.server");
    const started = Date.now();
    const site = await scrapeSite(data.website);
    const profile = await buildCanonicalProfile(site, { website_url: data.website });
    return {
      profile,
      landingSaysB2B: site.landing?.sellsToBusinesses ?? false,
      b2bMarkers: site.landing?.b2bMarkers ?? [],
      ms: Date.now() - started,
    };
  });

/** Stage 3 + 4 — AI proposes candidates, DataForSEO measures them. */
export const probeCandidates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => siteInput.extend({ locale: z.string().max(8).optional() }).parse(input))
  .handler(async ({ data }) => {
    const { scrapeSite } = await import("./scrape.server");
    const { buildCanonicalProfile, candidateKeywords, TARGET_CANDIDATES } = await import("./relevance.server");
    const { searchVolumeFor } = await import("./dataforseo.server");
    const { localeOpts } = await import("./research.server");
    const started = Date.now();

    const site = await scrapeSite(data.website);
    const profile = await buildCanonicalProfile(site, { website_url: data.website });
    const proposed = await candidateKeywords(profile, site.landing ?? null, TARGET_CANDIDATES);

    const opts = localeOpts(data.locale ?? marketLocale(data.website, site.landing?.lang));
    let measured: { keyword: string; search_volume: number | null }[] = [];
    let volumeError: string | null = null;
    try {
      measured = await searchVolumeFor(proposed, opts);
    } catch (e) {
      // Surfaced rather than swallowed: this endpoint has never run against the
      // live API, and a silent [] is indistinguishable from "nothing matched".
      volumeError = e instanceof Error ? e.message : String(e);
    }
    return {
      salesModel: profile.sales_model ?? null,
      proposed: proposed.slice(0, 60),
      measured: measured.slice(0, 60),
      volumeError,
      opts,
      ms: Date.now() - started,
    };
  });

/** Stage 5 — SERP features, including whether an AI assistant answers. */
export const probeSerpAi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ keyword: z.string().min(2).max(120), locale: z.string().max(8).optional() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { serpWithAiSignals } = await import("./dataforseo.server");
    const { localeOpts } = await import("./research.server");
    const started = Date.now();
    try {
      const { organic, ai } = await serpWithAiSignals(data.keyword, localeOpts(data.locale ?? null), 20);
      return { ai, topOrganic: organic.slice(0, 5), error: null, ms: Date.now() - started };
    } catch (error) {
      const message = errorMessage(error);
      console.error("[pipeline-diagnostic] standalone SERP failed", { keyword: data.keyword, message, stack: error instanceof Error ? error.stack : undefined });
      return {
        ai: { keyword: data.keyword, hasAiOverview: false, aiOverviewText: null, citedDomains: [], hasFeaturedSnippet: false, hasPeopleAlsoAsk: false, featureTypes: [] },
        topOrganic: [], error: message, ms: Date.now() - started,
      };
    }
  });

/** Stage 6 — rival landing pages. No API cost: one HTTP GET each. */
export const probeRivals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ domains: z.array(z.string().min(3).max(200)).min(1).max(6) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { analyseCompetitorLandings } = await import("./research.server");
    const started = Date.now();
    const rivals = await analyseCompetitorLandings(data.domains, data.domains.length);
    return { rivals, requested: data.domains.length, ms: Date.now() - started };
  });
