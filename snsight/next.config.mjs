/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Next 15 moved this out of `experimental` and renamed it from serverComponentsExternalPackages.
  // Metric formulas and provider adapters are server-only; keeping them unbundled also keeps tokens
  // and provider detail off the browser.
  serverExternalPackages: ['@prisma/client'],
};

export default nextConfig;
