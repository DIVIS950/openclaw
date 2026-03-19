

const nextConfig = {
  images: {
    domains: [
      "logo.clearbit.com",
      "financialmodelingprep.com",
      "static.finnhub.io",
    ],
    unoptimized: true,
  },
  experimental: {
    serverActions: {
      allowedOrigins: ["localhost:3000"],
    },
  },
};

export default nextConfig;
