import { sumLines } from '@/lib/money';
import type { Address, CartLine, Order, Product, Shipment } from '@/lib/types';

export type AppState = {
  hydrated: boolean;
  cart: CartLine[];
  orders: Order[];
  shipments: Shipment[];
  address?: Address;
  importedEmailIds: string[];
};

export const initialState: AppState = {
  hydrated: false,
  cart: [],
  orders: [],
  shipments: [],
  importedEmailIds: [],
};

export type Action =
  | { type: 'hydrate'; state: Partial<AppState> }
  | { type: 'addToCart'; product: Product }
  | { type: 'setQuantity'; productId: string; quantity: number }
  | { type: 'saveAddress'; address: Address }
  | {
      type: 'orderPlaced';
      order: Omit<Order, 'total' | 'shipmentId'>;
      shipment?: Shipment;
    }
  | { type: 'shipmentsImported'; shipments: Shipment[]; emailId?: string }
  | { type: 'removeShipment'; id: string };

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'hydrate':
      return { ...state, ...action.state, hydrated: true };

    case 'addToCart': {
      const p = action.product;
      const existing = state.cart.find((l) => l.productId === p.id);
      const cart = existing
        ? state.cart.map((l) => (l.productId === p.id ? { ...l, quantity: l.quantity + 1 } : l))
        : [
            ...state.cart,
            {
              productId: p.id,
              storeId: p.storeId,
              variantId: p.variantId,
              title: p.title,
              price: p.price,
              image: p.image,
              quantity: 1,
            },
          ];
      return { ...state, cart };
    }

    case 'setQuantity':
      return {
        ...state,
        cart: state.cart
          .map((l) => (l.productId === action.productId ? { ...l, quantity: action.quantity } : l))
          .filter((l) => l.quantity > 0),
      };

    case 'saveAddress':
      return { ...state, address: action.address };

    case 'orderPlaced': {
      const { order, shipment } = action;
      const ordered = new Set(order.lines.map((l) => l.productId));
      return {
        ...state,
        cart: state.cart.filter((l) => !ordered.has(l.productId)),
        orders: [{ ...order, total: sumLines(order.lines), shipmentId: shipment?.id }, ...state.orders],
        shipments: shipment ? [shipment, ...state.shipments] : state.shipments,
      };
    }

    case 'shipmentsImported': {
      const known = new Set(state.shipments.map((s) => s.trackingNumber));
      const fresh = action.shipments.filter((s) => !known.has(s.trackingNumber));
      return {
        ...state,
        shipments: [...fresh, ...state.shipments],
        importedEmailIds: action.emailId ? [...state.importedEmailIds, action.emailId] : state.importedEmailIds,
      };
    }

    case 'removeShipment':
      return { ...state, shipments: state.shipments.filter((s) => s.id !== action.id) };
  }
}
