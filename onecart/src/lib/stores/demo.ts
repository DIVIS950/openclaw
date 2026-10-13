import { fakeUpsNumber } from '../tracking/carrier';
import type { Product, Store } from '../types';
import type { StoreConnector } from './connector';

const STORES: Store[] = [
  { id: 'northwind', name: 'Northwind Outfitters', domain: 'northwind.demo', platform: 'demo', accent: '#2F6F4E' },
  { id: 'kettle', name: 'Kettle & Crumb', domain: 'kettle.demo', platform: 'demo', accent: '#B5532E' },
  { id: 'pixel', name: 'Pixel Garage', domain: 'pixel.demo', platform: 'demo', accent: '#3B5BDB' },
  { id: 'bloom', name: 'Bloom Beauty', domain: 'bloom.demo', platform: 'demo', accent: '#C2255C' },
];

const CATALOG: Record<string, [string, string, number][]> = {
  northwind: [
    ['Trail Runner Shoes', 'Lightweight shoes with a grippy sole.', 8900],
    ['Merino Wool Beanie', 'Warm, soft and itch-free.', 2800],
    ['Packable Rain Jacket', 'Folds into its own pocket.', 11900],
    ['Insulated Water Bottle', 'Keeps drinks cold for 24 hours.', 3400],
  ],
  kettle: [
    ['Single Origin Coffee Beans', '340 g, medium roast from Colombia.', 1650],
    ['Pour-Over Kettle', 'Gooseneck spout for a steady pour.', 4500],
    ['Sourdough Starter Kit', 'Everything you need for your first loaf.', 2400],
    ['Stoneware Mug Set', 'Four hand-glazed mugs.', 3800],
  ],
  pixel: [
    ['Wireless Earbuds', 'Noise cancelling, 30 h battery.', 7900],
    ['USB-C Fast Charger', '65 W, charges a laptop and phone.', 3900],
    ['Mechanical Keyboard', 'Hot-swappable switches, RGB.', 9900],
    ['Phone Stand', 'Aluminium, adjustable angle.', 1900],
  ],
  bloom: [
    ['Daily Moisturizer', 'Light, fragrance-free, SPF 30.', 2600],
    ['Vitamin C Serum', 'Brightens in 4 weeks.', 3200],
    ['Lip Balm Trio', 'Mint, vanilla and berry.', 1200],
    ['Bamboo Hair Brush', 'Gentle on wet and dry hair.', 1800],
  ],
};

function demoConnector(store: Store): StoreConnector {
  const products: Product[] = CATALOG[store.id].map(([title, description, cents], i) => ({
    id: `${store.id}-${i}`,
    storeId: store.id,
    title,
    description,
    price: { cents, currency: 'USD' },
  }));
  return {
    store,
    async search(query) {
      const q = query.trim().toLowerCase();
      return q ? products.filter((p) => `${p.title} ${p.description}`.toLowerCase().includes(q)) : products;
    },
    async checkout() {
      const orderNumber = `${store.id.slice(0, 2).toUpperCase()}-${Math.floor(10000 + Math.random() * 90000)}`;
      return { kind: 'placed', orderNumber, trackingNumber: fakeUpsNumber(orderNumber) };
    },
  };
}

export const demoConnectors: StoreConnector[] = STORES.map(demoConnector);
