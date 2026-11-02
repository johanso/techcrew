import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      // Workspace logos are capped at 1 MB (lib/storage.ts); leave room for multipart overhead.
      bodySizeLimit: "1.5mb",
    },
  },
};

export default nextConfig;
