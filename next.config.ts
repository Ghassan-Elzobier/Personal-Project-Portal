import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Source maps for the error tracker, which maps stack frames back to source
  // lines (src/lib/errors/symbolicate.ts). The browser's maps are built here and
  // the server's come with every build. After the build,
  // scripts/pack-source-maps.mjs moves the browser's out of the public files and
  // packs both into the server functions, which read them from disk; src/proxy.ts
  // refuses any .map request as well. So they are never public.
  productionBrowserSourceMaps: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
