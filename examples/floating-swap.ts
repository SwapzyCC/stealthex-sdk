/**
 * A floating-rate swap, end to end: check the amount, create the exchange,
 * show the deposit instructions, then follow it until it is done.
 *
 * Creating an exchange moves no funds; nothing happens until someone deposits.
 *
 *   RECIPIENT_ADDRESS=<your ETH address> REFUND_ADDRESS=<your BTC address> \
 *     npx tsx --env-file=.env examples/floating-swap.ts 0.01
 */
import { StealthEX } from "../src/index.js";

const recipient = process.env.RECIPIENT_ADDRESS;
const refund = process.env.REFUND_ADDRESS;
if (!recipient || !refund) throw new Error("Set RECIPIENT_ADDRESS (ETH) and REFUND_ADDRESS (BTC).");

const amount = Number(process.argv[2] ?? "0.01");
const route = {
  from: { symbol: "btc", network: "mainnet" },
  to: { symbol: "eth", network: "mainnet" },
};

const client = new StealthEX();

// 1. Is the amount inside the route's limits?
const { min_amount, max_amount } = await client.rates.range({ route, rate: "floating" });
if (amount < min_amount || (max_amount !== null && amount > max_amount)) {
  throw new Error(`Amount must be between ${min_amount} and ${max_amount ?? "unlimited"} BTC.`);
}

// 2. Show the user what they should get. A floating rate can still move.
const { estimated_amount } = await client.rates.estimate({ route, amount, rate: "floating" });
console.log(`Estimate: ${amount} BTC -> ~${estimated_amount} ETH`);

// 3. Create the exchange. This call is never retried after a 5xx, so it
//    cannot create two exchanges by accident.
const exchange = await client.exchanges.create({
  route,
  amount,
  rate: "floating",
  address: recipient,
  refund_address: refund,
});

console.log(`\nExchange ${exchange.id}`);
console.log(`Send ${exchange.deposit.expected_amount} ${exchange.deposit.symbol.toUpperCase()} to ${exchange.deposit.address}`);
if (exchange.deposit.extra_id) console.log(`with memo / tag ${exchange.deposit.extra_id}`);

// 4. Follow it. Ctrl+C stops watching; the exchange carries on regardless.
const done = await client.exchanges.waitFor(exchange.id, {
  intervalMs: 30_000,
  onUpdate: (ex) => console.log(`${new Date().toISOString()}  ${ex.status}`),
});

if (done.status === "finished") {
  console.log(`Sent ${done.withdrawal.amount} ETH: ${done.withdrawal.tx_explorer_url ?? done.withdrawal.tx_hash}`);
} else {
  console.log(`Ended as ${done.status}.`);
}
