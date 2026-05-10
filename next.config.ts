import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Mastra storage backends use native bindings — keep them server-only and unbundled.
  serverExternalPackages: [
    '@mastra/duckdb',
    '@duckdb/node-api',
    '@duckdb/node-bindings',
    '@libsql/client',
  ],
};

export default nextConfig;
