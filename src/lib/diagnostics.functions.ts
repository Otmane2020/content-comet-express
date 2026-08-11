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
      try {
        const value = await work();
        stages.push({ id, ok: true, ms: Date.now() - started, summary: summary(value), error: null, data: value });
        return value;
      } catch (error) {
        stages.push({
          id,
          ok: false,
          ms: Date.now() - started,
          summary: "Failed",
          error: error instanceof Error ? error.message : String(error),
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

    const { buildCanonicalProfile, candidateKeywords, scoreRelevance, MIN_RELEVANCE } = await import("./relevance.server");
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
      const proposed = await candidateKeywords(profile, site.landing ?? null, 120);
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
      const qualified = measured.filter((row) => (scores[row.keyword.toLowerCase()] ?? 0) >= MIN_RELEVANCE);
      if (!qualified.length) throw new Error("Every measurable keyword failed the business-audience relevance gate.");
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
        keywordStage.qualified.slice(0, 8).map((row) => row.keyword),
      ),
    (value) => `${value.length} buyer-matched competitors from Google, DataForSEO and SerpApi`);
    if (!competitors?.length) return { stages };

    const rivals = await take("rivals", () => analyseCompetitorLandings(competitors.map((row) => row.domain), 5), (value) =>
      `${value.length} rival landing pages read for article-generation context`,
    );
    if (!rivals?.length) return { stages };

    // Preview only: plan the next 30 days from the validated market output.
    // No project, content item, article or external destination is written.
    const { planWindow } = await import("./geo");
    const { planTopics, writeArticle } = await import("./plan.server");
    const calendar = await take("calendar", async () => {
      const slots = planWindow(new Date(), 30).map((slot, index) => ({
        ...slot,
        keyword: keywordStage.qualified[index % keywordStage.qualified.length]?.keyword ?? null,
      }));
      return planTopics(
        {
          name: profile.name ?? new URL(data.website).hostname,
          website_url: data.website,
          industry: profile.industry ?? null,
          audience: profile.audience ?? null,
          tone: "expert",
          locale: writingLocale,
          keywords: keywordStage.qualified.map((row) => row.keyword),
        },
        slots,
      );
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
    const { buildCanonicalProfile, candidateKeywords } = await import("./relevance.server");
    const { searchVolumeFor } = await import("./dataforseo.server");
    const { localeOpts } = await import("./research.server");
    const started = Date.now();

    const site = await scrapeSite(data.website);
    const profile = await buildCanonicalProfile(site, { website_url: data.website });
    const proposed = await candidateKeywords(profile, site.landing ?? null, 60);

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
    const { organic, ai } = await serpWithAiSignals(data.keyword, localeOpts(data.locale ?? null), 20);
    return { ai, topOrganic: organic.slice(0, 5), ms: Date.now() - started };
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
