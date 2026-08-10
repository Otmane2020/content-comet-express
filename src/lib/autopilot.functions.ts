import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { planWindow, slugify, type ContentType, type PlatformId } from "./geo";
import { renderMarkdown } from "./markdown";
import type { LocalInfoFacts } from "./shopifyProvision.server";

export const buildPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ projectId: z.string().uuid(), days: z.number().min(1).max(30).default(30) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { ensureWindow } = await import("./rotation.server");
    const { supabase, userId } = context;

    const { data: project, error } = await supabase
      .from("projects")
      .select("*")
      .eq("id", data.projectId)
      .single();
    if (error || !project) throw new Error("Project not found");

    return ensureWindow(supabase as never, userId, project as never, data.days);
  });

export const generateArticle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ itemId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { writeArticle } = await import("./plan.server");
    const { DEFAULT_MODEL } = await import("./ai.server");
    const { internalLinkTargets } = await import("./netlinking.server");
    const { supabase } = context;

    const { data: item, error } = await supabase
      .from("content_items")
      .select("*, projects(*)")
      .eq("id", data.itemId)
      .single();
    if (error || !item) throw new Error("Content item not found");
    const project = (item as unknown as { projects: Record<string, unknown> }).projects as {
      name: string;
      website_url: string | null;
      industry: string | null;
      audience: string | null;
      tone: string | null;
      locale: string | null;
      keywords: string[] | null;
    };

    await supabase.from("content_items").update({ status: "generating" }).eq("id", data.itemId);

    try {
      // Shopping pieces compare the real catalogue of the connected store.
      let products: Awaited<ReturnType<typeof import("./catalog.server").fetchCatalog>> = [];
      if (item.content_type === "shopping") {
        const { fetchCatalog, CATALOG_PLATFORMS } = await import("./catalog.server");
        const { data: stores } = await supabase
          .from("integrations")
          .select("platform, config")
          .eq("project_id", item.project_id)
          .eq("status", "connected")
          .in("platform", CATALOG_PLATFORMS as unknown as string[]);
        products = await fetchCatalog((stores ?? []) as never);
      }
      const links = await internalLinkTargets(supabase, item.project_id);
      let localInfo: LocalInfoFacts | undefined;
      if (item.content_type === "local_aeo") {
        const { fetchShopifyLocalInfo } = await import("./shopifyProvision.server");
        localInfo = await fetchShopifyLocalInfo(supabase, item.project_id);
      }
      const target = (item as unknown as { target_keyword?: string | null }).target_keyword;
      const article = await writeArticle(
        { ...project, keywords: target ? [target] : (project.keywords ?? []) },
        { content_type: item.content_type as ContentType, topic: item.topic },
        { products, links, localInfo },
      );
      // faq isn't in the generated Supabase types yet (migration only) — cast, same as target_keyword elsewhere.
      const { error: updateError } = await supabase
        .from("content_items")
        .update({
          title: article.title,
          excerpt: article.excerpt,
          body_md: article.body_md,
          slug: slugify(article.title),
          model: DEFAULT_MODEL,
          status: "draft",
          faq: article.faq,
        } as never)
        .eq("id", data.itemId);
      if (updateError) throw new Error(updateError.message);
      return { title: article.title };
    } catch (e) {
      await supabase.from("content_items").update({ status: "failed" }).eq("id", data.itemId);
      throw e;
    }
  });

export const publishItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ itemId: z.string().uuid(), integrationIds: z.array(z.string().uuid()).optional() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { runPublish } = await import("./publish.server");
    const { supabase, userId } = context;
    return runPublish(supabase, userId, data);
  });

export const illustrateArticle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ itemId: z.string().uuid(), origin: z.string().url() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { generateImageBytes, storeImage, coverPrompt, stripInlineImages } = await import(
      "./images.server"
    );
    const { supabase, userId } = context;

    const { data: item, error } = await supabase
      .from("content_items")
      .select("*, projects(industry)")
      .eq("id", data.itemId)
      .single();
    if (error || !item) throw new Error("Content item not found");
    if (!item.body_md) throw new Error("Write the article first");

    const industry =
      ((item as unknown as { projects: { industry: string | null } | null }).projects?.industry) ?? null;
    const topic = item.title ?? item.topic ?? "article";

    const cover = await generateImageBytes(coverPrompt(topic, industry));
    const coverUrl = await storeImage(userId, `${item.id}-cover`, cover, data.origin);

    // One image per article: the cover. Remove any inline images from older runs.
    const body = stripInlineImages(item.body_md);
    const { error: upErr } = await supabase
      .from("content_items")
      .update({ cover_image_url: coverUrl, body_md: body })
      .eq("id", item.id);
    if (upErr) throw new Error(upErr.message);
    return { coverUrl, inline: 0 };
  });

/**
 * Right after the 30-day plan is built: write + illustrate the day-1 GEO
 * article, and when a Google Business Profile is connected, add a Local item
 * for the same day and post it to Google Business Profile.
 */
export const kickstartFirstDay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ projectId: z.string().uuid(), origin: z.string().url() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { writeArticle } = await import("./plan.server");
    const { DEFAULT_MODEL } = await import("./ai.server");
    const { generateImageBytes, storeImage, coverPrompt } = await import("./images.server");
    const { internalLinkTargets } = await import("./netlinking.server");
    const { supabase, userId } = context;

    const { data: project } = await supabase
      .from("projects")
      .select("*")
      .eq("id", data.projectId)
      .single();
    if (!project) throw new Error("Project not found");
    const ctx = {
      name: project.name,
      website_url: project.website_url,
      industry: project.industry,
      audience: project.audience,
      tone: project.tone,
      locale: project.locale,
      keywords: project.keywords ?? [],
    };

    const { data: rows } = await supabase
      .from("content_items")
      .select("*")
      .eq("project_id", data.projectId)
      .order("scheduled_date", { ascending: true })
      .limit(2);
    const first = rows?.[0];
    if (!first) throw new Error("Nothing planned yet");

    // Day 1 is always the GEO piece.
    if (first.content_type !== "geo") {
      await supabase.from("content_items").update({ content_type: "geo" }).eq("id", first.id);
    }

    async function write(itemId: string, type: ContentType, topic: string | null) {
      const links = await internalLinkTargets(supabase, data.projectId);
      let localInfo: LocalInfoFacts | undefined;
      if (type === "local_aeo") {
        const { fetchShopifyLocalInfo } = await import("./shopifyProvision.server");
        localInfo = await fetchShopifyLocalInfo(supabase, data.projectId);
      }
      const article = await writeArticle(ctx, { content_type: type, topic }, { links, localInfo });
      await supabase
        .from("content_items")
        .update({
          title: article.title,
          excerpt: article.excerpt,
          body_md: article.body_md,
          slug: slugify(article.title),
          model: DEFAULT_MODEL,
          status: "draft",
          faq: article.faq,
        } as never)
        .eq("id", itemId);
      return article;
    }

    const geo = await write(first.id, "geo", first.topic);

    let coverUrl: string | null = null;
    try {
      const bytes = await generateImageBytes(coverPrompt(geo.title, project.industry));
      coverUrl = await storeImage(userId, `${first.id}-cover`, bytes, data.origin);
      await supabase.from("content_items").update({ cover_image_url: coverUrl }).eq("id", first.id);
    } catch {
      // an article without its cover is still shippable
    }

    // One image per article: the cover only.
    // Publish day 1 immediately to every connected destination (Supabase, WordPress, Shopify…).
    let published = 0;
    try {
      const { runPublish } = await import("./publish.server");
      const result = (await runPublish(supabase as never, userId, { itemId: first.id })) as {
        results?: unknown[];
      };
      published = Array.isArray(result?.results) ? result.results.length : 0;
    } catch {
      // no destination connected yet, or one refused — the article stays as a draft
    }

    // Google Business Profile: add the Local piece and post it.
    const { data: conn } = await supabase
      .from("google_connections")
      .select("id, resource_id")
      .eq("project_id", data.projectId)
      .eq("service", "gmb")
      .maybeSingle();

    let gmb: { posted: boolean; title: string | null; error: string | null } | null = null;
    if (conn?.resource_id) {
      const { data: localItem } = await supabase
        .from("content_items")
        .insert({
          user_id: userId,
          project_id: data.projectId,
          scheduled_date: first.scheduled_date,
          content_type: "local_aeo",
          topic: `Local update for ${project.name}`,
          status: "planned",
        })
        .select()
        .single();

      if (localItem) {
        const local = await write(localItem.id, "local_aeo", localItem.topic);
        const summary = [local.title, local.excerpt ?? local.body_md.replace(/[#*`>]/g, "").slice(0, 900)]
          .filter(Boolean)
          .join("\n\n");
        try {
          const { accessTokenFor, createGmbPost } = await import("./google.server");
          const token = await accessTokenFor(conn.id);
          await createGmbPost(token, conn.resource_id, { summary, url: project.website_url ?? null });
          await supabase
            .from("content_items")
            .update({ status: "published", published_url: project.website_url ?? null })
            .eq("id", localItem.id);
          await supabase
            .from("google_connections")
            .update({ last_error: null, status: "connected" })
            .eq("id", conn.id);
          gmb = { posted: true, title: local.title, error: null };
        } catch (e) {
          const message = e instanceof Error ? e.message : "Google post failed";
          await supabase.from("google_connections").update({ last_error: message, status: "error" }).eq("id", conn.id);
          gmb = { posted: false, title: local.title, error: message };
        }
      }
    }

    return { itemId: first.id, title: geo.title, coverUrl, gmb, published };
  });
