import type { PlatformId } from "./geo";

export type PublishPayload = {
  title: string;
  slug: string;
  excerpt: string;
  html: string;
  markdown: string;
  contentType: string;
  scheduledDate: string;
};

export type PublishResult = { url: string | null; message: string };

type Config = Record<string, string | undefined>;

const clean = (url: string) => url.replace(/\/+$/, "");

async function readError(res: Response) {
  const text = await res.text();
  return `[${res.status}] ${text.slice(0, 400)}`;
}

async function publishWordpress(config: Config, payload: PublishPayload): Promise<PublishResult> {
  const site = config["site_url"];
  const user = config["username"];
  const pass = config["app_password"];
  if (!site || !user || !pass) throw new Error("WordPress needs site URL, username and application password");

  const res = await fetch(`${clean(site)}/wp-json/wp/v2/posts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${btoa(`${user}:${pass}`)}`,
    },
    body: JSON.stringify({
      title: payload.title,
      slug: payload.slug,
      excerpt: payload.excerpt,
      content: payload.html,
      status: "publish",
    }),
  });
  if (!res.ok) throw new Error(`WordPress refused the post ${await readError(res)}`);
  const data = (await res.json()) as { link?: string };
  return { url: data.link ?? null, message: "Published on WordPress" };
}

async function publishShopify(config: Config, payload: PublishPayload): Promise<PublishResult> {
  const shop = config["shop"];
  const blogId = config["blog_id"];
  const token = config["access_token"];
  if (!shop || !blogId || !token) throw new Error("Shopify needs shop domain, blog id and admin token");

  const res = await fetch(
    `https://${clean(shop).replace(/^https?:\/\//, "")}/admin/api/2024-10/blogs/${blogId}/articles.json`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({
        article: {
          title: payload.title,
          body_html: payload.html,
          summary_html: payload.excerpt,
          handle: payload.slug,
          published: true,
        },
      }),
    },
  );
  if (!res.ok) throw new Error(`Shopify refused the article ${await readError(res)}`);
  const data = (await res.json()) as { article?: { id?: number; handle?: string } };
  return {
    url: data.article?.handle ? `https://${shop}/blogs/news/${data.article.handle}` : null,
    message: "Published on the Shopify blog",
  };
}

async function publishPrestashop(config: Config, payload: PublishPayload): Promise<PublishResult> {
  const site = config["site_url"];
  const key = config["api_key"];
  if (!site || !key) throw new Error("PrestaShop needs shop URL and webservice key");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop>
  <content>
    <meta_title><![CDATA[${payload.title}]]></meta_title>
    <meta_description><![CDATA[${payload.excerpt}]]></meta_description>
    <link_rewrite><![CDATA[${payload.slug}]]></link_rewrite>
    <content><![CDATA[${payload.html}]]></content>
    <active>1</active>
  </content>
</prestashop>`;

  const res = await fetch(`${clean(site)}/api/content_management_system`, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml",
      Authorization: `Basic ${btoa(`${key}:`)}`,
    },
    body: xml,
  });
  if (!res.ok) throw new Error(`PrestaShop refused the page ${await readError(res)}`);
  return { url: `${clean(site)}/content/${payload.slug}`, message: "Published on PrestaShop" };
}

async function publishWebhook(config: Config, payload: PublishPayload): Promise<PublishResult> {
  const endpoint = config["endpoint"];
  if (!endpoint) throw new Error("Add the endpoint URL of your site");

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config["secret"] ? { "x-autopilot-secret": config["secret"]! } : {}),
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Your endpoint refused the article ${await readError(res)}`);
  const text = await res.text();
  let url: string | null = null;
  try {
    url = (JSON.parse(text) as { url?: string }).url ?? null;
  } catch {
    url = null;
  }
  return { url, message: "Sent to your site endpoint" };
}

export function publishTo(
  platform: PlatformId,
  config: Config,
  payload: PublishPayload,
): Promise<PublishResult> {
  switch (platform) {
    case "wordpress":
    case "woocommerce":
      return publishWordpress(config, payload);
    case "shopify":
      return publishShopify(config, payload);
    case "prestashop":
      return publishPrestashop(config, payload);
    case "webhook":
      return publishWebhook(config, payload);
    default:
      throw new Error(`Unsupported platform: ${platform as string}`);
  }
}