import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  ...(process.env.DVC_E2E === "1" ? { distDir: ".next-dvc-e2e", typescript: { tsconfigPath: ".dvc-e2e/tsconfig.json" } } : {}),
};

export default nextConfig;
