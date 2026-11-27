import type { NextConfig } from "next";

// Note: `cacheComponents` is intentionally off. The app is almost entirely client-rendered
// (encryption keys live only in browser memory) and Ant Design is not compatible with it.
const nextConfig: NextConfig = {
  // Minimal self-contained server for the Docker image.
  output: "standalone",
  poweredByHeader: false,
};

export default nextConfig;
