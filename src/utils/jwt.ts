import jwt from 'jsonwebtoken';
import { env } from '../config/env';

// Optional override (e.g. JWT_EXPIRES_IN=30d); intentionally not part of the
// required zod env schema.
const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN || '30d') as jwt.SignOptions['expiresIn'];

export function signToken(payload: { id: string; email: string }): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token: string): { id: string; email: string } {
  // Tokens issued before expiry was introduced have no exp claim; jwt.verify
  // accepts those by default, so existing sessions remain valid.
  return jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as { id: string; email: string };
}