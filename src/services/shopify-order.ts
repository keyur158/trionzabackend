import { shopifyGraphQL } from '../config/shopify';
import { prisma } from '../config/database';

interface ShopifyLineItem {
  variantId: string;
  quantity: number;
}

interface ShopifyAddress {
  address1: string;
  address2?: string | null;
  city: string;
  province?: string | null;
  country: string;
  zip: string;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
}

interface CreateShopifyOrderInput {
  lineItems: ShopifyLineItem[];
  shopifyCustomerId: string;
  customerEmail: string;
  shippingAddress: ShopifyAddress;
  totalPrice: string;
  paypalTransactionId: string;
}

export async function createShopifyOrder(data: CreateShopifyOrderInput): Promise<{ id: string; name: string } | null> {
  const mutation = `
    mutation orderCreate($order: OrderCreateOrderInput!) {
      orderCreate(order: $order) {
        order { id name }
        userErrors { field message }
      }
    }
  `;
  const variables = {
    order: {
      lineItems: data.lineItems.map(li => ({
        variantId: `gid://shopify/ProductVariant/${li.variantId}`,
        quantity: li.quantity,
      })),
      customerId: data.shopifyCustomerId,
      email: data.customerEmail,
      financialStatus: 'PAID',
      shippingAddress: {
        firstName: data.shippingAddress.firstName ?? '',
        lastName: data.shippingAddress.lastName ?? '',
        address1: data.shippingAddress.address1,
        address2: data.shippingAddress.address2 ?? '',
        city: data.shippingAddress.city,
        province: data.shippingAddress.province ?? '',
        country: data.shippingAddress.country,
        zip: data.shippingAddress.zip,
        phone: data.shippingAddress.phone ?? '',
      },
      tags: ['mobile-app', 'paypal'],
      note: `PayPal: ${data.paypalTransactionId}`,
      transactions: [{
        kind: 'SALE',
        status: 'SUCCESS',
        amountSet: {
          shopMoney: { amount: data.totalPrice, currencyCode: 'USD' },
          presentmentMoney: { amount: data.totalPrice, currencyCode: 'USD' },
        },
        gateway: 'PayPal',
      }],
    },
  };

  try {
    const response = await shopifyGraphQL(mutation, variables);
    const result = response.data?.orderCreate;
    if (result?.userErrors?.length > 0) {
      console.error('Shopify order create errors:', result.userErrors);
      return null;
    }
    const order = result?.order ?? null;
    if (order?.id) {
      await sendOrderConfirmationEmail(order.id, data.customerEmail);
    }
    return order;
  } catch (err) {
    console.error('Failed to create Shopify order:', err);
    return null;
  }
}

async function sendOrderConfirmationEmail(orderId: string, customerEmail: string): Promise<void> {
  const mutation = `
    mutation orderInvoiceSend($id: ID!, $email: EmailInput) {
      orderInvoiceSend(id: $id, email: $email) {
        order { id }
        userErrors { field message }
      }
    }
  `;
  try {
    const response = await shopifyGraphQL(mutation, {
      id: orderId,
      email: { to: customerEmail },
    });
    const errors = response.data?.orderInvoiceSend?.userErrors;
    if (errors?.length > 0) {
      console.error('orderInvoiceSend errors:', errors);
    } else {
      console.log(`Order confirmation email sent to ${customerEmail} for order ${orderId}`);
    }
  } catch (err) {
    console.error('Failed to send order confirmation email:', err);
  }
}

export async function updateOrderFromWebhook(payload: Record<string, unknown>): Promise<void> {
  const shopifyOrderId = String(payload.id ?? '');
  if (!shopifyOrderId) return;

  const fulfillments = payload.fulfillments as Array<Record<string, unknown>> | undefined;
  const firstFulfillment = fulfillments?.[0];

  await prisma.order.updateMany({
    where: { shopifyOrderId },
    data: {
      financialStatus: (payload.financial_status as string) ?? undefined,
      fulfillmentStatus: (payload.fulfillment_status as string) ?? undefined,
      trackingUrl: (firstFulfillment?.tracking_url as string) ?? undefined,
      trackingNumber: (firstFulfillment?.tracking_number as string) ?? undefined,
      shopifyUpdatedAt: payload.updated_at ? new Date(payload.updated_at as string) : undefined,
    },
  });
}
