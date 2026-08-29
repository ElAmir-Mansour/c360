import withBundleAnalyzer from '@next/bundle-analyzer';

const analyzer = withBundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  distDir: process.env.NEXT_DIST_DIR || '.next',
  outputFileTracingIncludes: {
    '/monaco/vs/[...asset]': ['./node_modules/monaco-editor/min/vs/**/*'],
  },
  productionBrowserSourceMaps: false,
  images: {
    // Serve modern formats when the browser accepts them (AVIF preferred,
    // WebP fallback) — smaller transfers for next/image assets.
    formats: ['image/avif', 'image/webp'],
  },
  poweredByHeader: false,
  devIndicators: false,
  experimental: {
    optimizePackageImports: ['lucide-react', 'recharts', 'framer-motion'],
    // Memory-reduction knobs (NOT error suppression) — this dev machine is often
    // memory-tight, and the standalone trace-collection step OOM-fails (ENOENT
    // on manifests) under pressure. These lower the build's footprint.
    cpus: 1,
    workerThreads: false,
    webpackMemoryOptimizations: true,
  },
  async rewrites() {
    // The rewrite is served by the Next server, so prefer the server-side
    // gateway address (GATEWAY_INTERNAL_URL — same var the auth BFF uses) over
    // the browser-facing NEXT_PUBLIC_API_URL. Locally both are the same origin;
    // in a split public/internal deployment this keeps proxied /api/v1 traffic
    // on the internal network instead of hairpinning through the public origin.
    // NOTE: evaluated at BUILD time — both vars must be set when building.
    const gateway =
      process.env.GATEWAY_INTERNAL_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      'http://localhost:8080';
    return [
      {
        source: '/api/docs/watheeq/:path*',
        destination: `${gateway}/api/docs/watheeq/:path*`,
      },
      {
        source: '/api/v1/:path*',
        destination: `${gateway}/api/v1/:path*`,
      },
    ];
  },
  // Clario Recover restructure (Prompt 2): the application-recovery lifecycle
  // pages move under the Recover product's IT DR workspace. Legacy `/dr/*` URLs
  // permanently (308) redirect to their new Recover home so bookmarks, emailed
  // links and prior nav references never dead-end. The remaining DR routes
  // (overview, approvals, insights, protect, topology, integrations, readiness,
  // and the runbooks/runs deep links) stay under `/dr`.
  async redirects() {
    return [
      { source: '/dr/recover', destination: '/recover/it-dr/recover', permanent: true },
      { source: '/dr/runbooks', destination: '/recover/it-dr/runbooks', permanent: true },
      { source: '/dr/rehearse', destination: '/recover/it-dr/rehearse', permanent: true },
      // Prove + its sub-pages (ledger, compliance) — preserve the deep path.
      { source: '/dr/prove', destination: '/recover/it-dr/prove', permanent: true },
      { source: '/dr/prove/:path*', destination: '/recover/it-dr/prove/:path*', permanent: true },
    ];
  },
};

export default analyzer(nextConfig);
