import { Router, Request, Response } from 'express';
import { prisma } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { optionalAuth } from '../middleware/optionalAuth';

const router = Router();

// Works for guests (no token) and logged-in users. When authenticated, the
// token is linked to the customer; otherwise it is stored anonymously so
// broadcast notifications still reach the device.
router.post('/register', optionalAuth, async (req: Request, res: Response) => {
  const { fcmToken, deviceType } = req.body;
  if (!fcmToken) {
    res.status(400).json({ message: 'fcmToken is required' });
    return;
  }
  const customerEmail = req.user?.email ?? null;
  await prisma.deviceToken.upsert({
    where: { fcmToken },
    create: { customerEmail, fcmToken, deviceType: deviceType ?? 'unknown' },
    update: { customerEmail, deviceType: deviceType ?? 'unknown' },
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
