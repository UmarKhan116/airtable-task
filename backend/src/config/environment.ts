import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('3000').transform(Number),

  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),

  AIRTABLE_CLIENT_ID: z.string().min(1, 'AIRTABLE_CLIENT_ID is required'),
  AIRTABLE_CLIENT_SECRET: z.string().min(1, 'AIRTABLE_CLIENT_SECRET is required'),
  AIRTABLE_REDIRECT_URI: z.string().url('AIRTABLE_REDIRECT_URI must be a valid URL'),

  AIRTABLE_EMAIL: z.string().email().optional(),
  AIRTABLE_PASSWORD: z.string().optional(),

  ENCRYPTION_KEY: z.string().length(64, 'ENCRYPTION_KEY must be 64 hex chars (32 bytes)'),

  FRONTEND_URL: z.string().url().default('http://localhost:4200'),

  RATE_LIMIT_WINDOW_MS: z.string().default('900000').transform(Number),
  RATE_LIMIT_MAX: z.string().default('100').transform(Number),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:');
  console.error(parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
