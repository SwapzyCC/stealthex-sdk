# Security policy

## Reporting a vulnerability in this SDK

Please **do not open a public issue**. Report it privately through GitHub: go to the repository's **Security** tab and choose **Report a vulnerability**.

Include what you found, how to reproduce it, and the impact you expect. We aim to acknowledge reports within a few working days.

This policy covers the SDK's code only. Report problems with the StealthEX service or API itself to StealthEX: https://stealthex.io/contacts

## Supported versions

Only the latest release receives fixes.

## Using the SDK safely

- **Keep your API key on the server.**
  - Load it from the environment or a secret manager.
  - Never commit it.
  - Never send it to a browser or a mobile app.
  - The SDK sends it only in the `Authorization` header.
- If a key leaks, rotate it in your StealthEX partner account straight away.
- Validate user-supplied addresses with the currency's `address_regex`, and require an `extra_id` when the currency has one.
- Set `refund_address` on every exchange.
- If StealthEX issued you a response signing secret, pass it as `signingSecret`, and consider `requireSignature: true`.
