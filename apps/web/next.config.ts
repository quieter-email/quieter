import type { NextConfig } from "next";
import path from "node:path";

const workspaceRoot = path.join(__dirname, "../..");

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "gravatar.com", pathname: "/avatar/**" },
      { protocol: "https", hostname: "img.logo.dev", pathname: "/**" },
    ],
  },
  reactCompiler: true,
  outputFileTracingRoot: workspaceRoot,
  reactStrictMode: true,
  transpilePackages: ["@quietr/auth", "@quietr/database", "@quietr/orpc", "@quietr/ui"],
  env: {
    NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE_KEY ??
      process.env.VITE_LOGO_DEV_PUBLISHABLE_KEY ??
      "",
  },
};

export default nextConfig;
