import type { NextConfig } from "next";
import path from "node:path";

const workspaceRoot = path.join(__dirname, "../..");

const nextConfig: NextConfig = {
  outputFileTracingRoot: workspaceRoot,
  reactStrictMode: true,
  transpilePackages: ["@quietr/auth", "@quietr/database", "@quietr/trpc", "@quietr/ui"],
  env: {
    NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE_KEY ??
      process.env.VITE_LOGO_DEV_PUBLISHABLE_KEY ??
      "",
  },
};

export default nextConfig;
