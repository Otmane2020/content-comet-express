/**
 * Public Shopify app credentials, safe to ship to the browser (App Bridge
 * needs the client id client-side). Kept out of shopify.server.ts on purpose
 * — that module is server-only and never bundled for the client.
 */
export const SHOPIFY_CLIENT_ID = "a57869f9e856fc6af974670ab5dcd6a2";
