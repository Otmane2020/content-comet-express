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

    const opts = localeOpts(data.locale ?? site.landing?.lang ?? profile.locations?.[0] ?? null);
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
