/** @type {import('next').NextConfig} */
module.exports = {
  output: "standalone",
  serverExternalPackages: ["sequelize", "pg", "pg-hstore", "pg-pool"],
  images: { unoptimized: true },
  experimental: { cpus: 2 },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};
