import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const tokenSchema = z.object({ pendingToken: z.string().min(10).max(200) });

/** Public: the setup screen shows what we imported before the merchant signs up. */
export const getShopifyInstall = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => tokenSchema.parse(data))
  .handler(async ({ data }) => {
    const { readPending } = await import("./shopifyInstall.server");
    return readPending(data.pendingToken);
  });

export const claimShopifyInstall = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => tokenSchema.extend({ origin: z.string().url().max(300) }).parse(data))
  .handler(async ({ data }) => {
    const { claimPending } = await import("./shopifyInstall.server");
    return claimPending(data.pendingToken, data.origin.replace(/\/$/, ""));
  });
