import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@somnia-chain/markets-sdk"],
  // The Open Graph images read their fonts from disk, so make sure a deploy ships them.
  outputFileTracingIncludes: {
    "/opengraph-image": ["./src/app/fonts/**/*"],
    "/twitter-image": ["./src/app/fonts/**/*"],
    "/c/[id]/opengraph-image": ["./src/app/fonts/**/*"],
    "/c/[id]/twitter-image": ["./src/app/fonts/**/*"],
  },
};

export default nextConfig;
