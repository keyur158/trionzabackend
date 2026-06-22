import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt';

/**
 * Sets req.user if a valid Bearer token is present, but never rejects.
 * Lets an endpoint serve both authenticated and guest (anonymous) callers.
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      req.user = verifyToken(header.slice(7));
    } catch {
      // Invalid/expired token => treat as guest, don't block.
    }
  }
  next();
}