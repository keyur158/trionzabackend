jest.mock('../middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { id: 'admin_1', email: 'admin@trionza.com' };
    next();
  },
}));
jest.mock('../utils/admin', () => ({ isAdminEmail: () => true }));
jest.mock('../services/reviews', () => ({
  __esModule: true,
  listAllReviews: jest.fn(),
  setReviewStatus: jest.fn(),
  adminDeleteReview: jest.fn(),
  ReviewError: jest.requireActual('../services/reviews').ReviewError,
}));

import express from 'express';
import request from 'supertest';
import adminReviewsRouter from '../routes/adminReviews';
import { listAllReviews, setReviewStatus, adminDeleteReview, ReviewError } from '../services/reviews';

const mockList = listAllReviews as jest.Mock;
const mockSetStatus = setReviewStatus as jest.Mock;
const mockDelete = adminDeleteReview as jest.Mock;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/reviews', adminReviewsRouter);
  return app;
}
const app = buildApp();

describe('GET /api/admin/reviews', () => {
  beforeEach(() => jest.clearAllMocks());
  it('returns a paginated list', async () => {
    mockList.mockResolvedValue({ reviews: [{ id: 'r1' }], page: 1, hasMore: false });
    const res = await request(app).get('/api/admin/reviews?page=1');
    expect(res.status).toBe(200);
    expect(res.body.reviews).toHaveLength(1);
    expect(mockList).toHaveBeenCalledWith(1, 20);
  });
});

describe('PATCH /api/admin/reviews/:id', () => {
  beforeEach(() => jest.clearAllMocks());
  it('rejects an invalid status', async () => {
    const res = await request(app).patch('/api/admin/reviews/r1').send({ status: 'nope' });
    expect(res.status).toBe(400);
    expect(mockSetStatus).not.toHaveBeenCalled();
  });
  it('hides a review', async () => {
    mockSetStatus.mockResolvedValue({ id: 'r1', status: 'hidden' });
    const res = await request(app).patch('/api/admin/reviews/r1').send({ status: 'hidden' });
    expect(res.status).toBe(200);
    expect(res.body.review.status).toBe('hidden');
    expect(mockSetStatus).toHaveBeenCalledWith('r1', 'hidden');
  });
  it('maps a missing review to 404', async () => {
    mockSetStatus.mockRejectedValue(new ReviewError('NOT_FOUND', 'gone'));
    const res = await request(app).patch('/api/admin/reviews/r1').send({ status: 'published' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/admin/reviews/:id', () => {
  beforeEach(() => jest.clearAllMocks());
  it('deletes a review', async () => {
    mockDelete.mockResolvedValue(undefined);
    const res = await request(app).delete('/api/admin/reviews/r1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(mockDelete).toHaveBeenCalledWith('r1');
  });
  it('maps a missing review to 404', async () => {
    mockDelete.mockRejectedValue(new ReviewError('NOT_FOUND', 'gone'));
    const res = await request(app).delete('/api/admin/reviews/r1');
    expect(res.status).toBe(404);
  });
});