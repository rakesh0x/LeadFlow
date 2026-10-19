import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  typescript: {
    ignoreBuildErrors: false,
  },
  experimental: {
    // better-sqlite3 holds a native handle per worker; parallel static
    // generation crashes Node 24 (SIGABRT in Statement::~Statement).
    // Serializing static generation avoids the crash.
    staticGenerationMaxConcurrency: 1,
  },
};

export default nextConfig;