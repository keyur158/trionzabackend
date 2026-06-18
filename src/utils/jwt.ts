import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export function signToken(payload: { id: string; email: string }): string {
  // No expiresIn => token never expires; users stay logged in indefinitely.
  return jwt.sign(payload, env.JWT_SECRET);
}

export function verifyToken(token: string): { id: string; email: string } {
  return jwt.verify(token, env.JWT_SECRET) as { id: string; email: string };
}