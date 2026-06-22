import { Router, Request, Response } from 'express';
import { prisma } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/requireAdmin';

const router = Router();
router.use(requireAuth, requireAdmin);

// GET /api/admin/stats
router.get('/', async (_req: Request, res: Response) => {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [customers, orders, devices, revenueAgg, todayOrders] = await Promise.all([
    prisma.customer.count(),
    prisma.order.count(),
    prisma.deviceToken.count(),
    prisma.order.aggregate({ _sum: { totalPrice: true } }),
    prisma.order.count({ where: { createdAt: { gte: startOfToday } } }),
  ]);

  res.json({
    customers,
    orders,
    devices,
    revenue: Number(revenueAgg._sum.totalPrice ?? 0),
    todayOrders,
  });
});

export default router;