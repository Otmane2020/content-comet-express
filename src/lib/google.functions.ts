import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const connectInput = z.object({
  projectId: z.string().uuid(),
  service: z.enum(["gmb", "gsc"]),
  origin: z.string().url(),
});

/** Build the Google consent URL for Business Profile or Search Console. */
export const startGoogleConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => connectInput.parse(input))
  .handler(async ({ data, context }) => {
    const { authUrl, signState } = await import("./google.server");
    const state = signState({
      userId: context.userId,
      projectId: data.projectId,
      service: data.service,
      origin: data.origin,
      ts: Date.now(),
    });
    return { url: authUrl(data.service, state, data.origin) };
  });

const idInput = z.object({ connectionId: z.string().uuid() });

/** Available Business Profile locations / Search Console properties for a connection. */
export const listGoogleResources = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => idInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: conn, error } = await context.supabase
      .from("google_connections")
      .select("id, service")
      .eq("id", data.connectionId)
      .single();
    if (error || !conn) throw new Error("Connection not found.");
    const { accessTokenFor, listGmbLocations, listGscSites } = await import("./google.server");
    const token = await accessTokenFor(conn.id);
    if (conn.service === "gmb") {
      const locs = await listGmbLocations(token);
      return locs.map((l) => ({ id: l.name, label: l.title, sub: l.address ?? "" }));
    }
    const sites = await listGscSites(token);
    return sites.map((s) => ({ id: s.siteUrl, label: s.siteUrl, sub: s.permissionLevel }));
  });

const selectInput = z.object({
  connectionId: z.string().uuid(),
  resourceId: z.string().min(1),
  resourceName: z.string().min(1),
});

/** Pick which location / property this project is bound to. */
export const selectGoogleResource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => selectInput.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("google_connections")
      .update({ resource_id: data.resourceId, resource_name: data.resourceName, status: "connected", last_error: null })
      .eq("id", data.connectionId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const projectInput = z.object({ projectId: z.string().uuid() });

/** Pull the last 28 days of Search Console data and store the snapshot. */
export const syncSearchConsole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => projectInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: conn } = await context.supabase
      .from("google_connections")
      .select("id, resource_id")
      .eq("project_id", data.projectId)
      .eq("service", "gsc")
      .maybeSingle();
    if (!conn?.resource_id) throw new Error("Connect Search Console and pick a property first.");
    const { accessTokenFor, gscQuery } = await import("./google.server");
    const token = await accessTokenFor(conn.id);
    const rows: {
      user_id: string;
      project_id: string;
      dimension: "query" | "page" | "date";
      label: string;
      clicks: number;
      impressions: number;
      ctr: number;
      position: number | null;
      captured_at: string;
    }[] = [];
    for (const dimension of ["query", "page", "date"] as const) {
      const res = await gscQuery(token, conn.resource_id, dimension);
      for (const r of res) {
        rows.push({
          user_id: context.userId,
          project_id: data.projectId,
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
      const { error } = await context.supabase
        .from("search_metrics")
        .upsert(rows, { onConflict: "project_id,dimension,label" });
      if (error) throw new Error(error.message);
    }
    return { rows: rows.length };
  });

const postInput = z.object({ projectId: z.string().uuid(), contentId: z.string().uuid().optional() });

/** Publish a short local post to Google Business Profile. */
export const publishToGmb = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => postInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: conn } = await context.supabase
      .from("google_connections")
      .select("id, resource_id")
      .eq("project_id", data.projectId)
      .eq("service", "gmb")
      .maybeSingle();
    if (!conn?.resource_id) throw new Error("Connect Google Business Profile and pick a location first.");

    let query = context.supabase
      .from("content_items")
      .select("id, title, excerpt, body_md, published_url")
      .eq("project_id", data.projectId);
    query = data.contentId
      ? query.eq("id", data.contentId)
      : query.order("scheduled_date", { ascending: false }).limit(1);
    const { data: itemRows } = await query;
    const item = itemRows?.[0];
    if (!item) throw new Error("No article to post yet.");

    const summary = [item.title, item.excerpt ?? (item.body_md ?? "").replace(/[#*`>]/g, "").slice(0, 900)]
      .filter(Boolean)
      .join("\n\n");

    const { accessTokenFor, createGmbPost } = await import("./google.server");
    try {
      const token = await accessTokenFor(conn.id);
      await createGmbPost(token, conn.resource_id, { summary, url: item.published_url ?? null });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Google post failed";
      await context.supabase.from("google_connections").update({ last_error: message, status: "error" }).eq("id", conn.id);
      throw new Error(message);
    }
    await context.supabase.from("google_connections").update({ last_error: null, status: "connected" }).eq("id", conn.id);
    return { ok: true, title: item.title };
  });

/** Remove a Google connection (tokens cascade). */
export const disconnectGoogle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => idInput.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("google_connections").delete().eq("id", data.connectionId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
