/**
 * A fixed-rate swap with reversed estimation: the recipient gets exactly
 * 1 ETH, and the API works out how much BTC to send. Good for payments, where
 * the amount received is what matters.
 *
 *   RECIPIENT_ADDRESS=<your ETH address> REFUND_ADDRESS=<your BTC address> \
 *     npx tsx --env-file=.env examples/fixed-rate-swap.ts
 */
import { StealthEX } from "../src/index.js";

const recipient = process.env.RECIPIENT_ADDRESS;
const refund = process.env.REFUND_ADDRESS;
if (!recipient || !refund) throw new Error("Set RECIPIENT_ADDRESS (ETH) and REFUND_ADDRESS (BTC).");

const route = {
  from: { symbol: "btc", network: "mainnet" },
  to: { symbol: "eth", network: "mainnet" },
};
const receive = 1;

const client = new StealthEX();

// Validate the address before asking for a rate. address_regex is a string.
const eth = await client.currencies.get("eth", "mainnet");
if (eth.address_regex && !new RegExp(eth.address_regex).test(recipient)) {
  throw new Error(`${recipient} is not a valid ${eth.name} address.`);
}

// A fixed-rate estimate locks a rate and returns its id.
const estimate = await client.rates.estimate({ route, amount: receive, rate: "fixed", estimation: "reversed" });
if (!estimate.rate) throw new Error("No fixed rate returned for this route.");
console.log(`Send ${estimate.estimated_amount} BTC to receive ${receive} ETH. Rate valid until ${estimate.rate.valid_until}.`);

// Use the rate id before valid_until.
const exchange = await client.exchanges.create({
  route,
  amount: receive,
  rate: "fixed",
  estimation: "reversed",
  rate_id: estimate.rate.id,
  address: recipient,
  refund_address: refund,
});

console.log(`\nExchange ${exchange.id}: send ${exchange.deposit.expected_amount} BTC to ${exchange.deposit.address}`);
console.log(`The fixed rate expires at ${exchange.expires_at}: deposit before then.`);
