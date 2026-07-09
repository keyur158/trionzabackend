import { shopifyGraphQL } from '../config/shopify';

export interface ValidatedDiscount {
  code: string;
  discountType: 'percentage' | 'fixed';
  discountValue: number; // 10 => 10% off; 50 => $50 off
  minOrderValue: number | null;
}

export type DiscountValidation =
  | { ok: true; discount: ValidatedDiscount }
  | { ok: false; status: number; message: string };

const DISCOUNT_QUERY = `
  query DiscountByCode($code: String!) {
    codeDiscountNodeByCode(code: $code) {
      codeDiscount {
        __typename
        ... on DiscountCodeBasic {
          title
          status
          startsAt
          endsAt
          usageLimit
          asyncUsageCount
          customerGets {
            value {
              __typename
              ... on DiscountPercentage { percentage }
              ... on DiscountAmount { amount { amount currencyCode } }
            }
            items { __typename }
          }
          minimumRequirement {
            __typename
            ... on DiscountMinimumSubtotal { greaterThanOrEqualToSubtotal { amount } }
          }
        }
      }
    }
  }
`;

const UNAVAILABLE: DiscountValidation = {
  ok: false,
  status: 503,
  message: "Couldn't verify the code right now. Please try again.",
};

/**
 * Validates a Shopify discount code against the Admin API. Only
 * "Amount off order" (DiscountCodeBasic, all items) codes are supported.
 * Fails CLOSED: any API failure returns 503 rather than accepting/ignoring.
 */
export async function validateShopifyDiscount(
  code: string,
  subtotal: number
): Promise<DiscountValidation> {
  let data;
  try {
    data = await shopifyGraphQL(DISCOUNT_QUERY, { code });
  } catch (err) {
    console.error('Shopify discount lookup failed:', err);
    return UNAVAILABLE;
  }
  if (data.errors) {
    console.error('Shopify discount lookup errors:', data.errors);
    return UNAVAILABLE;
  }

  const d = data.data?.codeDiscountNodeByCode?.codeDiscount;
  if (!d) return { ok: false, status: 404, message: 'Invalid discount code' };

  if (d.__typename !== 'DiscountCodeBasic') {
    return { ok: false, status: 400, message: "This code type isn't supported in the app" };
  }
  if (d.status !== 'ACTIVE') {
    return d.status === 'EXPIRED'
      ? { ok: false, status: 400, message: 'This code has expired' }
      : { ok: false, status: 400, message: 'This code is not active' };
  }
  const now = new Date();
  if (d.startsAt && new Date(d.startsAt) > now) {
    return { ok: false, status: 400, message: 'This code is not active yet' };
  }
  if (d.endsAt && new Date(d.endsAt) < now) {
    return { ok: false, status: 400, message: 'This code has expired' };
  }
  if (d.usageLimit != null && d.asyncUsageCount >= d.usageLimit) {
    return { ok: false, status: 400, message: 'This code has reached its usage limit' };
  }
  if (d.customerGets?.items?.__typename !== 'AllDiscountItems') {
    return {
      ok: false,
      status: 400,
      message: "This code applies to specific products and isn't supported in the app",
    };
  }

  let minOrderValue: number | null = null;
  if (d.minimumRequirement) {
    if (d.minimumRequirement.__typename !== 'DiscountMinimumSubtotal') {
      return { ok: false, status: 400, message: "This code type isn't supported in the app" };
    }
    minOrderValue = parseFloat(d.minimumRequirement.greaterThanOrEqualToSubtotal.amount);
    if (subtotal < minOrderValue) {
      return {
        ok: false,
        status: 400,
        message: `This code requires a minimum order of $${minOrderValue.toFixed(2)}`,
      };
    }
  }

  const value = d.customerGets?.value;
  if (value?.__typename === 'DiscountPercentage') {
    // Shopify returns a 0..1 fraction (0.1 = 10%)
    return {
      ok: true,
      discount: {
        code,
        discountType: 'percentage',
        discountValue: value.percentage * 100,
        minOrderValue,
      },
    };
  }
  if (value?.__typename === 'DiscountAmount') {
    return {
      ok: true,
      discount: {
        code,
        discountType: 'fixed',
        discountValue: parseFloat(value.amount.amount),
        minOrderValue,
      },
    };
  }
  return { ok: false, status: 400, message: "This code type isn't supported in the app" };
}
