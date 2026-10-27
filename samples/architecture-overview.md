# Wayline Architecture Overview

Wayline accepts events from customers over an HTTP API and delivers each event to every endpoint subscribed to it. This document follows one event through the system.

## Request path

### Ingestion gateway

The ingestion gateway terminates TLS, authenticates the API key, validates the payload against the size limit and writes the event to the event log. It answers the customer as soon as the event is durably written; delivery happens asynchronously. The gateway also deduplicates requests that carry an `Idempotency-Key` header, remembering each key for 24 hours.

### Event log

The event log is a replicated, partitioned log with 64 partitions per region. Events are partitioned by customer, so one customer's events stay in order relative to each other. Every partition is replicated three times across availability zones before the gateway acknowledges a write.

### Fan-out

The fan-out service reads the log, looks up which endpoints subscribe to each event type and creates one delivery per matching endpoint. A single event published to ten endpoints therefore becomes ten independent deliveries with their own retry state.

### Delivery workers

Delivery workers make the outbound HTTP POST to customer endpoints with a 10-second timeout. Each worker handles roughly 400 concurrent requests, and the worker pool autoscales on queue lag. A delivery counts as successful when the endpoint answers with any 2xx status code.

### Retries and the dead-letter queue

Failed deliveries go to the retry scheduler, which decides when to try again. After the final attempt fails, the delivery is moved to the dead-letter queue, where customers can inspect it and replay it from the dashboard.

## Storage

Metadata such as endpoints, subscriptions and delivery attempts lives in Postgres 16. The delivery attempts table is partitioned by month so that old partitions can be dropped instead of deleted row by row.

Event bodies are not stored in Postgres. They are written to object storage and encrypted with envelope encryption: each tenant has its own data key, and data keys are themselves encrypted by a key held in the cloud provider's key management service.

## Regions

`prod-us2` and `prod-eu1` are fully isolated deployments that share no databases or queues. Data belonging to a customer in the EU region is processed and stored only in the EU region, including backups and logs.
