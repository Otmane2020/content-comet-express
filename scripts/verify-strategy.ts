/**
 * Permanent regression suite for the evidence-driven ContentStrategy engine.
 * Zero API cost — no AI keys configured locally means callOpenRouter throws
 * and planTopics falls through to its deterministic fallback path, which is
 * exactly what this suite exercises.
 *
 * Every fixture's `expected` block is written BY HAND from its evidence,
 * never recomputed by calling isShoppingEligible()/isLocalEligible() and
 * asserting the result equals itself — that would let a regression in those
 * functions reproduce identically in the assertion and still pass. This is
 * the single most important property of this file: it tests the engine
 * against independent, pre-declared expectations, not against itself.
 *
 * Run: npx tsx scripts/verify-strategy.ts
 */
import { getEligibleFormats, planWindow, type ContentType } from "../src/lib/geo";
import { assignKeywordsToSlots } from "../src/lib/rotation.server";
import { planTopics, type ProjectBrief } from "../src/lib/plan.server";
import { formatFitsKeyword, resolveSlotIntent } from "../src/lib/angles.server";
import { buildContentStrategy } from "../src/lib/strategy.server";

type Fixture = {
  name: string;
  profile: NonNullable<ProjectBrief["profile"]> & {
    locations?: string[] | null;
    has_physical_location?: boolean;
    has_service_area?: boolean;
  };
  keywords: { keyword: string; intent: string; origin?: string }[];
  rivalWithBrandOverlap?: string;
  expected: { shopping: boolean; local_aeo: boolean };
};

// --- Six structural archetypes (not industries) ---------------------------
const STRUCTURAL_FIXTURES: Fixture[] = [
  {
    name: "A. Digital service, no catalogue, no location",
    profile: { description: "Project management SaaS", sales_model: "software", services: ["task tracking", "sprint planning"], primary_entity: "software" },
    expected: { shopping: false, local_aeo: false },
    keywords: [
      { keyword: "what is agile project management", intent: "informational" },
      { keyword: "best project management software", intent: "commercial" },
      { keyword: "project management software pricing", intent: "transactional" },
      { keyword: "asana vs monday", intent: "commercial" },
      { keyword: "how to run a sprint retrospective", intent: "informational" },
      { keyword: "project management tool for remote teams", intent: "commercial" },
      { keyword: "gantt chart software free trial", intent: "transactional" },
      { keyword: "kanban board explained", intent: "informational" },
    ],
  },
  {
    name: "B. Transactional catalogue business",
    profile: { description: "Online furniture store", sales_model: "ecommerce", products: ["sofas", "dining tables", "office chairs"], primary_entity: "product" },
    expected: { shopping: true, local_aeo: false },
    keywords: [
      { keyword: "canapé d angle prix", intent: "transactional" },
      { keyword: "meilleur canapé convertible", intent: "commercial" },
      { keyword: "comment choisir une table à manger", intent: "informational" },
      { keyword: "chaise de bureau ergonomique", intent: "commercial" },
      { keyword: "livraison meuble délai", intent: "transactional" },
      { keyword: "matériaux canapé durable", intent: "informational" },
      { keyword: "meubles design pas cher", intent: "commercial" },
    ],
  },
  {
    name: "C. Physical-location service",
    profile: { description: "Plumbing service in Lyon", sales_model: "service", services: ["emergency plumbing", "boiler repair"], primary_entity: "service", locations: ["Lyon"], has_physical_location: true, has_service_area: true },
    expected: { shopping: false, local_aeo: true },
    keywords: [
      { keyword: "plombier lyon urgence", intent: "local", origin: "local" },
      { keyword: "comment déboucher des toilettes", intent: "informational" },
      { keyword: "prix intervention plombier", intent: "transactional" },
      { keyword: "meilleur plombier près de chez moi", intent: "local", origin: "local" },
      { keyword: "chauffe eau ne fonctionne plus que faire", intent: "informational" },
      { keyword: "installation chaudière lyon", intent: "local", origin: "local" },
    ],
  },
  {
    name: "D. Marketplace, national-only, no physical presence (Vends-Le shape)",
    profile: { description: "Marketplace for used furniture between individuals", sales_model: "marketplace", products: ["meubles d'occasion"], services: [], primary_entity: "marketplace", locations: ["France"], has_physical_location: false, has_service_area: false },
    expected: { shopping: true, local_aeo: false },
    rivalWithBrandOverlap: "vends-toutfacile.fr", // shares "vends" with the fixture's own brand name below
    keywords: [
      { keyword: "vendre meuble en ligne", intent: "commercial" },
      { keyword: "meilleure plateforme pour vendre meubles occasion", intent: "commercial" },
      { keyword: "comment vendre un meuble rapidement", intent: "informational" },
      { keyword: "frais commission vente meuble en ligne", intent: "transactional" },
      { keyword: "annonce meuble occasion entre particuliers", intent: "commercial" },
    ],
  },
  {
    name: "E. B2B product supplier / wholesale",
    profile: { description: "Wholesale furniture supplier for retailers", sales_model: "wholesale", products: ["bulk furniture"], primary_entity: "marketplace" },
    expected: { shopping: true, local_aeo: false },
    keywords: [
      { keyword: "grossiste meubles france", intent: "commercial" },
      { keyword: "fournisseur mobilier professionnel prix", intent: "transactional" },
      { keyword: "comment devenir revendeur meubles", intent: "informational" },
      { keyword: "comparatif grossistes meubles", intent: "commercial" },
      { keyword: "commande minimum grossiste mobilier", intent: "transactional" },
    ],
  },
  {
    name: "F. Publisher/information business, no products or services",
    profile: { description: "Independent tech news publication", sales_model: "other", products: [], services: [], primary_entity: "other" },
    expected: { shopping: false, local_aeo: false },
    keywords: [
      { keyword: "what is generative engine optimization", intent: "informational" },
      { keyword: "best tech newsletters 2026", intent: "commercial" },
      { keyword: "how ai search is changing journalism", intent: "informational" },
      { keyword: "tech news aggregator comparison", intent: "commercial" },
      { keyword: "generative engine optimization strategy", intent: "informational" },
    ],
  },
];

// --- Captured real reports, kept as regression snapshots -------------------
const CAPTURED_FIXTURES: Fixture[] = [
  {
    name: "Captured: Ranki.ai (SaaS, GEO/AEO tooling)",
    profile: { description: "AI content automation SaaS", sales_model: "software", services: ["content generation", "keyword research"], primary_entity: "software" },
    expected: { shopping: false, local_aeo: false },
    keywords: [
      { keyword: "ai content generator for shopify", intent: "commercial" },
      { keyword: "how does generative engine optimization work", intent: "informational" },
      { keyword: "ai seo tool pricing", intent: "transactional" },
    ],
  },
  {
    name: "Captured: ClipMotion (AI video SaaS)",
    profile: { description: "AI-powered video generation platform for social media", sales_model: "other", services: ["AI video generation", "motion design videos", "AI influencers", "social content automation"], products: [], primary_entity: "software", locations: [], has_physical_location: false, has_service_area: false },
    expected: { shopping: false, local_aeo: false },
    keywords: [
      { keyword: "ai video generator", intent: "commercial" },
      { keyword: "ai video generator pricing", intent: "transactional" },
      { keyword: "how does ai video generator work", intent: "informational" },
    ],
  },
  {
    name: "Captured: Vends-Le (marketplace, France-only)",
    profile: { description: "Marketplace for used furniture between individuals, operates in France", sales_model: "marketplace", products: ["meubles d'occasion"], services: [], primary_entity: "marketplace", locations: ["France"], has_physical_location: false, has_service_area: false },
    expected: { shopping: true, local_aeo: false },
    keywords: [
      { keyword: "vendre meuble en ligne", intent: "commercial" },
      { keyword: "plateforme vente meuble occasion", intent: "commercial" },
    ],
  },
  {
    // Regression fixture: primary_entity="marketplace" alone used to also
    // qualify for shopping, conflating a GOODS marketplace (Vends-Le, above —
    // has products) with a marketplace of REVIEWS (no products at all). Trust
    // Avis got a live Shopping-format calendar slot that produced "compare
    // their pricing, delivery times and product range" for a business with
    // nothing to compare. isShoppingEligible() now requires products.length>0
    // or an ecommerce/wholesale sales_model — never the marketplace label by
    // itself.
    name: "Captured: Trust Avis (reviews marketplace, zero products)",
    profile: { description: "Verified customer review comparison platform", sales_model: "marketplace", products: [], services: ["avis clients vérifiés", "comparaison d'entreprises"], primary_entity: "marketplace", locations: ["France", "Belgique", "Suisse"], has_physical_location: false, has_service_area: false },
    expected: { shopping: false, local_aeo: false },
    keywords: [
      { keyword: "avis clients vérifiés", intent: "commercial" },
      { keyword: "plateforme d'avis clients", intent: "commercial" },
      { keyword: "meilleures entreprises france", intent: "commercial" },
    ],
  },
];

// --- Blind generalization fixture ------------------------------------------
// Designed AFTER buildContentStrategy/the fixture harness were implemented,
// representing a business-signal combination none of the six archetypes or
// three captured reports above used to shape the engine: a product catalogue
// AND services together, B2B+B2C mixed audience, quote-based (not
// e-commerce) sales_model, a physical location AND multiple named service
// regions at once. `expected` was written from the evidence alone, before
// this fixture was ever run. If this fails, the fix must be a change to the
// general evidence-reasoning logic (isShoppingEligible/isLocalEligible/
// buildContentStrategy) — never a special case for this fixture.
const BLIND_FIXTURE: Fixture = {
  name: "BLIND: industrial equipment manufacturer (catalogue + services, B2B+B2C, multi-region)",
  profile: {
    primary_entity: "product",
    sales_model: "other",
    products: ["woodworking machines", "spare parts"],
    services: ["installation", "maintenance", "repair"],
    locations: ["Ile-de-France", "Provence-Alpes-Côte d'Azur", "Nouvelle-Aquitaine"],
    has_physical_location: true,
    has_service_area: true,
  },
  expected: { shopping: true, local_aeo: true },
  keywords: [
    { keyword: "machine à bois professionnelle prix", intent: "transactional" },
    { keyword: "meilleure machine à bois pour atelier", intent: "commercial" },
    { keyword: "comment entretenir une machine à bois", intent: "informational" },
    { keyword: "installation machine industrielle ile de france", intent: "local", origin: "local" },
    { keyword: "réparation machine à bois provence", intent: "local", origin: "local" },
    { keyword: "pièces détachées machine à bois", intent: "transactional" },
  ],
};

async function run() {
  let totalViolations = 0;
  for (const fixture of [...STRUCTURAL_FIXTURES, ...CAPTURED_FIXTURES, BLIND_FIXTURE]) {
    const strategy = buildContentStrategy(fixture.profile ?? {});
    const eligible = getEligibleFormats(fixture.profile ?? {});
    const shoppingOk = strategy.formats.shopping.eligible === fixture.expected.shopping;
    const localOk = strategy.formats.local_aeo.eligible === fixture.expected.local_aeo;
    // Contract: reasons non-empty iff eligible.
    const shoppingReasonsOk = strategy.formats.shopping.eligible === (strategy.formats.shopping.reasons.length > 0);
    const localReasonsOk = strategy.formats.local_aeo.eligible === (strategy.formats.local_aeo.reasons.length > 0);
    const strategyOk = shoppingOk && localOk && shoppingReasonsOk && localReasonsOk;
    if (!strategyOk) totalViolations += 1;

    const window = planWindow(new Date("2026-08-13"), 30, eligible);
    const slots = assignKeywordsToSlots(
      fixture.keywords.map((k) => ({ keyword: k.keyword, intent: k.intent, origin: k.origin ?? null })),
      window.map((w) => ({ date: w.date, type: w.type as ContentType })),
      eligible,
    );
    const brandName = fixture.name;
    const rivals = fixture.rivalWithBrandOverlap ? [{ domain: fixture.rivalWithBrandOverlap, headings: [] as string[], positioning: "" }] : [];
    const brief: ProjectBrief = {
      name: brandName,
      website_url: null,
      industry: null,
      audience: null,
      tone: "expert",
      locale: "en",
      keywords: fixture.keywords.map((k) => k.keyword),
      locations: fixture.profile?.locations ?? null,
      profile: fixture.profile ?? null,
    };
    const topics = await planTopics(brief, slots);

    let formatViolations = 0;
    let strategyViolations = 0;
    let nullKeyword = 0;
    let nullIntent = 0;
    const titlesSeen = new Set<string>();
    let titleRepeats = 0;
    let doubleQuestions = 0;
    const angleCounts = new Map<string, number>();
    let aiCount = 0;
    let fallbackCount = 0;

    for (const t of topics as any[]) {
      if (!t.keyword) nullKeyword++;
      if (!t.intent) nullIntent++;
      const intent = resolveSlotIntent({ intent: t.intent, origin: null });
      if (t.keyword && !formatFitsKeyword(intent, t.type)) formatViolations++;
      if (!strategy.formats[t.type as ContentType]?.eligible) strategyViolations++;
      const norm = t.topic.toLowerCase();
      if (titlesSeen.has(norm)) titleRepeats++;
      titlesSeen.add(norm);
      const qMarks = (t.topic.match(/\?/g) ?? []).length;
      if (qMarks > 1) doubleQuestions++;
      if (t.angle) angleCounts.set(t.angle, (angleCounts.get(t.angle) ?? 0) + 1);
      if (t.generationSource === "ai") aiCount++;
      else fallbackCount++;
    }
    const dominantAngle = [...angleCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    const dominantShare = dominantAngle ? dominantAngle[1] / topics.length : 0;
    const angleDiversityOk = dominantShare <= 0.4;

    // Brand-isolation regression: a rival alias overlapping the brand name
    // must never mutate the brand name in any generated title.
    let brandCorrupted = false;
    if (fixture.rivalWithBrandOverlap) {
      const { writeArticle } = await import("../src/lib/plan.server");
      try {
        const article = await writeArticle(brief, { content_type: "geo", topic: `${brandName}: how it works` }, { profile: fixture.profile, competitors: rivals as any });
        brandCorrupted = !article.title.includes(brandName) && /another supplier/i.test(article.title + article.body_md);
      } catch {
        // AI call unavailable locally — writeArticle has no deterministic
        // fallback, so this check only runs where an AI key is configured.
      }
    }

    const pass = strategyOk && formatViolations === 0 && strategyViolations === 0 && titleRepeats === 0 && doubleQuestions === 0 && nullKeyword === 0 && nullIntent === 0 && angleDiversityOk && !brandCorrupted;
    if (!pass) totalViolations += formatViolations + strategyViolations + titleRepeats + doubleQuestions + nullKeyword + nullIntent + (angleDiversityOk ? 0 : 1) + (brandCorrupted ? 1 : 0);

    console.log(`\n=== ${fixture.name} (${pass ? "PASS" : "FAIL"}) ===`);
    console.log(`strategy: shopping=${strategy.formats.shopping.eligible} [${strategy.formats.shopping.reasons.join(", ") || "none"}] (expected ${fixture.expected.shopping}), local_aeo=${strategy.formats.local_aeo.eligible} [${strategy.formats.local_aeo.reasons.join(", ") || "none"}] (expected ${fixture.expected.local_aeo})`);
    console.log(`null keyword: ${nullKeyword}/30, null intent: ${nullIntent}/30, format violations: ${formatViolations}, strategy violations: ${strategyViolations}, title repeats: ${titleRepeats}, double-questions: ${doubleQuestions}, dominant angle: ${dominantAngle?.[0]} @ ${Math.round(dominantShare * 100)}%`);
    console.log(`generationSource — ai: ${aiCount}, fallback: ${fallbackCount}, fallbackRate: ${Math.round((fallbackCount / topics.length) * 100)}%${fixture.rivalWithBrandOverlap ? `, brand corrupted: ${brandCorrupted}` : ""}`);
  }
  // --- Product pages must be offered as internal-link targets (pure
  // function, zero cost): shopifyLinkTargets used to read only
  // collections/pages, so every article on every content type could never
  // link to a product page, on any business, ever.
  const { shopifyLinkTargets } = await import("../src/lib/netlinking.server");
  const linkTargets = shopifyLinkTargets({
    collections: [{ title: "Sofas", url: "https://example.com/collections/sofas" }],
    pages: [{ title: "About us", url: "https://example.com/pages/about" }],
    products_sample: [
      { title: "Oslo 3-Seat Sofa", url: "https://example.com/products/oslo-3-seat-sofa" },
      { title: "Malmo Armchair", url: "https://example.com/products/malmo-armchair" },
    ],
  });
  const hasProductLinks = linkTargets.some((t) => t.url.includes("/products/"));
  const hasCollectionLink = linkTargets.some((t) => t.url.includes("/collections/"));
  const hasPageLink = linkTargets.some((t) => t.url.includes("/pages/"));
  const netlinkingOk = hasProductLinks && hasCollectionLink && hasPageLink && linkTargets.length === 4;
  if (!netlinkingOk) totalViolations += 1;
  console.log(`\n=== Product internal-link targets (${netlinkingOk ? "PASS" : "FAIL"}) ===`);
  console.log(`  targets: ${linkTargets.map((t) => t.url).join(", ")}`);

  console.log(`\nTOTAL VIOLATIONS: ${totalViolations}`);
  process.exit(totalViolations > 0 ? 1 : 0);
}

run();
