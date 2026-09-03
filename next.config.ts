import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  serverExternalPackages: ["pdfjs-dist"],
  devIndicators: false,
};

export default nextConfig;
