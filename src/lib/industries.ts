/**
 * `country` is the default DataForSEO/Google Ads `location_name` for a
 * language when the merchant has not set a target country of their own — the
 * single source other modules should read instead of keeping their own
 * partial copy (research.server.ts and diagnostics.functions.ts used to each
 * hardcode a 7-of-17-language map, so the other 10 languages silently
 * defaulted to France).
 *
 * English defaults to the US market rather than the UK shown by its flag:
 * the UK flag is just the conventional icon for "English" in this picker.
 */
export const LANGUAGES = [
  { code: "en", label: "English", countryCode: "gb", country: "United States" },
  { code: "fr", label: "French", countryCode: "fr", country: "France" },
  { code: "es", label: "Spanish", countryCode: "es", country: "Spain" },
  { code: "de", label: "German", countryCode: "de", country: "Germany" },
  { code: "it", label: "Italian", countryCode: "it", country: "Italy" },
  { code: "nl", label: "Dutch", countryCode: "nl", country: "Netherlands" },
  { code: "pt", label: "Portuguese", countryCode: "pt", country: "Portugal" },
  { code: "pl", label: "Polish", countryCode: "pl", country: "Poland" },
  { code: "sv", label: "Swedish", countryCode: "se", country: "Sweden" },
  { code: "da", label: "Danish", countryCode: "dk", country: "Denmark" },
  { code: "no", label: "Norwegian", countryCode: "no", country: "Norway" },
  { code: "fi", label: "Finnish", countryCode: "fi", country: "Finland" },
  { code: "ro", label: "Romanian", countryCode: "ro", country: "Romania" },
  { code: "tr", label: "Turkish", countryCode: "tr", country: "Turkey" },
  { code: "ja", label: "Japanese", countryCode: "jp", country: "Japan" },
  { code: "ko", label: "Korean", countryCode: "kr", country: "South Korea" },
  { code: "ar", label: "Arabic", countryCode: "sa", country: "Saudi Arabia" },
] as const;

/** The default target-market country for a language code, "France" if unknown. */
export function defaultCountryForLanguage(locale: string | null | undefined): string {
  const code = (locale ?? "fr").slice(0, 2).toLowerCase();
  return LANGUAGES.find((l) => l.code === code)?.country ?? "France";
}

export const INDUSTRY_GROUPS: { group: string; items: string[] }[] = [
  {
    group: "Home & trades",
    items: ["Plumbing", "Electrician", "HVAC & heating", "Roofing", "Construction & renovation", "Landscaping", "Cleaning services", "Moving & storage"],
  },
  {
    group: "Retail & ecommerce",
    items: ["Fashion & apparel", "Beauty & cosmetics", "Jewelry & watches", "Home & furniture", "Food & beverage", "Pet products", "Sports & outdoor", "Electronics & gadgets"],
  },
  {
    group: "Professional services",
    items: ["Legal & law firm", "Accounting & bookkeeping", "Consulting", "Marketing agency", "Recruitment & HR", "Insurance", "Real estate", "Finance & fintech"],
  },
  {
    group: "Tech & SaaS",
    items: [
      "B2B SaaS",
      "SEO & GEO software",
      "AI search optimization",
      "Marketing software",
      "Analytics software",
      "E-commerce software",
      "Developer tools",
      "AI & data",
      "Cybersecurity",
      "E-learning & edtech",
      "Web & app agency",
    ],
  },
  {
    group: "Health & wellness",
    items: ["Dental", "Medical clinic", "Physiotherapy", "Fitness & gym", "Nutrition & supplements", "Mental health", "Spa & wellbeing"],
  },
  {
    group: "Hospitality & travel",
    items: ["Restaurant", "Hotel & lodging", "Travel agency", "Events & catering", "Tourism & activities"],
  },
  { group: "Other", items: ["Automotive", "Manufacturing & industry", "Non-profit", "Education", "Other"] },
];

export const ALL_INDUSTRIES = INDUSTRY_GROUPS.flatMap((g) => g.items);
