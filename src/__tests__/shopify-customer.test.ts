jest.mock('../config/shopify', () => ({
  shopifyStorefrontGraphQL: jest.fn(),
  shopifyGraphQL: jest.fn(),
}));

import { shopifyStorefrontGraphQL } from '../config/shopify';
import { authenticateViaShopify } from '../services/shopify-customer';

const mockStorefront = shopifyStorefrontGraphQL as jest.Mock;

describe('authenticateViaShopify', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns customer info when Shopify auth succeeds', async () => {
    mockStorefront
      .mockResolvedValueOnce({
        data: {
          customerAccessTokenCreate: {
            customerAccessToken: { accessToken: 'tok_123' },
            customerUserErrors: [],
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          customer: {
            id: 'gid://shopify/Customer/1',
            email: 'test@example.com',
            firstName: 'Jane',
            lastName: 'Doe',
          },
        },
      });

    const result = await authenticateViaShopify('test@example.com', 'password123');

    expect(result).toEqual({
      id: 'gid://shopify/Customer/1',
      email: 'test@example.com',
      firstName: 'Jane',
      lastName: 'Doe',
    });
  });

  it('returns null when Shopify returns user errors', async () => {
    mockStorefront.mockResolvedValueOnce({
      data: {
        customerAccessTokenCreate: {
          customerAccessToken: null,
          customerUserErrors: [{ message: 'Unidentified customer' }],
        },
      },
    });

    const result = await authenticateViaShopify('bad@example.com', 'wrong');
    expect(result).toBeNull();
  });

  it('returns null on network error', async () => {
    mockStorefront.mockRejectedValueOnce(new Error('Network error'));
    const result = await authenticateViaShopify('test@example.com', 'password123');
    expect(result).toBeNull();
  });
});
