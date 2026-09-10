import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel traces its own functions; only the desktop bundle needs standalone output.
  output: process.env.VERCEL ? undefined : "standalone",
};

export default nextConfig;
