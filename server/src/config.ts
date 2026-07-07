const isProd = process.env.NODE_ENV === 'production';

function requireInProd(name: string, devDefault: string): string {
  const value = process.env[name];
  if (value) return value;
  if (isProd) {
    throw new Error(`${name} must be set in production`);
  }
  return devDefault;
}

export const config = {
  isProd,
  databaseUrl:
    process.env.DATABASE_URL ??
    'postgres://bioverse:bioverse@localhost:5433/bioverse',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',

  // Auth (DESIGN.md §15). Dev defaults are deliberately obvious; prod refuses
  // to boot without a real secret. Access tokens are short; refresh rotates.
  jwtSecret: requireInProd('JWT_SECRET', 'dev-insecure-jwt-secret-change-me'),
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL ?? '15m',
  refreshTokenTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30),
  // Refresh token travels in a Secure, HttpOnly cookie; relaxed off-TLS in dev.
  cookieSecure: process.env.COOKIE_SECURE
    ? process.env.COOKIE_SECURE === 'true'
    : isProd,
};
