import { env } from '../config/env';

const allowlist = env.ADMIN_EMAILS.split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export function isAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  return allowlist.includes(email.trim().toLowerCase());
}