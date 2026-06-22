jest.mock('../services/reviews', () => ({
  __esModule: true,
  isVerifiedBuyer: jest.requireActual('../services/reviews').isVerifiedBuyer,
  getProductReviews: jest.fn(),
  createReview: jest.fn(),
  getReviewEligibility: jest.fn(),
  ReviewError: jest.requireActual('../services/reviews').ReviewError,
}));
jest.mock('../middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { id: 'cust_1' };
    next();
  },
}));

import express from 'express';
import request from 'supertest';
import reviewsRouter from '../routes/reviews';
import {
  isVerifiedBuyer,
  getProductReviews,
  createReview,
  getReviewEligibility,
  ReviewError,
} from '../services/reviews';

const mockGet = getProductReviews as jest.Mock;
const mockCreate = createReview as jest.Mock;
const mockElig = getReviewEligibility as jest.Mock;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/products', reviewsRouter);
  return app;
}
const app = buildApp();

describe('isVerifiedBuyer (pure)', () => {
  it('is true when an order line item matches the product', () => {
    const orders = [{ lineItems: [{ productId: 'p1', quantity: 1 }] }];
    expect(isVerifiedBuyer(orders, 'p1')).toBe(true);
  });
  it('is false when no line item matches', () => {
    const orders = [{ lineItems: [{ productId: 'p2' }] }];
    expect(isVerifiedBuyer(orders, 'p1')).toBe(false);
  });
});

describe('GET /api/products/:handle/reviews', () => {
  beforeEach(() => jest.clearAllMocks());
  it('returns the summary + reviews', async () => {
    mockGet.mockResolvedValue({
      summary: { average: 4.5, count: 2, distribution: { 5: 1, 4: 1 } },
      reviews: [],
      page: 1,
      hasMore: false,
    });
    const res = await request(app).get('/api/products/ring-a/reviews');
    expect(res.status).toBe(200);
    expect(res.body.summary.average).toBe(4.5);
    expect(mockGet).toHaveBeenCalledWith('ring-a', 1, 10);
  });
});

describe('POST /api/products/:handle/reviews', () => {
  beforeEach(() => jest.clearAllMocks());
  const valid = { rating: 5, title: 'Stunning', body: 'Sparkles beautifully.' };

  it('rejects an out-of-range rating', async () => {
    const res = await request(app)
      .post('/api/products/ring-a/reviews')
      .send({ ...valid, rating: 9 });
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('creates a review for an authed customer', async () => {
    mockCreate.mockResolvedValue({ id: 'r1', rating: 5 });
    const res = await request(app)
      .post('/api/products/ring-a/reviews')
      .send(valid);
    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith('ring-a', 'cust_1', valid);
  });

  it('maps duplicate to 409', async () => {
    mockCreate.mockRejectedValue(new ReviewError('DUPLICATE', 'Already reviewed'));
    const res = await request(app)
      .post('/api/products/ring-a/reviews')
      .send(valid);
    expect(res.status).toBe(409);
  });

  it('maps not-found product to 404', async () => {
    mockCreate.mockRejectedValue(new ReviewError('NOT_FOUND', 'No product'));
    const res = await request(app)
      .post('/api/products/missing/reviews')
      .send(valid);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/products/:handle/reviews/eligibility', () => {
  beforeEach(() => jest.clearAllMocks());
  it('returns eligibility flags', async () => {
    mockElig.mockResolvedValue({
      canReview: true,
      alreadyReviewed: false,
      isVerifiedBuyer: true,
    });
    const res = await request(app).get(
      '/api/products/ring-a/reviews/eligibility',
    );
    expect(res.status).toBe(200);
    expect(res.body.canReview).toBe(true);
  });
});