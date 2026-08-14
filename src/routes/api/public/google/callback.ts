import { createFileRoute } from "@tanstack/react-router";

function back(origin: string, params: Record<string, string>) {
  const q = new URLSearchParams(params).toString();
  const target = `${origin}/app?${q}`;
  const message = {
    type: "ranki:google-oauth",
    status: params["google"] ?? "error",
    message: params["message"] ?? null,
  };
  // In Shopify, OAuth runs in a popup because Google consent cannot render in
  // App Home. Notify the original iframe and close. Standalone users retain
  // the normal redirect fallback.
  const script = `
    (() => {
      const target = ${JSON.stringify(target).replace(/</g, "\\u003c")};
      const origin = ${JSON.stringify(origin).replace(/</g, "\\u003c")};
      const message = ${JSON.stringify(message).replace(/</g, "\\u003c")};
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(message, origin);
        window.close();
        setTimeout(() => window.location.replace(target), 500);
      } else {
        window.location.replace(target);
      }
    })();
  `;
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><title>Google connected</title></head><body><p>Returning to Ranki…</p><script>${script}</script></body></html>`, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

export const Route = createFileRoute("/api/public/google/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const fallback = url.origin;
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const err = url.searchParams.get("error");

        const { verifyState, exchangeCode, emailFromIdToken } = await import("@/lib/google.server");
        const payload = state ? verifyState(state) : null;
        const origin = payload?.origin ?? fallback;
        if (err) return back(origin, { tab: "local", google: "error", message: err });
        if (!code || !payload) return back(origin, { tab: "local", google: "error", message: "invalid_state" });

        try {
          const tokens = await exchangeCode(code, origin);
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const email = emailFromIdToken(tokens.id_token);
          // A combined consent grants both scopes, so store one connection per service.
          const services = payload.service === "all" ? (["gsc", "gmb", "ga4"] as const) : ([payload.service] as const);

          for (const service of services) {
            const { data: conn, error } = await supabaseAdmin
              .from("google_connections")
              .upsert(
                {
                  user_id: payload.userId,
                  project_id: payload.projectId,
                  service,
                  account_email: email,
                  status: "connected",
                  last_error: null,
                },
                { onConflict: "project_id,service" },
              )
              .select("id")
              .single();
            if (error || !conn) throw new Error(error?.message ?? "could not save connection");

            await supabaseAdmin.from("google_tokens").upsert(
              {
                connection_id: conn.id,
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token ?? null,
                scope: tokens.scope ?? null,
                expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
                updated_at: new Date().toISOString(),
              },
              { onConflict: "connection_id" },
            );
          }

          return back(origin, { tab: "local", google: "connected", service: payload.service });
        } catch (e) {
          return back(origin, {
            tab: "local",
            google: "error",
            message: (e instanceof Error ? e.message : "failed").slice(0, 160),
          });
        }
      },
    },
  },
});
