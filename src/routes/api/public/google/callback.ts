import { createFileRoute } from "@tanstack/react-router";

function back(origin: string, params: Record<string, string>) {
  const q = new URLSearchParams(params).toString();
  return new Response(null, { status: 302, headers: { location: `${origin}/app?${q}` } });
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
          const { data: conn, error } = await supabaseAdmin
            .from("google_connections")
            .upsert(
              {
                user_id: payload.userId,
                project_id: payload.projectId,
                service: payload.service,
                account_email: emailFromIdToken(tokens.id_token),
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
