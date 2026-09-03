import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfjs-dist"],
  devIndicators: false,
  logging: {
    incomingRequests: {
      ignore: [/^\/json\/version$/],
    },
  },
};

export default nextConfig;
