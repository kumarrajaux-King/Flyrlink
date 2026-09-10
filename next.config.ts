import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Security headers (STEP 02 §13). CSP is added in Phase 5 alongside the first
  // pages, since it must enumerate the actual script and style sources.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
        ],
      },
    ];
  },
  // argon2 is a native module and must not be bundled for the server runtime.
  serverExternalPackages: ['argon2', '@prisma/client', '@prisma/adapter-pg'],
};

export default nextConfig;
