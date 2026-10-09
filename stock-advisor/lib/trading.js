// Optional Polymarket trading. Off unless POLYMARKET_TRADING_ENABLED=true and a private key is set.
// Orders are signed locally with YOUR wallet; the key never leaves this server.
import { ClobClient, Side, OrderType } from "@polymarket/clob-client";
import { Wallet } from "@ethersproject/wallet";

const CLOB_HOST = "https://clob.polymarket.com";
const POLYGON = 137;

export function tradingConfig(env = process.env) {
  return {
    enabled: env.POLYMARKET_TRADING_ENABLED === "true" && Boolean(env.POLYMARKET_PRIVATE_KEY),
    maxUsd: Number(env.POLYMARKET_MAX_TRADE_USD || 25),
  };
}

export class TradeError extends Error {}

// Validates an order request before anything is signed. Cost = price * shares (USDC).
export function validateOrder(body, { maxUsd }) {
  const { tokenId, side, price, size, confirm } = body ?? {};
  if (confirm !== true) throw new TradeError("Order not confirmed.");
  if (typeof tokenId !== "string" || !/^\d+$/.test(tokenId)) throw new TradeError("Invalid market token.");
  if (side !== "BUY" && side !== "SELL") throw new TradeError("Side must be BUY or SELL.");
  const p = Number(price);
  const s = Number(size);
  if (!(p > 0 && p < 1)) throw new TradeError("Price must be between 0 and 1.");
  if (!(s > 0)) throw new TradeError("Size must be greater than 0.");
  const cost = p * s;
  if (cost > maxUsd) throw new TradeError(`Order costs $${cost.toFixed(2)}, above your limit of $${maxUsd}.`);
  return { tokenID: tokenId, side: side === "BUY" ? Side.BUY : Side.SELL, price: p, size: s, cost };
}

let clientPromise;
function getClient(env = process.env) {
  clientPromise ??= (async () => {
    const signer = new Wallet(env.POLYMARKET_PRIVATE_KEY);
    // 0 = plain wallet (EOA). Use 1 (email/Magic login) or 2 (browser wallet proxy) with POLYMARKET_FUNDER_ADDRESS.
    const signatureType = Number(env.POLYMARKET_SIGNATURE_TYPE || 0);
    const funder = env.POLYMARKET_FUNDER_ADDRESS || undefined;
    const creds = await new ClobClient(CLOB_HOST, POLYGON, signer).createOrDeriveApiKey();
    return new ClobClient(CLOB_HOST, POLYGON, signer, creds, signatureType, funder);
  })().catch((err) => {
    clientPromise = undefined;
    throw err;
  });
  return clientPromise;
}

export async function placeOrder(body, env = process.env) {
  const config = tradingConfig(env);
  if (!config.enabled) throw new TradeError("Trading is turned off. See README to enable it.");
  const { cost, ...order } = validateOrder(body, config);
  const clob = await getClient(env);
  const result = await clob.createAndPostOrder(order, undefined, OrderType.GTC);
  if (result?.success === false || result?.error) {
    throw new TradeError(`Polymarket rejected the order: ${result.errorMsg || result.error}`);
  }
  return { orderId: result?.orderID ?? null, status: result?.status ?? "submitted", cost };
}
