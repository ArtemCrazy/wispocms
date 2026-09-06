import type { NextConfig } from "next";
import path from "node:path";

const monorepoRoot = path.resolve(process.cwd(), "../..");
const assetVersion = process.env.WISPO_ASSET_VERSION?.trim();

const nextConfig: NextConfig = {
  output: "standalone",
  assetPrefix: assetVersion ? `/_wispo-assets/${assetVersion}` : undefined,
  outputFileTracingRoot: monorepoRoot,
  outputFileTracingIncludes: {
    "/*": ["node_modules/@swc/helpers/**/*"],
  },
  turbopack: { root: monorepoRoot },
  async rewrites() {
    return [
      {
        source: "/preview/:siteSlug/sitemap.xml",
        destination: "/preview/:siteSlug/site-map.xml",
      },
      {
        source: "/api/:path*",
        destination: `${process.env.API_PROXY_URL ?? "http://localhost:4000"}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
