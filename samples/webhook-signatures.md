# Verifying Wayline Webhook Signatures

Anyone who knows your endpoint URL can send it an HTTP request. Signatures let your server prove that a delivery really came from Wayline and was not modified on the way.

## How signing works

Every delivery carries a `Wayline-Signature` header that looks like this:

```
Wayline-Signature: t=1767225600,v1=5f2b0c7e9a...
```

`t` is the Unix timestamp at which Wayline signed the delivery. `v1` is an HMAC-SHA256 of the string `{t}.{raw request body}`, keyed with the signing secret of your endpoint. Signing secrets start with `whsec_` and are shown once, when you create the endpoint.

## Verifying a delivery

1. Read the raw request body as bytes, before any JSON parsing.
2. Split the header into its `t` and `v1` parts.
3. Compute the HMAC-SHA256 of `{t}.{body}` with your signing secret.
4. Compare your result with each `v1` value using a constant-time comparison.
5. Reject the delivery if the timestamp is more than 300 seconds away from your server's clock.

The timestamp check protects you against replay attacks: someone who captured a valid delivery cannot resend it an hour later.

```js
import { createHmac, timingSafeEqual } from "node:crypto";

export function isValidSignature(rawBody, header, secret, toleranceSeconds = 300) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  const age = Math.abs(Date.now() / 1000 - Number(parts.t));
  if (!Number.isFinite(age) || age > toleranceSeconds) return false;
  const expected = createHmac("sha256", secret).update(`${parts.t}.${rawBody}`).digest();
  const given = Buffer.from(parts.v1 ?? "", "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
```

## Rotating a signing secret

Roll a secret from the endpoint settings page if it may have leaked, or as routine hygiene. After you roll it, Wayline signs every delivery with both the old and the new secret for 24 hours, so the header contains two `v1` entries. Deploy the new secret to your servers within that window; after 24 hours only the new secret is used.

## Common mistakes

- Parsing the JSON and re-serialising it before verifying. Re-serialisation changes whitespace and key order, so the bytes no longer match what was signed.
- Comparing signatures with `===`, which leaks timing information.
- Servers with a drifting clock. If your server clock is off by more than five minutes, valid deliveries will be rejected. Run NTP.
