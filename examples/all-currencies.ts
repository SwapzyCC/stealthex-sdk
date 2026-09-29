/**
 * Every currency, fetched page by page, grouped by network. Read-only.
 *
 *   npx tsx --env-file=.env examples/all-currencies.ts
 */
import { StealthEX } from "../src/index.js";

const client = new StealthEX();

const byNetwork = new Map<string, string[]>();
let customFee = 0;

for await (const currency of client.currencies.listAll()) {
  const list = byNetwork.get(currency.network) ?? [];
  list.push(currency.symbol);
  byNetwork.set(currency.network, list);
  if (currency.features.includes("custom_fee")) customFee++;
}

const total = [...byNetwork.values()].reduce((n, list) => n + list.length, 0);
console.log(`${total} currencies on ${byNetwork.size} networks; ${customFee} accept a custom partner fee.\n`);

for (const [network, symbols] of [...byNetwork].sort((a, b) => b[1].length - a[1].length).slice(0, 10)) {
  console.log(`${network.padEnd(16)} ${symbols.length.toString().padStart(4)}  ${symbols.slice(0, 8).join(" ")}`);
}
