/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Metric formulas and provider adapters are server-only; keeping them out of the client bundle
    // also keeps tokens and provider detail off the browser.
    serverComponentsExternalPackages: ['@prisma/client'],
  },
};

export default nextConfig;
