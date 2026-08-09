export const LANGUAGES = [
  { code: "en", label: "English", flag: "🇬🇧" },
  { code: "fr", label: "French", flag: "🇫🇷" },
  { code: "es", label: "Spanish", flag: "🇪🇸" },
  { code: "de", label: "German", flag: "🇩🇪" },
  { code: "it", label: "Italian", flag: "🇮🇹" },
  { code: "nl", label: "Dutch", flag: "🇳🇱" },
  { code: "pt", label: "Portuguese", flag: "🇵🇹" },
] as const;

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