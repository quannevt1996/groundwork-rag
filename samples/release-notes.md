# Wayline Release Notes

## 3.6.0 (2026-06-02)

### New

- Ordered delivery per key. Set `ordering: "per_key"` on an endpoint and Wayline delivers events that share an `ordering_key` one at a time, in the order they were published. Events with different keys are still delivered in parallel.
- `POST /v2/deliveries/{id}/retry` re-sends a single delivery immediately, for example after you fixed a bug in your receiver.
- Delivery search in the dashboard, by event type, status code and time range.

### Deprecated

- The `/v1/hooks` endpoints are deprecated and will be removed in Wayline 4.0. Use `/v2/endpoints` instead.

## 3.5.1 (2026-03-14)

### Fixed

- Fixed a database connection leak in the retry scheduler that caused the outage described in PM-2026-014.
- The default for `db.pool.acquire_timeout_ms` is now 2000 milliseconds, down from 30000, so a worker that cannot get a connection fails fast instead of hanging.

## 3.5.0 (2026-03-10)

### Changed

- Retries now use exponential backoff with full jitter. A failing delivery is retried up to 15 times over roughly 72 hours, starting 30 seconds after the first failure. Before 3.5.0, deliveries were retried 8 times on a fixed schedule over 24 hours.
- The maximum event payload size is now 256 KB, up from 128 KB.

## 3.4.0 (2026-01-20)

### New

- Signing secret rotation with a 24-hour overlap, during which deliveries are signed with both secrets.
- Test-mode API keys with the `wl_test_` prefix. Events sent with a test key are never delivered to production endpoints.
- A new European region, `prod-eu1`, for customers who need their data to stay in the EU.
