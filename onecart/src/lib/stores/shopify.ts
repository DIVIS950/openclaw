import type { Product, Store } from '../types';
import type { StoreConnector } from './connector';

/**
 * Real Shopify stores through the Storefront API. Each store owner (or a
 * Shopify partner app) issues a public Storefront access token.
 * Configure with EXPO_PUBLIC_SHOPIFY_STORES="shop-a.myshopify.com|token,shop-b.myshopify.com|token".
 */
const API_VERSION = '2025-07';

type Gql<T> = { data?: T; errors?: { message: string }[] };

async function storefront<T>(domain: string, token: string, query: string, variables: object): Promise<T> {
  const res = await fetch(`https://${domain}/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Storefront-Access-Token': token },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as Gql<T>;
  if (!res.ok || json.errors?.length || !json.data) {
    throw new Error(json.errors?.[0]?.message ?? `Shopify request failed (${res.status})`);
  }
  return json.data;
}

const PRODUCTS = `query Products($query: String) {
  products(first: 24, query: $query) {
    nodes {
      id title description
      featuredImage { url }
      variants(first: 1) { nodes { id price { amount currencyCode } } }
    }
  }
}`;

const CART_CREATE = `mutation CartCreate($input: CartInput!) {
  cartCreate(input: $input) {
    cart { checkoutUrl }
    userErrors { message }
  }
}`;

type ProductsData = {
  products: {
    nodes: {
      id: string;
      title: string;
      description: string;
      featuredImage: { url: string } | null;
      variants: { nodes: { id: string; price: { amount: string; currencyCode: string } }[] };
    }[];
  };
};

type CartData = {
  cartCreate: { cart: { checkoutUrl: string } | null; userErrors: { message: string }[] };
};

export function shopifyConnector(domain: string, token: string): StoreConnector {
  const store: Store = {
    id: `shopify:${domain}`,
    name: domain.replace(/\.myshopify\.com$/, ''),
    domain,
    platform: 'shopify',
    accent: '#5E8E3E',
  };
  return {
    store,
    async search(query) {
      const data = await storefront<ProductsData>(domain, token, PRODUCTS, { query: query || null });
      return data.products.nodes.flatMap((p): Product[] => {
        const variant = p.variants.nodes[0];
        if (!variant) return [];
        return [
          {
            id: p.id,
            storeId: store.id,
            title: p.title,
            description: p.description,
            image: p.featuredImage?.url,
            variantId: variant.id,
            price: { cents: Math.round(Number(variant.price.amount) * 100), currency: variant.price.currencyCode },
          },
        ];
      });
    },
    async checkout(lines, address) {
      const data = await storefront<CartData>(domain, token, CART_CREATE, {
        input: {
          lines: lines.map((l) => ({ merchandiseId: l.variantId, quantity: l.quantity })),
          buyerIdentity: { email: address.email || undefined },
        },
      });
      const { cart, userErrors } = data.cartCreate;
      if (!cart) throw new Error(userErrors[0]?.message ?? 'Could not create cart');
      return { kind: 'hosted', checkoutUrl: cart.checkoutUrl };
    },
  };
}

export function shopifyConnectorsFromEnv(value = process.env.EXPO_PUBLIC_SHOPIFY_STORES): StoreConnector[] {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => entry.trim().split('|'))
    .filter(([domain, token]) => domain && token)
    .map(([domain, token]) => shopifyConnector(domain.trim(), token.trim()));
}
