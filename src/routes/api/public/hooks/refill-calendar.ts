import { createFileRoute } from "@tanstack/react-router";

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
        const { ensureWindow } = await import("@/lib/rotation.server");

        const { data: projects } = await supabaseAdmin.from("projects").select("*");
        const summary: { project: string; added: number }[] = [];

        for (const project of projects ?? []) {
          try {
            const result = await ensureWindow(
              supabaseAdmin as never,
              project.user_id,
              project as never,
              30,
            );
            summary.push({ project: project.name, added: result.created });
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
