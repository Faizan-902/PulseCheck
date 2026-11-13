import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.ts';
import { env } from '../config/env.js';

const adapter = new PrismaPg({
  host: env.PGHOST,
  port: env.PGPORT,
  database: env.PGDATABASE,
  user: env.PGUSER,
  password: env.PGPASSWORD,
  ssl: env.PGSSLMODE === 'require' ? { rejectUnauthorized: true } : false,
  max: env.PGPOOL_MAX,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

export const prisma = new PrismaClient({ adapter });

export async function connectPrisma() {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
}

export async function closePrisma() {
  await prisma.$disconnect();
}
