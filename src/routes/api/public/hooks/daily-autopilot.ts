import { createFileRoute } from "@tanstack/react-router";
import { planWindow, slugify, type ContentType, type PlatformId } from "@/lib/geo";
import { renderMarkdown } from "@/lib/markdown";

/**
 * Daily autopilot: keeps every project's 30-day window full, writes today's
 * article and publishes it to every destination flagged auto_publish.
 * Called by a scheduled job with the project's publishable key.
 */
export const Route = createFileRoute("/api/public/hooks/daily-autopilot")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey");
        if (!apikey || apikey !== process.env["SUPABASE_PUBLISHABLE_KEY"]) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { planTopics, writeArticle } = await import("@/lib/plan.server");
        const { publishTo } = await import("@/lib/publish.server");

        const today = planWindow(new Date(), 1)[0]!.date;
        const { data: projects } = await supabaseAdmin.from("projects").select("*");
        const summary: { project: string; wrote: boolean; published: number }[] = [];

        for (const project of projects ?? []) {
          const brief = {
            name: project.name,
            website_url: project.website_url,
            industry: project.industry,
            audience: project.audience,
            tone: project.tone,
            locale: project.locale,
            keywords: project.keywords ?? [],
          };

          // 1. keep the rolling window 30 days deep
          const window = planWindow(new Date(), 30);
          const { data: existing } = await supabaseAdmin
            .from("content_items")
            .select("scheduled_date")
            .eq("project_id", project.id);
          const taken = new Set((existing ?? []).map((r) => r.scheduled_date));
          const missing = window.filter((s) => !taken.has(s.date));
          if (missing.length) {
            const topics = await planTopics(
              brief,
              missing.map((m) => ({ date: m.date, type: m.type as ContentType })),
            );
            await supabaseAdmin.from("content_items").insert(
              topics.map((t) => ({
                user_id: project.user_id,
                project_id: project.id,
                scheduled_date: t.date,
                content_type: t.type,
                topic: t.topic,
                status: "planned",
              })),
            );
          }

          // 2. write today's piece if it is still empty
          const { data: item } = await supabaseAdmin
            .from("content_items")
            .select("*")
            .eq("project_id", project.id)
            .eq("scheduled_date", today)
            .maybeSingle();
          if (!item) continue;

          let body = item.body_md;
          let title = item.title;
          let excerpt = item.excerpt ?? "";
          let wrote = false;
          if (!body) {
            try {
              const article = await writeArticle(brief, {
                content_type: item.content_type as ContentType,
                topic: item.topic,
              });
              body = article.body_md;
              title = article.title;
              excerpt = article.excerpt;
              wrote = true;
              await supabaseAdmin
                .from("content_items")
                .update({
                  title,
                  excerpt,
                  body_md: body,
                  slug: slugify(article.title),
                  status: "draft",
                })
                .eq("id", item.id);
            } catch {
              await supabaseAdmin.from("content_items").update({ status: "failed" }).eq("id", item.id);
              summary.push({ project: project.name, wrote: false, published: 0 });
              continue;
            }
          }

          // 3. publish to every auto destination
          const { data: integrations } = await supabaseAdmin
            .from("integrations")
            .select("*")
            .eq("project_id", project.id)
            .eq("status", "connected")
            .eq("auto_publish", true);

          let published = 0;
          for (const integration of integrations ?? []) {
            try {
              const result = await publishTo(
                integration.platform as PlatformId,
                (integration.config ?? {}) as Record<string, string>,
                {
                  title: title ?? item.topic ?? "Untitled",
                  slug: item.slug ?? slugify(title ?? "article"),
                  excerpt,
                  html: renderMarkdown(body!),
                  markdown: body!,
                  contentType: item.content_type,
                  scheduledDate: item.scheduled_date,
                },
              );
              published += 1;
              await supabaseAdmin.from("publish_logs").insert({
                user_id: project.user_id,
                content_item_id: item.id,
                integration_id: integration.id,
                platform: integration.platform,
                success: true,
                message: result.message,
                remote_url: result.url,
              });
              await supabaseAdmin
                .from("content_items")
                .update({ status: "published", published_url: result.url })
                .eq("id", item.id);
            } catch (e) {
              await supabaseAdmin.from("publish_logs").insert({
                user_id: project.user_id,
                content_item_id: item.id,
                integration_id: integration.id,
                platform: integration.platform,
                success: false,
                message: e instanceof Error ? e.message : "Unknown error",
              });
            }
          }

          summary.push({ project: project.name, wrote, published });
        }

        return new Response(JSON.stringify({ date: today, summary }), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});