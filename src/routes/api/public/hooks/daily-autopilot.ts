import { createFileRoute } from "@tanstack/react-router";
import { planWindow, slugify, type ContentType, type PlatformId } from "@/lib/geo";
import { renderMarkdown } from "@/lib/markdown";
import type { LocalInfoFacts } from "@/lib/shopifyProvision.server";

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
        const { writeArticle } = await import("@/lib/plan.server");
        const { ensureWindow } = await import("@/lib/rotation.server");
        const { publishTo } = await import("@/lib/publish.server");
        const { internalLinkTargets } = await import("@/lib/netlinking.server");

        const today = planWindow(new Date(), 1)[0]!.date;
        const { data: projects } = await supabaseAdmin.from("projects").select("*");
        const summary: { project: string; wrote: boolean; published: number }[] = [];

        // The job runs hourly; each project only runs at the hour it picked
        // (in its own time zone). ?force=1 bypasses the schedule.
        const force = new URL(request.url).searchParams.get("force") === "1";
        const localHour = (timezone: string | null) => {
          try {
            return Number(
              new Intl.DateTimeFormat("en-GB", {
                hour: "2-digit",
                hour12: false,
                timeZone: timezone || "UTC",
              }).format(new Date()),
            );
          } catch {
            return new Date().getUTCHours();
          }
        };

        for (const project of projects ?? []) {
          const settings = project as unknown as { publish_hour?: number | null; timezone?: string | null };
          if (!force && localHour(settings.timezone ?? "UTC") !== (settings.publish_hour ?? 9)) continue;

          // 0. keep keyword/competitor research fresh (no-op if already filled)
          try {
            const { runResearch } = await import("@/lib/research.server");
            await runResearch(supabaseAdmin as never, project.user_id, project.id, false);
          } catch {
            /* research is best-effort; never block publishing */
          }

          const brief = {
            name: project.name,
            website_url: project.website_url,
            industry: project.industry,
            audience: project.audience,
            tone: project.tone,
            locale: project.locale,
            keywords: project.keywords ?? [],
          };

          // 1. keep the rolling window 30 days deep, planned on live keywords
          try {
            await ensureWindow(supabaseAdmin as never, project.user_id, project as never, 30);
          } catch {
            /* planning failure must not block today's article */
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
              let products: { title: string; price: string | null; url: string | null; description: string | null }[] = [];
              if (item.content_type === "shopping") {
                const { fetchCatalog, CATALOG_PLATFORMS } = await import("@/lib/catalog.server");
                const { data: stores } = await supabaseAdmin
                  .from("integrations")
                  .select("platform, config")
                  .eq("project_id", project.id)
                  .eq("status", "connected")
                  .in("platform", CATALOG_PLATFORMS as unknown as string[]);
                products = await fetchCatalog((stores ?? []) as never);
              }
              const links = await internalLinkTargets(supabaseAdmin, project.id);
              let localInfo: LocalInfoFacts | undefined;
              if (item.content_type === "local_aeo") {
                const { fetchShopifyLocalInfo } = await import("@/lib/shopifyProvision.server");
                localInfo = await fetchShopifyLocalInfo(supabaseAdmin, project.id);
              }
              const target = (item as unknown as { target_keyword?: string | null }).target_keyword;
              const article = await writeArticle(
                target ? { ...brief, keywords: [target] } : brief,
                { content_type: item.content_type as ContentType, topic: item.topic },
                { products, links, localInfo, profile: project.business_profile as never },
              );
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
                  faq: article.faq,
                } as never)
                .eq("id", item.id);
            } catch {
              await supabaseAdmin.from("content_items").update({ status: "failed" }).eq("id", item.id);
              summary.push({ project: project.name, wrote: false, published: 0 });
              continue;
            }
          }

          // 3. publish to every auto destination
          // 2b. illustrate with a single Cloudflare cover image
          let coverUrl = item.cover_image_url as string | null;
          if (body && !coverUrl) {
            try {
              const { generateImageBytes, storeImage, coverPrompt, stripInlineImages } =
                await import("@/lib/images.server");
              const origin = new URL(request.url).origin;
              const topic = title ?? item.topic ?? "article";
              const cover = await generateImageBytes(coverPrompt(topic, project.industry));
              coverUrl = await storeImage(project.user_id, `${item.id}-cover`, cover, origin);
              body = stripInlineImages(body);
              await supabaseAdmin
                .from("content_items")
                .update({ cover_image_url: coverUrl, body_md: body })
                .eq("id", item.id);
            } catch (imageError) {
              console.error("[daily-autopilot] cover image failed", {
                projectId: project.id,
                itemId: item.id,
                error: imageError instanceof Error ? imageError.message : String(imageError),
              });
              /* Publishing remains available when an image provider is temporarily unavailable. */
            }
          }

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
                  coverUrl: coverUrl ?? null,
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

          // 4. Google: local post on Business Profile + Search Console refresh
          try {
            const { data: googles } = await supabaseAdmin
              .from("google_connections")
              .select("id, service, resource_id, auto_publish")
              .eq("project_id", project.id)
              .eq("status", "connected");
            const { accessTokenFor, createGmbPost, gscQuery } = await import("@/lib/google.server");
            for (const conn of googles ?? []) {
              if (!conn.resource_id) continue;
              try {
                const token = await accessTokenFor(conn.id);
                if (conn.service === "gmb" && conn.auto_publish) {
                  await createGmbPost(token, conn.resource_id, {
                    summary: [title ?? item.topic, excerpt].filter(Boolean).join("\n\n"),
                    url: project.website_url,
                  });
                  published += 1;
                }
                if (conn.service === "gsc") {
                  const rows: Record<string, unknown>[] = [];
                  for (const dimension of ["query", "page", "date"] as const) {
                    for (const r of await gscQuery(token, conn.resource_id, dimension)) {
                      rows.push({
                        user_id: project.user_id,
                        project_id: project.id,
                        dimension,
                        label: r.keys?.[0] ?? "",
                        clicks: r.clicks ?? 0,
                        impressions: r.impressions ?? 0,
                        ctr: r.ctr ?? 0,
                        position: r.position ?? null,
                        captured_at: new Date().toISOString(),
                      });
                    }
                  }
                  if (rows.length) {
                    await supabaseAdmin
                      .from("search_metrics")
                      .upsert(rows as never, { onConflict: "project_id,dimension,label" });
                  }
                }
                await supabaseAdmin.from("google_connections").update({ last_error: null }).eq("id", conn.id);
              } catch (e) {
                await supabaseAdmin
                  .from("google_connections")
                  .update({ last_error: e instanceof Error ? e.message.slice(0, 300) : "Google error" })
                  .eq("id", conn.id);
              }
            }
          } catch {
            /* Google is best-effort */
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