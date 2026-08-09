import { createFileRoute } from "@tanstack/react-router";

const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });

export const Route = createFileRoute("/api/public/shopify/install")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const origin = url.origin;
        const mod = await import("@/lib/shopify.server");
        const shop = mod.normalizeShop(url.searchParams.get("shop"));
        if (!shop) return redirect(`${origin}/app?tab=platforms&shopify=error&message=invalid_shop`);

        const state = mod.verifyState(url.searchParams.get("state"));
        // Installs started from Shopify carry no state: bounce through the app so
        // the signed-in user can be attached, then come back here.
        if (!state) {
          return redirect(`${origin}/app?tab=platforms&connect_shopify=${encodeURIComponent(shop)}`);
        }

        return redirect(mod.authorizeUrl(shop, url.searchParams.get("state")!, origin));
      },
    },
  },
});