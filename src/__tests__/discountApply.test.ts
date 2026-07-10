jest.mock('../config/database', () => ({
  prisma: { collectionProduct: { findMany: jest.fn() } },
}));

import { prisma } from '../config/database';
import { computeDiscountAmount, DiscountNotApplicableError } from '../services/discount-apply';
import { ValidatedDiscount } from '../services/shopify-discount';

const findMany = prisma.collectionProduct.findMany as jest.Mock;

function discount(overrides: Partial<ValidatedDiscount> = {}): ValidatedDiscount {
  return { code: 'C', discountType: 'percentage', discountValue: 10, minOrderValue: null, scope: { kind: 'all' }, ...overrides };
}

const lines = [
  { productId: 'p1', price: 800, quantity: 1 },
  { productId: 'p2', price: 500, quantity: 1 },
];

describe('computeDiscountAmount', () => {
  beforeEach(() => jest.clearAllMocks());

  it('percentage over the whole cart for an all-items code', async () => {
    const amount = await computeDiscountAmount(discount(), lines);
    expect(amount).toBe(130); // 10% of 1300
  });

  it('percentage over eligible collection items only', async () => {
    findMany.mockResolvedValue([{ productId: 'p1' }]); // only p1 is in the collection
    const amount = await computeDiscountAmount(
      discount({ scope: { kind: 'collections', ids: ['c1'] } }),
      lines,
    );
    expect(amount).toBe(80); // 10% of 800
    expect(findMany).toHaveBeenCalledWith({
      where: { collectionId: { in: ['c1'] }, productId: { in: ['p1', 'p2'] } },
      select: { productId: true },
    });
  });

  it('percentage over eligible product-scoped items only', async () => {
    const amount = await computeDiscountAmount(
      discount({ scope: { kind: 'products', ids: ['p2'] } }),
      lines,
    );
    expect(amount).toBe(50); // 10% of 500
    expect(findMany).not.toHaveBeenCalled();
  });

  it('caps a fixed code at the eligible subtotal', async () => {
    const amount = await computeDiscountAmount(
      discount({ discountType: 'fixed', discountValue: 900, scope: { kind: 'products', ids: ['p2'] } }),
      lines,
    );
    expect(amount).toBe(500); // min(900, 500 eligible)
  });

  it('rounds to cents', async () => {
    const amount = await computeDiscountAmount(
      discount({ discountValue: 15 }),
      [{ productId: 'p1', price: 33.33, quantity: 1 }],
    );
    expect(amount).toBe(5); // 15% of 33.33 = 4.9995 -> 5.00
  });

  it('throws 400 when a scoped code matches nothing in the cart', async () => {
    findMany.mockResolvedValue([]);
    await expect(
      computeDiscountAmount(discount({ scope: { kind: 'collections', ids: ['cX'] } }), lines),
    ).rejects.toMatchObject({ statusCode: 400, message: "This code applies to select items that aren't in your cart." });
    await expect(
      computeDiscountAmount(discount({ scope: { kind: 'collections', ids: ['cX'] } }), lines),
    ).rejects.toBeInstanceOf(DiscountNotApplicableError);
  });
});
