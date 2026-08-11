import { createFileRoute } from "@tanstack/react-router";

const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });

export const Route = createFileRoute("/api/public/shopify/install")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const origin = url.origin;
        const mod = await import("@/lib/shopify.server");
        try {
          const shop = mod.normalizeShop(url.searchParams.get("shop"));
          if (!shop) return redirect(`${origin}/app?tab=platforms&shopify=error&message=invalid_shop`);

          // With state: a signed-in merchant is adding this store to their project.
          // Without state (install from Shopify, or "Continue with Shopify"): the
          // callback creates the account from the store data and signs them in.
          const raw = url.searchParams.get("state");
          const state = mod.verifyState(raw);
          const nonce = `install-${Date.now().toString(36)}`;
          return redirect(mod.authorizeUrl(shop, state && raw ? raw : nonce, origin));
        } catch (e) {
          const message = (e instanceof Error ? e.message : "failed").slice(0, 160);
          return redirect(`${origin}/app?tab=platforms&shopify=error&message=${encodeURIComponent(message)}`);
        }
      },
    },
  },
});