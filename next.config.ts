import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Fully static output — no server-only APIs anywhere in this app (client-
  // side Firebase SDK is the only data source), so there's no server
  // runtime to lose. Pairs with public/sw.js: a static asset tree is what
  // lets the service worker cache the app shell for offline reloads.
  output: "export",
  turbopack: {
    resolveAlias: {
      // These two packages declare only a "browser" export condition with
      // no fallback, which Next's SSR resolution pass (even for
      // client-only code) can't satisfy. Point straight at their ESM
      // build to sidestep the incomplete exports map.
      "@point-of-sale/webbluetooth-receipt-printer":
        "./node_modules/@point-of-sale/webbluetooth-receipt-printer/dist/webbluetooth-receipt-printer.esm.js",
      "@point-of-sale/webserial-receipt-printer":
        "./node_modules/@point-of-sale/webserial-receipt-printer/dist/webserial-receipt-printer.esm.js",
    },
  },
};

export default nextConfig;
