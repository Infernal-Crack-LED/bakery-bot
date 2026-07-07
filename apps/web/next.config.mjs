/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Transpile the shared TS package (it ships raw .ts source, no build step).
  transpilePackages: ['@app/db'],
};

export default nextConfig;
