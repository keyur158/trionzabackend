jest.mock('../config/shopify', () => ({
  shopifyGraphQL: jest.fn(),
  shopifyStorefrontGraphQL: jest.fn(),
}));

import { shopifyGraphQL } from '../config/shopify';
import { validateShopifyDiscount } from '../services/shopify-discount';

const mockGraphQL = shopifyGraphQL as jest.Mock;

function basicDiscount(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      codeDiscountNodeByCode: {
        id: 'gid://shopify/DiscountCodeNode/1',
        codeDiscount: {
          __typename: 'DiscountCodeBasic',
          title: 'SAVE10',
          status: 'ACTIVE',
          startsAt: '2026-01-01T00:00:00Z',
          endsAt: null,
          usageLimit: null,
          asyncUsageCount: 0,
          customerGets: {
            value: { __typename: 'DiscountPercentage', percentage: 0.1 },
            items: { __typename: 'AllDiscountItems' },
          },
          minimumRequirement: null,
          ...overrides,
        },
      },
    },
  };
}

describe('validateShopifyDiscount', () => {
  beforeEach(() => jest.clearAllMocks());

  it('accepts an active percentage code (Shopify returns a 0..1 fraction)', async () => {
    mockGraphQL.mockResolvedValueOnce(basicDiscount());
    const r = await validateShopifyDiscount('SAVE10', 500);
    expect(r).toEqual({
      ok: true,
      discount: { code: 'SAVE10', discountType: 'percentage', discountValue: 10, minOrderValue: null, scope: { kind: 'all' } },
    });
  });

  it('accepts a fixed-amount code', async () => {
    mockGraphQL.mockResolvedValueOnce(basicDiscount({
      customerGets: {
        value: { __typename: 'DiscountAmount', amount: { amount: '50.0', currencyCode: 'USD' } },
        items: { __typename: 'AllDiscountItems' },
      },
    }));
    const r = await validateShopifyDiscount('FLAT50', 500);
    expect(r).toEqual({
      ok: true,
      discount: { code: 'FLAT50', discountType: 'fixed', discountValue: 50, minOrderValue: null, scope: { kind: 'all' } },
    });
  });

  it('rejects an unknown code with 404', async () => {
    mockGraphQL.mockResolvedValueOnce({ data: { codeDiscountNodeByCode: null } });
    const r = await validateShopifyDiscount('NOPE', 500);
    expect(r).toEqual({ ok: false, status: 404, message: 'Invalid discount code' });
  });

  it('rejects non-basic code types (free shipping / BxGy)', async () => {
    mockGraphQL.mockResolvedValueOnce({
      data: {
        codeDiscountNodeByCode: {
          codeDiscount: { __typename: 'DiscountCodeFreeShipping', status: 'ACTIVE' },
        },
      },
    });
    const r = await validateShopifyDiscount('FREESHIP', 500);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("isn't supported");
  });

  it('rejects inactive, not-yet-started, and expired codes', async () => {
    mockGraphQL.mockResolvedValueOnce(basicDiscount({ status: 'EXPIRED' }));
    expect((await validateShopifyDiscount('X', 500)).ok).toBe(false);

    mockGraphQL.mockResolvedValueOnce(basicDiscount({ startsAt: '2099-01-01T00:00:00Z' }));
    expect((await validateShopifyDiscount('X', 500)).ok).toBe(false);

    mockGraphQL.mockResolvedValueOnce(basicDiscount({ endsAt: '2020-01-01T00:00:00Z' }));
    const r = await validateShopifyDiscount('X', 500);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('expired');
  });

  it('rejects codes at their usage limit', async () => {
    mockGraphQL.mockResolvedValueOnce(basicDiscount({ usageLimit: 5, asyncUsageCount: 5 }));
    const r = await validateShopifyDiscount('X', 500);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('usage limit');
  });

  it('parses product-scoped codes into a products scope', async () => {
    mockGraphQL.mockResolvedValueOnce(basicDiscount({
      customerGets: {
        value: { __typename: 'DiscountPercentage', percentage: 0.1 },
        items: {
          __typename: 'DiscountProducts',
          products: { nodes: [{ id: 'gid://shopify/Product/456' }], pageInfo: { hasNextPage: false, endCursor: null } },
          productVariants: { nodes: [{ product: { id: 'gid://shopify/Product/789' } }], pageInfo: { hasNextPage: false, endCursor: null } },
        },
      },
    }));
    const r = await validateShopifyDiscount('PROD', 500);
    expect(r).toMatchObject({ ok: true, discount: { scope: { kind: 'products', ids: ['456', '789'] } } });
  });

  it('parses collection-scoped codes into a collections scope', async () => {
    mockGraphQL.mockResolvedValueOnce(basicDiscount({
      customerGets: {
        value: { __typename: 'DiscountPercentage', percentage: 0.1 },
        items: {
          __typename: 'DiscountCollections',
          collections: { nodes: [{ id: 'gid://shopify/Collection/11' }, { id: 'gid://shopify/Collection/22' }], pageInfo: { hasNextPage: false, endCursor: null } },
        },
      },
    }));
    const r = await validateShopifyDiscount('COLL', 500);
    expect(r).toMatchObject({ ok: true, discount: { scope: { kind: 'collections', ids: ['11', '22'] } } });
  });

  it('paginates a collection scope that spans multiple pages', async () => {
    mockGraphQL
      .mockResolvedValueOnce(basicDiscount({
        customerGets: {
          value: { __typename: 'DiscountPercentage', percentage: 0.1 },
          items: {
            __typename: 'DiscountCollections',
            collections: { nodes: [{ id: 'gid://shopify/Collection/11' }], pageInfo: { hasNextPage: true, endCursor: 'CURSOR1' } },
          },
        },
      }))
      .mockResolvedValueOnce({
        data: { codeDiscountNode: { codeDiscount: { customerGets: { items: {
          collections: { nodes: [{ id: 'gid://shopify/Collection/22' }], pageInfo: { hasNextPage: false, endCursor: null } },
        } } } } },
      });
    const r = await validateShopifyDiscount('COLL', 500);
    expect(r).toMatchObject({ ok: true, discount: { scope: { kind: 'collections', ids: ['11', '22'] } } });
  });

  it('paginates a products scope that spans multiple pages', async () => {
    mockGraphQL
      .mockResolvedValueOnce(basicDiscount({
        customerGets: {
          value: { __typename: 'DiscountPercentage', percentage: 0.1 },
          items: {
            __typename: 'DiscountProducts',
            products: { nodes: [{ id: 'gid://shopify/Product/111' }], pageInfo: { hasNextPage: true, endCursor: 'CURSOR1' } },
            productVariants: { nodes: [{ product: { id: 'gid://shopify/Product/222' } }], pageInfo: { hasNextPage: false, endCursor: null } },
          },
        },
      }))
      .mockResolvedValueOnce({
        data: { codeDiscountNode: { codeDiscount: { customerGets: { items: {
          products: { nodes: [{ id: 'gid://shopify/Product/333' }], pageInfo: { hasNextPage: false, endCursor: null } },
        } } } } },
      });
    const r = await validateShopifyDiscount('PROD', 500);
    expect(r).toMatchObject({ ok: true, discount: { scope: { kind: 'products', ids: expect.arrayContaining(['111', '222', '333']) } } });
    if (r.ok) expect(r.discount.scope.kind === 'products' && r.discount.scope.ids).toHaveLength(3);
  });

  it('fails closed with 503 when a paginated follow-up page throws', async () => {
    mockGraphQL
      .mockResolvedValueOnce(basicDiscount({
        customerGets: {
          value: { __typename: 'DiscountPercentage', percentage: 0.1 },
          items: {
            __typename: 'DiscountCollections',
            collections: { nodes: [{ id: 'gid://shopify/Collection/11' }], pageInfo: { hasNextPage: true, endCursor: 'CURSOR1' } },
          },
        },
      }))
      .mockRejectedValueOnce(new Error('network'));
    const r = await validateShopifyDiscount('COLL', 500);
    expect(r).toEqual({
      ok: false,
      status: 503,
      message: "Couldn't verify the code right now. Please try again.",
    });
  });

  it('fails closed with 503 when a paginated follow-up page returns GraphQL errors', async () => {
    mockGraphQL
      .mockResolvedValueOnce(basicDiscount({
        customerGets: {
          value: { __typename: 'DiscountPercentage', percentage: 0.1 },
          items: {
            __typename: 'DiscountCollections',
            collections: { nodes: [{ id: 'gid://shopify/Collection/11' }], pageInfo: { hasNextPage: true, endCursor: 'CURSOR1' } },
          },
        },
      }))
      .mockResolvedValueOnce({ errors: [{ message: 'throttled' }] });
    const r = await validateShopifyDiscount('COLL', 500);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(503);
  });

  it('enforces the minimum subtotal with the amount in the message', async () => {
    mockGraphQL.mockResolvedValueOnce(basicDiscount({
      minimumRequirement: {
        __typename: 'DiscountMinimumSubtotal',
        greaterThanOrEqualToSubtotal: { amount: '500.0' },
      },
    }));
    const r = await validateShopifyDiscount('X', 100);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('$500.00');
  });

  it('passes the minimum through on success', async () => {
    mockGraphQL.mockResolvedValueOnce(basicDiscount({
      minimumRequirement: {
        __typename: 'DiscountMinimumSubtotal',
        greaterThanOrEqualToSubtotal: { amount: '500.0' },
      },
    }));
    const r = await validateShopifyDiscount('X', 600);
    expect(r).toMatchObject({ ok: true, discount: { minOrderValue: 500 } });
  });

  it('rejects minimum-quantity requirements as unsupported', async () => {
    mockGraphQL.mockResolvedValueOnce(basicDiscount({
      minimumRequirement: {
        __typename: 'DiscountMinimumQuantity',
        greaterThanOrEqualToQuantity: '2',
      },
    }));
    expect((await validateShopifyDiscount('X', 600)).ok).toBe(false);
  });

  it('fails closed with 503 on API errors', async () => {
    mockGraphQL.mockRejectedValueOnce(new Error('network'));
    const r = await validateShopifyDiscount('X', 500);
    expect(r).toEqual({
      ok: false,
      status: 503,
      message: "Couldn't verify the code right now. Please try again.",
    });

    mockGraphQL.mockResolvedValueOnce({ errors: [{ message: 'throttled' }] });
    const r2 = await validateShopifyDiscount('X', 500);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.status).toBe(503);
  });
});
