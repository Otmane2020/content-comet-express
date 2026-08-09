import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const SITE = "https://www.ranki.ai";

const payloadSchema = z.object({
  title: z.string().min(1).max(300),
  slug: z.string().min(1).max(200),
  excerpt: z.string().max(2000).optional().nullable(),
  markdown: z.string().max(200000).optional().nullable(),
  html: z.string().max(400000).optional().nullable(),
  cover_url: z.string().url().max(2000).optional().nullable(),
  keywords: z.array(z.string().max(120)).max(50).optional().nullable(),
  published_at: z.string().max(40).optional().nullable(),
  content_type: z.string().max(40).optional().nullable(),
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

export const Route = createFileRoute("/api/public/articles")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["AUTOPILOT_SECRET"];
        const sent = request.headers.get("x-autopilot-secret");
        if (!secret || !sent || sent !== secret) {
          return json({ error: "Unauthorized" }, 401);
        }

        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return json({ error: "Invalid JSON body" }, 400);
        }

        const parsed = payloadSchema.safeParse(raw);
        if (!parsed.success) {
          return json({ error: "Invalid payload", issues: parsed.error.issues }, 400);
        }
        const p = parsed.data;
        const slug = p.slug
          .toLowerCase()
          .trim()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");
        if (!slug) return json({ error: "Invalid slug" }, 400);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await supabaseAdmin.from("articles").upsert(
          {
            slug,
            title: p.title,
            excerpt: p.excerpt ?? null,
            markdown: p.markdown ?? null,
            html: p.html ?? null,
            cover_url: p.cover_url ?? null,
            keywords: p.keywords ?? [],
            content_type: p.content_type ?? null,
            published_at: p.published_at ?? new Date().toISOString(),
          },
          { onConflict: "slug" },
        );
        if (error) return json({ error: error.message }, 500);

        return json({ url: `${SITE}/blog/${slug}` });
      },
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "POST, OPTIONS",
            "access-control-allow-headers": "content-type, x-autopilot-secret",
          },
        }),
    },
  },
});
