import { createFileRoute } from "@tanstack/react-router";

function back(origin: string, params: Record<string, string>) {
  const q = new URLSearchParams({ tab: "platforms", ...params }).toString();
  return new Response(null, { status: 302, headers: { location: `${origin}/app?${q}` } });
}

export const Route = createFileRoute("/api/public/shopify/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const origin = url.origin;
        const mod = await import("@/lib/shopify.server");
        const shop = mod.normalizeShop(url.searchParams.get("shop"));
        const code = url.searchParams.get("code");
        const state = mod.verifyState(url.searchParams.get("state"));

        if (!shop || !code) return back(origin, { shopify: "error", message: "missing_params" });
        if (!mod.verifyRequestHmac(url)) return back(origin, { shopify: "error", message: "bad_signature" });
        if (!state) return back(origin, { connect_shopify: shop });

        try {
          const { access_token } = await mod.exchangeCode(shop, code);
          const blogId = await mod.resolveBlogId(shop, access_token);
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const { data: existing } = await supabaseAdmin
            .from("integrations")
            .select("id")
            .eq("project_id", state.projectId)
            .eq("platform", "shopify")
            .limit(1)
            .maybeSingle();

          const row = {
            user_id: state.userId,
            project_id: state.projectId,
            platform: "shopify",
            label: shop.replace(".myshopify.com", ""),
            config: { shop, blog_id: blogId, access_token },
            status: "connected",
            last_error: null,
          };

          const { error } = existing
            ? await supabaseAdmin.from("integrations").update(row).eq("id", existing.id)
            : await supabaseAdmin.from("integrations").insert(row);
          if (error) throw new Error(error.message);

          return back(origin, { shopify: "connected", shop });
        } catch (e) {
          return back(origin, {
            shopify: "error",
            message: (e instanceof Error ? e.message : "failed").slice(0, 160),
          });
        }
      },
    },
  },
});