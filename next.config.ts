import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.zhimg.com" },
      { protocol: "https", hostname: "picx.zhimg.com" },
    ],
  },
};

export default nextConfig;
