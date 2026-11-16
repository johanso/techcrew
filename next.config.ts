import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // Set by `next upgrade --agent=security` (16.4.4 → 16.4.6): how Next.js nudges for future upgrades.
    agentUpgrade: "security",
    serverActions: {
      // Workspace logos are capped at 1 MB (lib/storage.ts); leave room for multipart overhead.
      bodySizeLimit: "1.5mb",
    },
  },
};

export default nextConfig;
