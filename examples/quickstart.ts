/**
 * Read-only tour: networks, one currency, a range and an estimate. Nothing is created.
 *
 *   npx tsx --env-file=.env examples/quickstart.ts
 */
import { StealthEX, StealthEXAPIError } from "../src/index.js";

const client = new StealthEX(); // reads STEALTHEX_API_KEY

const networks = await client.currencies.networks();
console.log(`${networks.length} networks, for example: ${networks.slice(0, 8).join(", ")}`);

const btc = await client.currencies.get("btc", "mainnet");
console.log(`${btc.name}: rates ${btc.rates.join("/")}, precision ${btc.precision ?? "unspecified"}`);

const route = {
  from: { symbol: "btc", network: "mainnet" },
  to: { symbol: "eth", network: "mainnet" },
};

try {
  const range = await client.rates.range({ route, rate: "floating" });
  console.log(`BTC -> ETH accepts ${range.min_amount} to ${range.max_amount ?? "no limit"} BTC`);

  const amount = Math.max(range.min_amount, 0.05);
  const { estimated_amount } = await client.rates.estimate({ route, amount, rate: "floating" });
  console.log(`${amount} BTC -> about ${estimated_amount} ETH (floating)`);
} catch (error) {
  if (error instanceof StealthEXAPIError) {
    console.error(`StealthEX said ${error.kind}: ${error.details} (request id ${error.requestId})`);
  } else {
    throw error;
  }
}
