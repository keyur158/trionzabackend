jest.mock('../config/shopify', () => ({
  shopifyGraphQL: jest.fn(),
  shopifyStorefrontGraphQL: jest.fn(),
}));
jest.mock('../config/database', () => ({ prisma: {} }));

import { shopifyGraphQL } from '../config/shopify';
import { createShopifyOrder } from '../services/shopify-order';

const mockGraphQL = shopifyGraphQL as jest.Mock;

const baseInput = {
  lineItems: [{ variantId: '111', quantity: 1 }],
  shopifyCustomerId: 'gid://shopify/Customer/1',
  customerEmail: 'a@a.com',
  shippingAddress: { address1: '1 St', city: 'X', country: 'US', zip: '10001' },
  totalPrice: '470.00',
  paypalTransactionId: 'TXN-1',
};

describe('createShopifyOrder discount attachment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGraphQL.mockResolvedValue({
      data: { orderCreate: { order: { id: 'gid://shopify/Order/9', name: '#1009' }, userErrors: [] } },
    });
  });

  it('sends itemPercentageDiscountCode for percentage discounts', async () => {
    await createShopifyOrder({
      ...baseInput,
      discount: { code: 'SAVE10', discountType: 'percentage', discountValue: 10, minOrderValue: null, scope: { kind: 'all' } },
    });

    const variables = mockGraphQL.mock.calls[0][1];
    expect(variables.order.discountCode).toEqual({
      itemPercentageDiscountCode: { code: 'SAVE10', percentage: 10 },
    });
  });

  it('sends itemFixedDiscountCode for fixed discounts', async () => {
    await createShopifyOrder({
      ...baseInput,
      discount: { code: 'FLAT50', discountType: 'fixed', discountValue: 50, minOrderValue: null, scope: { kind: 'all' } },
    });

    const variables = mockGraphQL.mock.calls[0][1];
    expect(variables.order.discountCode).toEqual({
      itemFixedDiscountCode: {
        code: 'FLAT50',
        amountSet: {
          shopMoney: { amount: '50.00', currencyCode: 'USD' },
          presentmentMoney: { amount: '50.00', currencyCode: 'USD' },
        },
      },
    });
  });

  it('caps the fixed amountSet at the applied (subtotal-capped) amount, not the raw code value', async () => {
    // A $900 fixed code on a $500 subtotal: computeTotals caps the charge at 500,
    // and that capped amount is what Shopify must receive.
    await createShopifyOrder({
      ...baseInput,
      totalPrice: '20.00',
      discount: { code: 'FLAT900', discountType: 'fixed', discountValue: 900, minOrderValue: null, scope: { kind: 'all' } },
      appliedDiscountAmount: 500,
    });

    const variables = mockGraphQL.mock.calls[0][1];
    expect(variables.order.discountCode).toEqual({
      itemFixedDiscountCode: {
        code: 'FLAT900',
        amountSet: {
          shopMoney: { amount: '500.00', currencyCode: 'USD' },
          presentmentMoney: { amount: '500.00', currencyCode: 'USD' },
        },
      },
    });
  });

  it('sends itemFixedDiscountCode for a scoped percentage discount', async () => {
    await createShopifyOrder({
      ...baseInput,
      discount: { code: 'TEST10', discountType: 'percentage', discountValue: 10, minOrderValue: null, scope: { kind: 'collections', ids: ['11'] } },
      appliedDiscountAmount: 80,
    });
    const variables = mockGraphQL.mock.calls[0][1];
    expect(variables.order.discountCode).toEqual({
      itemFixedDiscountCode: {
        code: 'TEST10',
        amountSet: {
          shopMoney: { amount: '80.00', currencyCode: 'USD' },
          presentmentMoney: { amount: '80.00', currencyCode: 'USD' },
        },
      },
    });
  });

  it('omits discountCode when no discount is applied', async () => {
    await createShopifyOrder(baseInput);
    const variables = mockGraphQL.mock.calls[0][1];
    expect(variables.order.discountCode).toBeUndefined();
  });
});
