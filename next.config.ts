import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Built-in agent skills are read from disk (lib/builtin-skills.ts) by the agent pipeline (Inngest) and by the
  // Switch Trust evaluation endpoint; the file tracer can't see dynamic paths, so ship the folder with those routes.
  // Card references: PDF text extraction (lib/reference-pdf.ts) loads PDF.js's serverless build at runtime; load it
  // from node_modules instead of bundling it.
  serverExternalPackages: ["unpdf"],
  outputFileTracingIncludes: {
    "/api/inngest": ["./agent-skills/**/*.md", "./agent-skills/**/*.txt"],
    "/api/switch-trust/**": ["./agent-skills/**/*.md", "./agent-skills/**/*.txt"],
  },
  experimental: {
    // Set by `next upgrade --agent=security` (16.4.4 → 16.4.6): how Next.js nudges for future upgrades.
    agentUpgrade: "security",
    serverActions: {
      // Agent skill uploads are capped at 5 MB (lib/agent-skills-config.ts), card references at 5 MB per file, one file
      // per call (lib/reference-config.ts), workspace logos at 1 MB; leave room for multipart overhead.
      bodySizeLimit: "6mb",
    },
  },
};

export default nextConfig;
