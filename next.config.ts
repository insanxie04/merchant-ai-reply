import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /** Docker / 自建部署：生成独立运行包，见 Dockerfile */
  output: "standalone",
};

export default nextConfig;
