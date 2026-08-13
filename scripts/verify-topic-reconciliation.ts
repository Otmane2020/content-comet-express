/**
 * Proves — at zero API cost — why the AI topic path contributes 0 of 30 titles.
 *
 * planTopics() is only reachable through a billed AI call, which is why a 100%
 * rejection rate went unnoticed across four different businesses. reconcileTopics()
 * is the same accept/reject decision as a pure function, so it can be fed a
 * SIMULATED response instead.
 *
 * The three cases differ only in what the model echoes back as `contentType`.
 * If case 1 and case 2 differ by nothing but letter case and produce opposite
 * outcomes, the enum-vs-label mismatch is proven to be load-bearing.
 *
 * Run: npx tsx scripts/verify-topic-reconciliation.ts
 */
import { readFileSync } from "node:fs";
import { getEligibleFormats, planWindow, TYPE_META, type ContentType } from "../src/lib/geo";
import { assignKeywordsToSlots } from "../src/lib/rotation.server";
import { reconcileTopics, stripModelFaqSection, summariseTopicGeneration, type ProjectBrief } from "../src/lib/plan.server";

// Captured verbatim from the trust-avis.com pipeline report (2026-08-13).
const PROFILE = {
  description:
    "Trust Avis est une plateforme en ligne qui permet de consulter et comparer plus de 540 000 avis clients vérifiés pour des entreprises en France, Belgique et Suisse.",
  sales_model: "marketplace",
  products: [] as string[],
  services: [
    "Consultation d'avis clients vérifiés",
    "Comparaison d'entreprises",
    "Recherche des meilleures entreprises",
    "Authentification des avis clients",
  ],
  locations: ["France", "Belgique", "Suisse"],
  primary_entity: "marketplace" as const,
  has_physical_location: false,
  has_service_area: false,
};

const QUALIFIED = [
  "avis clients vérifiés",
  "meilleures entreprises suisse",
  "avis clients authentiques",
  "plateforme avis clients",
  "avis clients france",
  "avis clients en ligne",
  "meilleures entreprises france",
  "meilleures entreprises belgique",
  "avis clients fiables",
  "avis clients certifiés",
  "avis clients contrôlés",
].map((keyword) => ({ keyword, intent: "commercial", origin: null }));

const brief: ProjectBrief = {
  name: "Trust Avis",
  website_url: "trust-avis.com",
  industry: null,
  audience: "Clients cherchant des entreprises et entreprises cherchant à collecter des avis",
  tone: "expert",
  locale: "fr",
  keywords: QUALIFIED.map((k) => k.keyword),
  locations: PROFILE.locations,
  profile: PROFILE,
};

const eligible = getEligibleFormats(PROFILE);
const slots = assignKeywordsToSlots(
  QUALIFIED,
  planWindow(new Date("2026-08-13"), 30, eligible).map((w) => ({ date: w.date, type: w.type as ContentType })),
  eligible,
);

/**
 * A plausible natural AI title. Keeps the keyword's own words so it passes
 * keywordAligned, and adds no location the keyword didn't already request, so
 * the ONLY variable across cases 1 and 2 is the contentType value.
 */
const naturalTitle = (keyword: string) => `${keyword} : comment bien choisir en 2026`;

const CASES = [
  {
    name: '1. contentType = TYPE_META label ("GEO") — what the prompt actually shows the model',
    contentTypeFor: (slot: (typeof slots)[number]) => TYPE_META[slot.type].label,
    title: naturalTitle,
    predict: "30/30 fallback, reason identity_format_mismatch",
  },
  {
    name: '2. contentType = raw enum ("geo") — the value the check compares against',
    contentTypeFor: (slot: (typeof slots)[number]) => slot.type as string,
    title: naturalTitle,
    predict: "30/30 accepted as AI",
  },
  {
    name: '3. raw enum + a market/country name in the title (isolates the location check)',
    contentTypeFor: (slot: (typeof slots)[number]) => slot.type as string,
    title: (keyword: string) => `${keyword} : le comparatif en France pour 2026`,
    predict: "isolates how much location_invalid additionally rejects on this profile",
  },
];

let anyUnexpected = false;

for (const testCase of CASES) {
  const simulated = slots.map((slot) => ({
    date: slot.date,
    keyword: slot.keyword ?? "",
    contentType: testCase.contentTypeFor(slot),
    topic: testCase.title(slot.keyword ?? ""),
  }));

  const reconciled = reconcileTopics(brief, slots, simulated);
  const summary = summariseTopicGeneration(reconciled);

  console.log(`\n=== ${testCase.name} ===`);
  console.log(`   predicted: ${testCase.predict}`);
  console.log(
    `   actual:    AI ${summary.aiAccepted}/${summary.aiRequested}, fallback ${summary.fallbackUsed} (${Math.round(summary.fallbackRate * 100)}%)`,
  );
  const reasons = Object.entries(summary.byReason);
  console.log(`   reasons:   ${reasons.length ? reasons.map(([r, n]) => `${r}=${n}`).join(", ") : "none"}`);
  const sample = reconciled[0];
  if (sample) {
    console.log(
      `   sample:    [${sample.type}] source=${sample.generationSource} reason=${sample.fallbackReason ?? "-"} :: ${sample.topic}`,
    );
  }
  if (summary.aiRequested !== 30) anyUnexpected = true;
}

// --- Guard: loosening the location check must NOT disarm it for a business
// that genuinely IS local. A confirmed address/service area means an injected
// city on a non-local day is still an accidental local page and must be rejected.
const LOCAL_PROFILE = {
  description: "Plomberie d'urgence à Lyon",
  sales_model: "service",
  products: [] as string[],
  services: ["dépannage plomberie", "installation chaudière"],
  locations: ["Lyon"],
  primary_entity: "service" as const,
  has_physical_location: true,
  has_service_area: true,
};
const localKeywords = [
  { keyword: "prix intervention plombier", intent: "commercial", origin: null },
  { keyword: "comment déboucher des toilettes", intent: "informational", origin: null },
];
const localEligible = getEligibleFormats(LOCAL_PROFILE);
const localSlots = assignKeywordsToSlots(
  localKeywords,
  planWindow(new Date("2026-08-13"), 30, localEligible).map((w) => ({ date: w.date, type: w.type as ContentType })),
  localEligible,
);
const localBrief: ProjectBrief = {
  name: "Plomberie Lyon",
  website_url: null,
  industry: null,
  audience: null,
  tone: "expert",
  locale: "fr",
  keywords: localKeywords.map((k) => k.keyword),
  locations: LOCAL_PROFILE.locations,
  profile: LOCAL_PROFILE,
};
// Inject "Lyon" into titles whose keyword never asked for it, on non-local days.
const localSimulated = localSlots
  .filter((s) => s.type !== "local_aeo")
  .map((slot) => ({
    date: slot.date,
    keyword: slot.keyword ?? "",
    contentType: slot.type as string,
    topic: `${slot.keyword} : notre guide à Lyon pour 2026`,
  }));
const localReconciled = reconcileTopics(
  localBrief,
  localSlots.filter((s) => s.type !== "local_aeo"),
  localSimulated,
);
const localSummary = summariseTopicGeneration(localReconciled);
const guardHeld = (localSummary.byReason["location_invalid"] ?? 0) === localReconciled.length;
if (!guardHeld) anyUnexpected = true;

console.log(`\n=== 4. GUARD: genuinely local business, city injected on non-local days ===`);
console.log(`   predicted: every slot rejected with location_invalid (the rule must still bite)`);
console.log(
  `   actual:    AI ${localSummary.aiAccepted}/${localSummary.aiRequested}, reasons: ${Object.entries(localSummary.byReason).map(([r, n]) => `${r}=${n}`).join(", ") || "none"} -> ${guardHeld ? "GUARD HELD" : "GUARD BROKEN"}`,
);

// --- 5. FAQ duplication, checked against the real body_md the pipeline shipped.
const capturedBody = readFileSync(new URL("./fixtures/trust-avis-article.md", import.meta.url), "utf8");
const countQuestions = (text: string) => {
  const counts = new Map<string, number>();
  for (const m of text.matchAll(/^###\s+(.+)$/gm)) counts.set(m[1]!.trim(), (counts.get(m[1]!.trim()) ?? 0) + 1);
  return counts;
};
const before = countQuestions(capturedBody);
const beforeDupes = [...before.values()].filter((n) => n > 1).length;
// Reproduce the writer's assembly: strip whatever FAQ the model wrote, then
// append the canonical structured FAQ exactly once.
const stripped = stripModelFaqSection(capturedBody, "Questions fréquentes");
const canonicalFaq = [...before.keys()].slice(0, 5);
const reassembled = `${stripped}\n\n## Questions fréquentes\n\n${canonicalFaq.map((q) => `### ${q}\n\nRéponse.`).join("\n\n")}`;
const after = countQuestions(reassembled);
const afterDupes = [...after.values()].filter((n) => n > 1).length;
const faqFixed = beforeDupes > 0 && afterDupes === 0;
if (!faqFixed) anyUnexpected = true;

console.log(`\n=== 5. FAQ duplication (real captured Trust Avis body_md) ===`);
console.log(`   predicted: duplicated questions before, each exactly once after`);
console.log(
  `   actual:    duplicated questions before=${beforeDupes}, after=${afterDupes} -> ${faqFixed ? "FIXED" : "NOT FIXED"}`,
);

console.log(
  "\nInterpretation: cases 1 and 2 differ ONLY in the letter case of contentType.\n" +
    "Before the fix: case 1 = 0/30 (identity_format_mismatch x30), case 2 = 30/30.\n" +
    "After the fix: both accepted, case 3 no longer punishes a business for naming its own\n" +
    "market, and case 4 proves the location rule still applies to a real local footprint.",
);
process.exit(anyUnexpected ? 1 : 0);
