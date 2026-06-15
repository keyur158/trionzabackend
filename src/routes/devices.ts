import { Router, Request, Response } from 'express';
import { prisma } from '../config/database';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.post('/register', requireAuth, async (req: Request, res: Response) => {
  const { fcmToken, deviceType } = req.body;
  if (!fcmToken) {
    res.status(400).json({ message: 'fcmToken is required' });
    return;
  }
  await prisma.deviceToken.upsert({
    where: { fcmToken },
    create: { customerEmail: req.user!.email, fcmToken, deviceType: deviceType ?? 'unknown' },
    update: { customerEmail: req.user!.email, deviceType: deviceType ?? 'unknown' },
  });
  res.json({ success: true });
});

router.delete('/unregister', requireAuth, async (req: Request, res: Response) => {
  const { fcmToken } = req.body;
  if (!fcmToken) {
    res.status(400).json({ message: 'fcmToken is required' });
    return;
  }
  await prisma.deviceToken.deleteMany({ where: { fcmToken, customerEmail: req.user!.email } });
  res.json({ success: true });
});

export default router;
