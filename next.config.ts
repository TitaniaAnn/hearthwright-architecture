import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Release artifacts are uploaded through an admin server action; raise the
    // default 1 MB body cap. (Large artifacts would ideally use a direct signed
    // upload — a future optimization.)
    serverActions: {
      bodySizeLimit: "100mb",
    },
  },
};

export default nextConfig;
