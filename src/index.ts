export { StealthEX, type StealthEXOptions } from "./client.js";
export type { RequestOptions } from "./core.js";
export {
  StealthEXError,
  StealthEXAPIError,
  StealthEXAuthenticationError,
  StealthEXRateLimitError,
  StealthEXTimeoutError,
  StealthEXConnectionError,
  StealthEXSignatureError,
  type StealthEXErrorKind,
} from "./errors.js";
export {
  SIGNATURE_HEADER,
  DEFAULT_SIGNATURE_TOLERANCE_SECONDS,
  parseSignatureHeader,
  computeSignature,
  checkSignature,
  verifySignature,
  type ParsedSignatureHeader,
  type SignatureCheck,
  type VerifySignatureInput,
} from "./signature.js";
export { Rates } from "./resources/rates.js";
export { Currencies, type ListAllCurrenciesParams } from "./resources/currencies.js";
export {
  Exchanges,
  TERMINAL_STATUSES,
  isTerminalStatus,
  type ListAllExchangesParams,
  type WaitForOptions,
} from "./resources/exchanges.js";
export { MAX_PAGE_SIZE } from "./resources/pagination.js";
export { VERSION } from "./version.js";
export type * from "./types.js";
