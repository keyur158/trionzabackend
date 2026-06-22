import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().default(3000),
  JWT_SECRET: z.string().min(16),
  SHOPIFY_STORE_DOMAIN: z.string(),
  SHOPIFY_CLIENT_ID: z.string(),
  SHOPIFY_CLIENT_SECRET: z.string(),
  SHOPIFY_API_VERSION: z.string().default('2025-10'),
  SHOPIFY_STOREFRONT_ACCESS_TOKEN: z.string(),
  SHOPIFY_WEBHOOK_SECRET: z.string(),
  PAYPAL_CLIENT_ID: z.string(),
  PAYPAL_SECRET: z.string(),
  PAYPAL_MODE: z.enum(['sandbox', 'live']).default('sandbox'),
  ZEPTOMAIL_TOKEN: z.string().default(''),
  ZEPTOMAIL_API_BASE: z.string().default('https://api.zeptomail.com'),
  ZEPTOMAIL_FROM_ADDRESS: z.string().default('noreply@trionzadiamond.com'),
  ZEPTOMAIL_FROM_NAME: z.string().default('Trionza Diamond'),
  // Where appointment / custom-order notifications are delivered.
  ADMIN_EMAIL: z.string().default('manthanzlj@gmail.com'),
  // Comma-separated list of admin emails allowed into the admin API/panel.
  ADMIN_EMAILS: z.string().default('manthanzlj@gmail.com'),
  APP_PUBLIC_URL: z.string().default('https://trionzadiamond.com'),
  FIREBASE_SERVICE_ACCOUNT: z.string().default('./firebase-service-account.json'),
  SYNC_INTERVAL_HOURS: z.coerce.number().int().min(1).default(6),
});

export const env = envSchema.parse(process.env);
