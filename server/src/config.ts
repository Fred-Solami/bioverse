export const config = {
  databaseUrl:
    process.env.DATABASE_URL ??
    'postgres://bioverse:bioverse@localhost:5433/bioverse',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
};
