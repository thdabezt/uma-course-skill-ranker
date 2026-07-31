/** @type {import('next').NextConfig} */

// GitHub Pages serves project sites from a subpath, so the static export needs a
// matching basePath. Left empty for `next dev` and for any root-domain host.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

const nextConfig = {
  reactStrictMode: true,
  // The app is entirely client-side, so it exports to plain static files.
  output: 'export',
  basePath,
  assetPrefix: basePath || undefined,
  trailingSlash: true,
  // Skill/character icons are served straight from GameTora's public CDN paths.
  images: { unoptimized: true },
};

export default nextConfig;
