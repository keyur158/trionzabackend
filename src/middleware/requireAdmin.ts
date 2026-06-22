import { Request, Response, NextFunction } from 'express';
import { isAdminEmail } from '../utils/admin';

/** Must run AFTER requireAuth (which sets req.user). */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!isAdminEmail(req.user?.email)) {
    res.status(403).json({ message: 'Forbidden' });
    return;
  }
  next();
}