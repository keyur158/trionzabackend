import axios from 'axios';
import { env } from './env';

const shopifyApiBase = `https://${env.SHOPIFY_STORE_DOMAIN}/admin/api/${env.SHOPIFY_API_VERSION}`;
const shopifyStorefrontBase = `https://${env.SHOPIFY_STORE_DOMAIN}/api/${env.SHOPIFY_API_VERSION}`;

let cachedToken: string | null = null;

// Exchange client_id + client_secret for an offline access token (Client Credentials Grant).
// Shopify returns a permanent offline token — cache it for the process lifetime.
async function getAccessToken(): Promise<string> {
  if (cachedToken) return cachedToken;

  const res = await axios.post(
    `https://${env.SHOPIFY_STORE_DOMAIN}/admin/oauth/access_token`,
    {
      client_id: env.SHOPIFY_CLIENT_ID,
      client_secret: env.SHOPIFY_CLIENT_SECRET,
      grant_type: 'client_credentials',
    },
    { headers: { 'Content-Type': 'application/json' } }
  );

  cachedToken = res.data.access_token as string;
  return cachedToken;
}

export const shopifyGraphQL = async (query: string, variables?: Record<string, unknown>) => {
  const token = await getAccessToken();
  const response = await axios.post(
    `${shopifyApiBase}/graphql.json`,
    { query, variables },
    {
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
      },
    }
  );
  return response.data;
};

export async function shopifyRestGet(path: string) {
  const token = await getAccessToken();
  return axios.get(`${shopifyApiBase}${path}`, {
    headers: { 'X-Shopify-Access-Token': token },
  });
}

// Storefront API — uses the public Headless channel token (read-only, customer-facing).
// Endpoint and auth header are different from the Admin API.
export const shopifyStorefrontGraphQL = async (query: string, variables?: Record<string, unknown>) => {
  const response = await axios.post(
    `${shopifyStorefrontBase}/graphql.json`,
    { query, variables },
    {
      headers: {
        'X-Shopify-Storefront-Access-Token': env.SHOPIFY_STOREFRONT_ACCESS_TOKEN,
        'Content-Type': 'application/json',
      },
    }
  );
  return response.data;
};
