import axios from 'axios';
import { env } from './env';

const shopifyApiBase = `https://${env.SHOPIFY_STORE_DOMAIN}/admin/api/${env.SHOPIFY_API_VERSION}`;
const shopifyStorefrontBase = `https://${env.SHOPIFY_STORE_DOMAIN}/api/${env.SHOPIFY_API_VERSION}`;

let cachedToken: string | null = null;
let tokenExpiresAt = 0; // epoch ms the cached token stops being valid; 0 = none

// Exchange client_id + client_secret for an access token (Client Credentials Grant).
// These tokens expire (~24h) AND are revoked when the app is reinstalled, so we
// track expiry and refresh instead of caching for the process lifetime.
async function getAccessToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

  const res = await axios.post(
    `https://${env.SHOPIFY_STORE_DOMAIN}/admin/oauth/access_token`,
    {
      client_id: env.SHOPIFY_CLIENT_ID,
      client_secret: env.SHOPIFY_CLIENT_SECRET,
      grant_type: 'client_credentials',
    },
    { headers: { 'Content-Type': 'application/json' }, timeout: 30000 }
  );

  cachedToken = res.data.access_token as string;
  const expiresInSec = Number(res.data.expires_in) || 3600;
  // Refresh 5 min early so we never race the expiry boundary.
  tokenExpiresAt = Date.now() + (expiresInSec - 300) * 1000;
  return cachedToken;
}

// Run an Admin API request; if the token is rejected (401 — expired or revoked
// after a reinstall), force a fresh token once and retry so the process
// self-heals without a manual restart.
async function withAdminAuth<T>(fn: (token: string) => Promise<T>): Promise<T> {
  try {
    return await fn(await getAccessToken());
  } catch (err) {
    if (!(axios.isAxiosError(err) && err.response?.status === 401)) throw err;
    return fn(await getAccessToken(true));
  }
}

export const shopifyGraphQL = async (query: string, variables?: Record<string, unknown>) => {
  const response = await withAdminAuth((token) =>
    axios.post(
      `${shopifyApiBase}/graphql.json`,
      { query, variables },
      {
        headers: {
          'X-Shopify-Access-Token': token,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    )
  );
  return response.data;
};

export async function shopifyRestGet(path: string) {
  return withAdminAuth((token) =>
    axios.get(`${shopifyApiBase}${path}`, {
      headers: { 'X-Shopify-Access-Token': token },
      timeout: 30000,
    })
  );
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
      timeout: 30000,
    }
  );
  return response.data;
};
