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
      { title: "Create an application password", detail: "Scroll to \u201cApplication Passwords\u201d, type the name AutopilotGEO and click \u201cAdd New\u201d." },
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
      { title: "Users → Profile", detail: "In the \u201cApplication Passwords\u201d section, enter the name AutopilotGEO, then click \u201cAdd New\u201d." },
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
    time: "4 min",
    summary:
      "We publish to a Shopify blog through the Admin API. You need a custom app with the write_content scope and your blog ID.",
    steps: [
      { title: "Create a custom app", detail: "Shopify admin → Settings → Apps and sales channels → Develop apps → Create an app." },
      { title: "Allow content writing", detail: "Configuration → Admin API → tick write_content and read_content, then Save." },
      { title: "Install and copy the token", detail: "API credentials tab → Install app → copy the Admin API access token (shpat_…)." },
      { title: "Get the blog ID", detail: "Admin → Content → Blog posts → open your blog: the ID is the number at the end of the URL (…/blogs/123456789)." },
      { title: "Fill in the form", detail: "Shop domain = mystore.myshopify.com, Blog ID, Admin API token." },
    ],
    docUrl: "https://help.shopify.com/en/manual/apps/app-types/custom-apps",
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
  },
};
