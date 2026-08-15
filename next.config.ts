import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
