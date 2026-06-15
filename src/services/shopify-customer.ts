import { shopifyGraphQL, shopifyStorefrontGraphQL } from '../config/shopify';

interface CustomerCreateInput {
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
}

async function findShopifyCustomerByEmail(email: string): Promise<string | null> {
  const query = `
    query FindCustomer($query: String!) {
      customers(first: 1, query: $query) {
        edges { node { id } }
      }
    }
  `;
  try {
    const response = await shopifyGraphQL(query, { query: `email:${email}` });
    return response.data?.customers?.edges?.[0]?.node?.id ?? null;
  } catch (err) {
    console.error('Failed to find Shopify customer by email:', err);
    return null;
  }
}

interface ShopifyCustomerLookup {
  id: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
}

// Looks up an existing Shopify customer by email, returning basic profile fields.
// Used to migrate Shopify-only customers into the local DB on their first OTP login.
export async function getShopifyCustomerByEmail(email: string): Promise<ShopifyCustomerLookup | null> {
  const query = `
    query FindCustomer($query: String!) {
      customers(first: 1, query: $query) {
        edges { node { id firstName lastName phone } }
      }
    }
  `;
  try {
    const response = await shopifyGraphQL(query, { query: `email:${email}` });
    const node = response.data?.customers?.edges?.[0]?.node;
    if (!node?.id) return null;
    return {
      id: node.id as string,
      firstName: (node.firstName as string) ?? null,
      lastName: (node.lastName as string) ?? null,
      phone: (node.phone as string) ?? null,
    };
  } catch (err) {
    console.error('Failed to look up Shopify customer by email:', err);
    return null;
  }
}

// Like createShopifyCustomer but falls back to looking up an existing customer if the
// email is already taken — used during checkout so order sync always has a Shopify customer ID.
export async function createOrFindShopifyCustomer(data: CustomerCreateInput): Promise<string | null> {
  const mutation = `
    mutation customerCreate($input: CustomerInput!) {
      customerCreate(input: $input) {
        customer { id }
        userErrors { field message }
      }
    }
  `;
  try {
    const response = await shopifyGraphQL(mutation, {
      input: {
        email: data.email,
        firstName: data.firstName ?? '',
        lastName: data.lastName ?? '',
        phone: data.phone ?? undefined,
      },
    });
    const result = response.data?.customerCreate;
    if (result?.customer?.id) return result.customer.id;

    const emailTaken = result?.userErrors?.some(
      (e: { message: string }) => e.message?.toLowerCase().includes('email')
    );
    if (emailTaken) return findShopifyCustomerByEmail(data.email);

    console.error('Shopify customer create errors:', result?.userErrors);
    return null;
  } catch (err) {
    console.error('Failed to create/find Shopify customer:', err);
    return null;
  }
}

interface CustomerUpdateInput {
  firstName?: string;
  lastName?: string;
  phone?: string;
}

export async function createShopifyCustomer(data: CustomerCreateInput): Promise<string | null> {
  const mutation = `
    mutation customerCreate($input: CustomerInput!) {
      customerCreate(input: $input) {
        customer { id }
        userErrors { field message }
      }
    }
  `;
  try {
    const response = await shopifyGraphQL(mutation, {
      input: {
        email: data.email,
        firstName: data.firstName ?? '',
        lastName: data.lastName ?? '',
        phone: data.phone ?? undefined,
      },
    });
    const result = response.data?.customerCreate;
    if (result?.userErrors?.length > 0) {
      console.error('Shopify customer create errors:', result.userErrors);
      return null;
    }
    return result?.customer?.id ?? null;
  } catch (err) {
    console.error('Failed to create Shopify customer:', err);
    return null;
  }
}

export async function updateShopifyCustomer(shopifyGid: string, data: CustomerUpdateInput): Promise<void> {
  const mutation = `
    mutation customerUpdate($input: CustomerInput!) {
      customerUpdate(input: $input) {
        customer { id }
        userErrors { field message }
      }
    }
  `;
  try {
    await shopifyGraphQL(mutation, {
      input: {
        id: shopifyGid,
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone ?? undefined,
      },
    });
  } catch (err) {
    console.error('Failed to update Shopify customer:', err);
  }
}

interface ShopifyAuthResult {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
}

export async function authenticateViaShopify(
  email: string,
  password: string
): Promise<ShopifyAuthResult | null> {
  const tokenMutation = `
    mutation customerAccessTokenCreate($input: CustomerAccessTokenCreateInput!) {
      customerAccessTokenCreate(input: $input) {
        customerAccessToken { accessToken }
        customerUserErrors { message }
      }
    }
  `;
  try {
    const tokenRes = await shopifyStorefrontGraphQL(tokenMutation, {
      input: { email, password },
    });
    const tokenResult = tokenRes.data?.customerAccessTokenCreate;
    if (
      !tokenResult?.customerAccessToken?.accessToken ||
      tokenResult.customerUserErrors?.length > 0
    ) {
      return null;
    }
    const accessToken = tokenResult.customerAccessToken.accessToken as string;

    const customerQuery = `
      query getCustomer($token: String!) {
        customer(customerAccessToken: $token) {
          id
          email
          firstName
          lastName
        }
      }
    `;
    const customerRes = await shopifyStorefrontGraphQL(customerQuery, {
      token: accessToken,
    });
    const c = customerRes.data?.customer;
    if (!c) return null;
    return {
      id: c.id as string,
      email: c.email as string,
      firstName: (c.firstName as string) ?? null,
      lastName: (c.lastName as string) ?? null,
    };
  } catch (err) {
    console.error('Shopify auth failed:', err);
    return null;
  }
}
