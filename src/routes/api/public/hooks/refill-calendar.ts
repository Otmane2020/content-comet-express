import { createFileRoute } from "@tanstack/react-router";
import { planWindow, type ContentType } from "@/lib/geo";

/**
 * Calendar refill: tops every project's rolling 30-day window back up.
 * Runs on its own schedule so the calendar is never empty, even if the
 * daily publishing pass fails or a project was created mid-day.
 */
export const Route = createFileRoute("/api/public/hooks/refill-calendar")({
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
        const { planTopics } = await import("@/lib/plan.server");

        const { data: projects } = await supabaseAdmin.from("projects").select("*");
        const summary: { project: string; added: number }[] = [];

        for (const project of projects ?? []) {
          try {
            const window = planWindow(new Date(), 30);
            const { data: existing } = await supabaseAdmin
              .from("content_items")
              .select("scheduled_date")
              .eq("project_id", project.id);
            const taken = new Set((existing ?? []).map((r) => r.scheduled_date));
            const missing = window.filter((s) => !taken.has(s.date));
            if (!missing.length) {
              summary.push({ project: project.name, added: 0 });
              continue;
            }
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
            summary.push({ project: project.name, added: topics.length });
          } catch {
            summary.push({ project: project.name, added: 0 });
          }
        }

        return new Response(JSON.stringify({ ok: true, summary }), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
