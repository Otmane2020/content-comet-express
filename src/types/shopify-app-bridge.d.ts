import type * as React from "react";

/**
 * App Bridge (loaded via the Shopify CDN script) renders navigation through
 * these custom elements and exposes `window.shopify` for session tokens.
 * https://shopify.dev/docs/api/app-bridge-library
 *
 * React 19's automatic JSX runtime resolves IntrinsicElements from
 * React.JSX (re-exported by the "react" module), not the bare global JSX
 * namespace — so the augmentation has to target the "react" module.
 */
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "ui-nav-menu": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
      "ui-title-bar": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        title?: string;
      };
    }
  }
}

declare global {
  interface Window {
    shopify?: {
      idToken: () => Promise<string>;
      environment?: { embedded?: boolean };
    };
  }
}

export {};
