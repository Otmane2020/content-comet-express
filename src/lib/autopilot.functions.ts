import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { planWindow, slugify, type ContentType, type PlatformId } from "./geo";
import { renderMarkdown } from "./markdown";

export const buildPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ projectId: z.string().uuid(), days: z.number().min(1).max(30).default(30) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { planTopics } = await import("./plan.server");
    const { supabase, userId } = context;

    const { data: project, error } = await supabase
      .from("projects")
      .select("*")
      .eq("id", data.projectId)
      .single();
    if (error || !project) throw new Error("Project not found");

    const window = planWindow(new Date(), data.days);
    const { data: existing } = await supabase
      .from("content_items")
      .select("scheduled_date")
      .eq("project_id", data.projectId);
    const taken = new Set((existing ?? []).map((r) => r.scheduled_date));
    const missing = window.filter((s) => !taken.has(s.date));
    if (missing.length === 0) return { created: 0 };

    const topics = await planTopics(
      {
        name: project.name,
        website_url: project.website_url,
        industry: project.industry,
        audience: project.audience,
        tone: project.tone,
        locale: project.locale,
        keywords: project.keywords ?? [],
      },
      missing.map((m) => ({ date: m.date, type: m.type as ContentType })),
    );

    const { error: insertError } = await supabase.from("content_items").insert(
      topics.map((t) => ({
        user_id: userId,
        project_id: data.projectId,
        scheduled_date: t.date,
        content_type: t.type,
        topic: t.topic,
        status: "planned",
      })),
    );
    if (insertError) throw new Error(insertError.message);
    return { created: topics.length };
  });

export const generateArticle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ itemId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { writeArticle } = await import("./plan.server");
    const { DEFAULT_MODEL } = await import("./ai.server");
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
      const article = await writeArticle(
        { ...project, keywords: project.keywords ?? [] },
        { content_type: item.content_type as ContentType, topic: item.topic },
      );
      const { error: updateError } = await supabase
        .from("content_items")
        .update({
          title: article.title,
          excerpt: article.excerpt,
          body_md: article.body_md,
          slug: slugify(article.title),
          model: DEFAULT_MODEL,
          status: "draft",
        })
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
    const { generateImageBytes, storeImage, coverPrompt, sectionPrompt, injectImages, headings } =
      await import("./images.server");
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

    const sections = headings(item.body_md).slice(0, 2);
    const inline: { heading: string; url: string }[] = [];
    for (const [i, heading] of sections.entries()) {
      try {
        const bytes = await generateImageBytes(sectionPrompt(heading, topic));
        const url = await storeImage(userId, `${item.id}-s${i}`, bytes, data.origin);
        inline.push({ heading, url });
      } catch {
        // skip a failed section image, keep the cover
      }
    }

    const body = injectImages(item.body_md, inline);
    const { error: upErr } = await supabase
      .from("content_items")
      .update({ cover_image_url: coverUrl, body_md: body })
      .eq("id", item.id);
    if (upErr) throw new Error(upErr.message);
    return { coverUrl, inline: inline.length };
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
      const article = await writeArticle(ctx, { content_type: type, topic });
      await supabase
        .from("content_items")
        .update({
          title: article.title,
          excerpt: article.excerpt,
          body_md: article.body_md,
          slug: slugify(article.title),
          model: DEFAULT_MODEL,
          status: "draft",
        })
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

    return { itemId: first.id, title: geo.title, coverUrl, gmb };
  });
