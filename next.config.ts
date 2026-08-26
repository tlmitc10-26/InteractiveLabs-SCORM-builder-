import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hide the dev-mode Next.js/Turbopack indicator badge. Development-only
  // cosmetic; production builds never render it either way.
  devIndicators: false,
};

export default nextConfig;
