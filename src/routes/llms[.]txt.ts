import { createFileRoute } from "@tanstack/react-router";
import { BLOG_POSTS } from "@/lib/blog";

const SITE = "https://www.ranki.ai";

/**
 * llms.txt (https://llmstxt.org): a curated, machine-readable index of the
 * site for AI assistants and answer engines to read directly — the GEO
 * counterpart to robots.txt/sitemap.xml, which are built for classic search
 * crawlers, not for an LLM trying to summarise or cite the product.
 */
export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: {
      GET: async () => {
        const posts = BLOG_POSTS.map(
          (p) => `- [${p.title}](${SITE}/blog/${p.slug}): ${p.description}`,
        ).join("\n");

        const body = `# Ranki.ai

> Ranki.ai is an autopilot for AI SEO and GEO (Generative Engine Optimisation): it plans a rolling 30-day content calendar, writes and illustrates one article a day rotating GEO/SEO/AEO/Local AEO/Shopping formats, and auto-publishes to WordPress, WooCommerce, PrestaShop, Shopify or any custom site — so a business ranks on Google and gets cited by ChatGPT, Perplexity, Gemini and AI Overviews without daily manual work.

## Product
- [Homepage](${SITE}/): overview, how it works, publishing destinations.
- [Pricing](${SITE}/#pricing): $9.99/month (or $7.99/month billed yearly), one plan, everything included, no per-article billing.
- [Shopify App Store listing](https://apps.shopify.com/newai-seo-and-marketing-scale): install for Shopify stores — account, project and billing are set up automatically from the store.

## How it works
- A rolling 30-day plan: one piece per day, rotating GEO -> SEO -> AEO -> Local AEO -> Shopping. The window refills itself every day.
- Each article is written in the business's own language and tone, using its keywords, competitors' winning queries and Search Console data.
- Every slot lands as an editable draft; auto-publish per destination when trusted.
- Optional Google Business Profile posts and Search Console sync for local and technical SEO signals.

## Blog
${posts}

## Contact
- Support: via the in-app Help & contact page at ${SITE}/app.
`;

        return new Response(body, {
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      },
    },
  },
});
