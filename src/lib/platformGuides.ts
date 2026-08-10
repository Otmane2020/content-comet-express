import type { PlatformId } from "@/lib/geo";

export type PlatformGuide = {
  time: string;
  summary: string;
  steps: { title: string; detail: string }[];
  tips?: string[];
  docUrl?: string;
  /** Ready-to-paste prompt for AI builders (Lovable, Bolt, Replit…). */
  prompt?: string;
};

export const PLATFORM_GUIDES: Record<PlatformId, PlatformGuide> = {
  wordpress: {
    time: "2 min",
    summary:
      "We publish through the official WordPress REST API. No plugin to install — all you need is an application password.",
    steps: [
      { title: "Open your WordPress admin", detail: "Go to https://yoursite.com/wp-admin, then Users → Profile (your administrator account)." },
      { title: "Create an application password", detail: "Scroll to \u201cApplication Passwords\u201d, type the name Ranki.ai and click \u201cAdd New\u201d." },
      { title: "Copy the generated code", detail: "WordPress shows something like \u201cabcd efgh ijkl mnop\u201d. It appears only once — copy it right away." },
      { title: "Paste your details here", detail: "Site URL = your website address, Username = your WordPress login, Application password = the code you copied." },
    ],
    tips: [
      "If the section is missing, your site must run on HTTPS (WordPress 5.6+).",
      "Articles land as drafts or published depending on your autopilot setting.",
    ],
    docUrl: "https://wordpress.org/documentation/article/application-passwords/",
  },
  woocommerce: {
    time: "2 min",
    summary:
      "A WooCommerce store is still a WordPress site: we publish blog articles through the store's WordPress REST API.",
    steps: [
      { title: "Sign in to your store admin", detail: "https://yourstore.com/wp-admin with an administrator account." },
      { title: "Users → Profile", detail: "In the \u201cApplication Passwords\u201d section, enter the name Ranki.ai, then click \u201cAdd New\u201d." },
      { title: "Copy the generated password", detail: "It is shown only once. Keep it handy." },
      { title: "Fill in the form", detail: "Store URL, Username and Application password. We test the connection instantly." },
    ],
    tips: ["Buying guides and product articles boost the store's shopping SEO."],
    docUrl: "https://wordpress.org/documentation/article/application-passwords/",
  },
  prestashop: {
    time: "3 min",
    summary:
      "PrestaShop exposes a webservice. Create a key with write access to content (CMS / blog).",
    steps: [
      { title: "Enable the webservice", detail: "Back office → Advanced Parameters → Webservice → set \u201cEnable PrestaShop webservice\u201d to Yes." },
      { title: "Add a key", detail: "Click \u201cAdd new webservice key\u201d, then \u201cGenerate\u201d to create the key." },
      { title: "Set the permissions", detail: "Tick at least View + Add + Modify on the content / cms resources (and blog if you use a module)." },
      { title: "Save, then copy the key", detail: "Paste your shop URL and the webservice key into the form." },
    ],
    tips: ["If you use a third-party blog module, enable its resources in the permissions too."],
    docUrl: "https://devdocs.prestashop-project.org/8/webservice/tutorials/creating-access/",
  },
  shopify: {
    time: "1 min",
    summary:
      "One-click install: approve the Ranki app in your Shopify admin and you land back on the dashboard, connected. We pick your blog automatically.",
    steps: [
      { title: "Enter your shop domain", detail: "mystore.myshopify.com — nothing else to prepare." },
      { title: "Install the app", detail: "Shopify asks you to approve blog + product access for Ranki." },
      { title: "Back to the dashboard", detail: "You are redirected here automatically and the store shows as Connected." },
      { title: "Blog chosen for you", detail: "We use your existing blog, or create a “News” blog if the store has none." },
      { title: "Prefer a manual token?", detail: "Use “Use a custom app token instead” to paste a shpat_… Admin API token and blog ID." },
    ],
    docUrl: "https://help.shopify.com/en/manual/apps/app-types/custom-apps",
  },
  supabase: {
    time: "3 min",
    summary:
      "The simplest setup for a Lovable, Bolt or Replit site: create an articles table in your own Supabase project and we write each article straight into it. No endpoint, no secret header.",
    steps: [
      { title: "Create the articles table", detail: "Paste the prompt below into Lovable / Bolt / Replit — it creates the table, the blog pages and the sitemap entries." },
      { title: "Copy your project URL", detail: "It looks like https://xxxxxxxx.supabase.co (Lovable Cloud shows it as your backend URL)." },
      { title: "Copy the service role key", detail: "The server-side key of the same project. Keep it private — we store it encrypted and only use it to insert articles." },
      { title: "Paste both here", detail: "Project URL + service role key (and optionally your site URL so we can store the live link)." },
    ],
    tips: [
      "We upsert on slug, so re-publishing an article updates it instead of duplicating it.",
      "Nothing to deploy on your side: as soon as the row lands, your /blog page shows the article.",
    ],
    prompt: [
      "Add a public blog powered by Supabase, filled automatically by Ranki.ai.",
      "",
      "1) Supabase migration — create the articles table:",
      "   create table public.articles (",
      "     id uuid primary key default gen_random_uuid(),",
      "     title text not null,",
      "     slug text not null unique,",
      "     excerpt text,",
      "     markdown text,",
      "     html text,",
      "     cover_url text,",
      "     keywords text[] not null default '{}',",
      "     content_type text,",
      "     published_at timestamptz not null default now(),",
      "     created_at timestamptz not null default now()",
      "   );",
      "   grant select on public.articles to anon, authenticated;",
      "   grant all on public.articles to service_role;",
      "   alter table public.articles enable row level security;",
      "   create policy \"Articles are public\" on public.articles for select to anon, authenticated using (true);",
      "   (No insert policy on purpose: Ranki.ai writes with the service role key.)",
      "",
      "2) Blog pages:",
      "   /blog — list the articles newest first (cover image, title, excerpt).",
      "   /blog/:slug — render the html (fallback to markdown), with SEO title, meta description,",
      "   canonical URL, Open Graph image = cover_url and Article JSON-LD.",
      "   Add every article slug to sitemap.xml, and list the blog in a public /llms.txt",
      "   (title + 1-line description per article) so AI answer engines can read it directly.",
      "",
      "3) Nothing else to build: no API route, no webhook, no secret.",
      "   Then give me the Supabase project URL and the service role key so I can paste them into Ranki.ai.",
    ].join("\n"),
  },
  webhook: {
    time: "5 min",
    summary:
      "For a Lovable, Bolt, Replit, Next.js or headless site: we POST each article as JSON to your endpoint. You decide what to do with it.",
    steps: [
      { title: "Create a public route", detail: "For example /api/public/articles, accepting a POST request with a JSON body." },
      { title: "Expect this payload", detail: "{ title, slug, excerpt, markdown, html, cover_url, keywords[], published_at }" },
      { title: "Secure it with a secret", detail: "We send the x-autopilot-secret header — check its value before saving the article." },
      { title: "Paste the URL here", detail: "Endpoint URL plus the same secret. A 200 response counts as a successful publish." },
    ],
    tips: ["Respond in under 10s, otherwise the publish is marked as failed and retried."],
    prompt: [
      "Create a public article-ingest endpoint for Ranki.ai, backed by Supabase.",
      "",
      "1) Database (Supabase migration):",
      "   Create table public.articles with columns: id uuid primary key default gen_random_uuid(),",
      "   title text not null, slug text not null unique, excerpt text, markdown text,",
      "   html text, cover_url text, keywords text[] default '{}', content_type text,",
      "   published_at timestamptz not null default now(), created_at timestamptz not null default now().",
      "   Then: GRANT SELECT ON public.articles TO anon, authenticated;",
      "   GRANT ALL ON public.articles TO service_role;",
      "   ALTER TABLE public.articles ENABLE ROW LEVEL SECURITY;",
      "   CREATE POLICY \"Articles are public\" ON public.articles FOR SELECT TO anon, authenticated USING (true);",
      "   (No insert policy: writes happen server-side with the service role key.)",
      "",
      "2) Endpoint: a PUBLIC POST route at /api/public/articles (no auth gate).",
      "   - Read the header x-autopilot-secret and compare it to the AUTOPILOT_SECRET env var.",
      "     If it does not match, return 401.",
      "   - Parse the JSON body:",
      "     { title, slug, excerpt, markdown, html, cover_url, keywords, published_at, content_type }",
      "   - Upsert into public.articles on slug using the Supabase service role key (server-side only).",
      "   - Return 200 with JSON { url: \"https://YOURSITE.com/blog/\" + slug } so Ranki.ai can store the live link.",
      "   - Always answer in under 10 seconds.",
      "",
      "3) Blog pages: /blog listing the articles (newest first, cover image + title + excerpt)",
      "   and /blog/$slug rendering the html, with SEO title, meta description, canonical URL",
      "   and Article JSON-LD. Add every slug to sitemap.xml, and list the blog in a public",
      "   /llms.txt (title + 1-line description per article) so AI answer engines can read it directly.",
      "",
      "4) Store AUTOPILOT_SECRET as a secret and tell me its value so I can paste it into Ranki.ai.",
    ].join("\n"),
  },
};
