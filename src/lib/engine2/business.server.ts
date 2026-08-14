import { askJson, asArray, asString } from "./ai.server";
import type { BusinessProfile, BusinessType } from "./types";
import type { PageInfo } from "./plumbing.server";

const TYPES: BusinessType[] = ["saas","ecommerce","local_business","service","agency","manufacturer","wholesaler","marketplace","other"];

export function pagesDigest(pages: PageInfo[], limit = 8) {
  return pages.slice(0, limit).map((p) => `- ${p.url}\n  title: ${p.title}\n  meta: ${p.metaDescription}\n  h1: ${p.h1}\n  h2/h3: ${p.headings.slice(0,8).join(" | ")}\n  termes: ${p.topTerms.join(", ")}`).join("\n");
}

export async function understandBusiness(apiKey: string, input: { domain: string; lang: string; pages: PageInfo[]; text: string }): Promise<BusinessProfile> {
  const raw = await askJson<Record<string, unknown>>(apiKey,
    "Tu es analyste business. Tu extrais uniquement ce qui est explicitement présent sur le site.",
    `Site: ${input.domain} (langue ${input.lang}).\n\nPages:\n${pagesDigest(input.pages)}\n\nExtrait du contenu:\n${input.text.slice(0,5000)}\n\nRenvoie ce JSON exact :\n{\n "businessType": "saas|ecommerce|local_business|service|agency|manufacturer|wholesaler|marketplace|other",\n "companyName": string,\n "products": [string], "services": [string],\n "audiences": [string], "industries": [string],\n "valueProposition": [string],\n "locations": [string],\n "cms": string,\n "primaryTopics": [string],\n "commercialTopics": [string],\n "informationalTopics": [string],\n "entities": [string]\n}`);
  const type = asString(raw["businessType"], "other") as BusinessType;
  return {
    businessType: TYPES.includes(type) ? type : "other",
    companyName: asString(raw["companyName"], input.domain),
    domain: input.domain,
    products: asArray<string>(raw["products"]), services: asArray<string>(raw["services"]), audiences: asArray<string>(raw["audiences"]), industries: asArray<string>(raw["industries"]), valueProposition: asArray<string>(raw["valueProposition"]),
    locations: asArray<string>(raw["locations"]).filter(Boolean), cms: asString(raw["cms"]) || undefined,
    primaryTopics: asArray<string>(raw["primaryTopics"]), commercialTopics: asArray<string>(raw["commercialTopics"]), informationalTopics: asArray<string>(raw["informationalTopics"]), entities: asArray<string>(raw["entities"]),
  };
}
