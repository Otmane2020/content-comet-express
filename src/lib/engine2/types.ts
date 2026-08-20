// Shared, client-safe types + deterministic scoring for the Article Intelligence Engine.

export type BusinessType = "saas" | "ecommerce" | "local_business" | "service" | "agency" | "manufacturer" | "wholesaler" | "marketplace" | "other";
export interface BusinessProfile { businessType: BusinessType; companyName: string; domain: string; products: string[]; services: string[]; audiences: string[]; industries: string[]; valueProposition: string[]; locations: string[]; cms?: string | undefined; primaryTopics: string[]; commercialTopics: string[]; informationalTopics: string[]; entities: string[]; }
export type CompetitorType = "direct" | "adjacent" | "platform" | "marketplace";
export interface SemanticCompetitor { name: string; domain: string; reason: string; competitorType: CompetitorType; relevanceScore: number; }
export type OverlapClassification = "competitor" | "publisher" | "directory" | "marketplace" | "community" | "authority" | "unknown";
export interface SerpOverlapDomain { domain: string; organicKeywords: number | null; organicTraffic: number | null; intersections: number | null; classification: OverlapClassification; }
export type KeywordSource = "semantic_competitor" | "dataforseo" | "site" | "search_console" | "serp_gap" | "ai_discovery";
export type SearchIntent = "informational" | "commercial" | "transactional" | "navigational" | "local";
export type KeywordState = "candidate" | "measured" | "relevance_validated" | "opportunity_scored" | "selected";
export interface KeywordOpportunity { keyword: string; source: KeywordSource; state: KeywordState; volume: number | null; cpc: number | null; competition: number | null; intent: SearchIntent; relevanceScore: number; businessValueScore: number; opportunityScore: number; validated: boolean; rejectionReason?: string | undefined; reason?: string | undefined; }
export type RankedKeywordStrategy = "protect" | "improve" | "refresh" | "expand" | "ignore";
export interface RankedKeywordInsight { keyword: string; volume: number | null; position: number | null; strategy: RankedKeywordStrategy; }
export type ContentFormat = "SEO" | "GEO" | "AEO" | "LOCAL_AEO" | "SHOPPING";
export interface FormatDecision { format: ContentFormat; reason: string; blockPlan: ArticleBlock["type"][]; }
export interface ArticleBrief { targetKeyword: string; secondaryKeywords: string[]; format: ContentFormat; searchIntent: string; title: string; angle: string; targetAudience: string; questions: string[]; entities: string[]; outline: { heading: string; goal: string }[]; internalLinks: { url: string; anchorSuggestion: string }[]; competitorInsights: string[]; conversionGoal: string; wordCountTarget: { min: number; max: number }; }
export interface TitleValidation { valid: boolean; score: number; reason: string; attempts: number; }
export type Grounding = "FACT_FROM_WEBSITE" | "FACT_FROM_DATAFORSEO" | "FACT_FROM_SERP" | "GENERAL_KNOWLEDGE" | "UNVERIFIED";
export type ArticleBlock =
  | { type: "hero"; eyebrow: string; title: string; subtitle: string; readingTime: string }
  | { type: "answer"; text: string; grounding: Grounding }
  | { type: "keyTakeaways"; items: string[] }
  | { type: "heading"; level: 2 | 3; text: string }
  | { type: "paragraph"; text: string; grounding?: Grounding }
  | { type: "bulletList"; items: string[] }
  | { type: "numberedList"; items: string[] }
  | { type: "quote"; text: string; source?: string }
  | { type: "stat"; value: string; label: string; grounding: Grounding }
  | { type: "comparisonTable"; caption?: string; columns: string[]; rows: string[][] }
  | { type: "productGrid"; items: { name: string; description: string; priceNote?: string }[] }
  | { type: "callout"; tone: "info" | "warning" | "ai"; title: string; text: string }
  | { type: "image"; url: string; alt: string; caption?: string }
  | { type: "faq"; items: { question: string; answer: string }[] }
  | { type: "ctaInline"; text: string; label: string; href?: string }
  | { type: "locationCard"; location: string; serviceArea: string[]; note: string };
export interface ArticleQuality { relevance: number; intentMatch: number; factualGrounding: number; structure: number; readability: number; seo: number; geo: number; aeo: number; internalLinking: number; brandFit: number; overall: number; passed: boolean; errors: string[]; warnings: string[]; }
export interface GeneratedArticle { id: string; title: string; slug: string; targetKeyword: string; format: ContentFormat; excerpt: string; blocks: ArticleBlock[]; faq: { question: string; answer: string }[]; internalLinks: string[]; citedEntities: string[]; seo: { title: string; description: string }; heroImage?: { url: string; alt: string } | undefined; quality: ArticleQuality; status: "draft" | "approved" | "scheduled" | "published" | "failed"; }
export interface StageCounter { label: string; count: number | string; detail?: string | undefined; }
export interface EngineRun { ok: boolean; failedStage?: string | undefined; error?: string | undefined; counters: StageCounter[]; business: BusinessProfile | null; semanticCompetitors: SemanticCompetitor[]; rejectedCompetitors: SemanticCompetitor[]; serpOverlap: SerpOverlapDomain[]; opportunities: KeywordOpportunity[]; rejectedKeywords: KeywordOpportunity[]; rankedInsights: RankedKeywordInsight[]; selected: KeywordOpportunity | null; formatDecision: FormatDecision | null; brief: ArticleBrief | null; titleValidation: TitleValidation | null; article: GeneratedArticle | null; sources: { websitePages: string[]; dataforseo: string[]; serp: string[]; competitors: string[] }; notes: string[]; }
export function computeOpportunityScore(k: { relevanceScore: number; businessValueScore: number; volume: number | null; competition: number | null }): number { const relevance = clamp(k.relevanceScore) * 0.4; const value = clamp(k.businessValueScore) * 0.3; const demand = k.volume == null ? 0 : clamp((Math.log10(Math.max(k.volume, 1)) / 4) * 100) * 0.2; const competition = k.competition == null ? 0 : clamp(100 - k.competition) * 0.1; return Math.round(relevance + value + demand + competition); }
export const RELEVANCE_FLOOR = 65; export const COMPETITOR_FLOOR = 70; export const TITLE_FLOOR = 75;
function clamp(n: number) { return Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0)); }
export function slugify(input: string) { return input.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80); }
