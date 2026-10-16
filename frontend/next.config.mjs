/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // There's no landing page yet, so "/" (the logo, the 404 page's link, the
  // payment callback, a bare link to the site) goes to the Discovery Hub.
  // Keep in step with DISCOVERY_PATH in (public)/_components/discovery-path.ts.
  async redirects() {
    return [{ source: "/", destination: "/homes", permanent: false }];
  },
  // On every response, pages and /api routes alike. Google sign-in, Maps
  // and Paystack keep working: they're frames and redirects WE open, and
  // frame-ancestors only stops other sites framing paddy (clickjacking).
  // The referrer policy still sends our origin, which the Maps key's
  // website restriction checks.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
