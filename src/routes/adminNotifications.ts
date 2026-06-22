import { Router, Request, Response } from 'express';
import { prisma } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/requireAdmin';
import { sendPushToTokens } from '../services/push';

const router = Router();
router.use(requireAuth, requireAdmin);

// POST /api/admin/notifications/send  { title, body, link? }
router.post('/send', async (req: Request, res: Response) => {
  const { title, body, link } = req.body ?? {};
  if (typeof title !== 'string' || !title.trim() || typeof body !== 'string' || !body.trim()) {
    res.status(400).json({ message: 'title and body are required' });
    return;
  }
  const rows = await prisma.deviceToken.findMany({ select: { fcmToken: true } });
  const tokens = rows.map((r) => r.fcmToken);
  const data: Record<string, string> = {};
  if (typeof link === 'string' && link.trim()) data.link = link.trim();
  const result = await sendPushToTokens(tokens, title.trim(), body.trim(), data);
  res.json({ sent: result.successCount, failed: result.failureCount, recipients: tokens.length });
});

export default router;