# Wayline On-Call Runbook

This runbook is for engineers on the Wayline on-call rotation. Keep it open during your shift.

## Rotation

Each week has a primary and a secondary on-call engineer. The rotation hands over every Tuesday at 11:00 UTC, in a short call where the outgoing primary walks through open incidents, noisy alerts and anything that was silenced.

Primary on-call engineers receive an on-call stipend of 300 EUR for each week they hold the pager, whether or not they are paged.

## Severity levels

- **SEV1**: Wayline is down or losing data for many customers. Page immediately. An incident commander must be assigned within 15 minutes and the public status page updated within 30 minutes.
- **SEV2**: Major degradation, for example p95 delivery latency above five minutes in one region. Page immediately and update the status page within one hour.
- **SEV3**: A problem affecting a single customer or a non-critical feature. Handle during working hours.
- **SEV4**: Cosmetic issues and minor bugs. File a ticket.

When in doubt, choose the higher severity. Downgrading an incident later is cheap; noticing too late that it was serious is not.

## Paging and escalation

Acknowledge a page within 5 minutes. If the primary has not acknowledged after 10 minutes, the page goes to the secondary. If nobody has acknowledged after 20 minutes, it goes to the engineering manager on duty.

Escalate early if you are stuck. Pulling in the owning team for a SEV1 or SEV2 is always acceptable, at any hour.

## Common alerts

### WL-ALERT-QLAG: delivery queue lag

Fires when delivery queue lag stays above 120 seconds for five minutes. Check which partitions are behind on the delivery dashboard. If lag is spread evenly, add delivery workers with `wayctl scale delivery --replicas <n>`. If a single partition is behind, look for one very slow customer endpoint holding worker slots.

### WL-ALERT-DLQ: dead-letter growth

Fires when more than 1,000 deliveries per hour land in the dead-letter queue. This is usually one customer endpoint that has started returning errors for every request. Confirm with `wayctl deliveries top-failing --since 1h` and, if it is a single endpoint, contact the customer through support instead of acting on their endpoint yourself.

### WL-ALERT-PGCONN: database connections near the limit

Fires when Postgres connections exceed 90% of `db.pool.max_connections`. This alert was added after postmortem PM-2026-014. Look for long-running transactions first with `wayctl db long-tx`; restarting workers only hides the cause.

## After a night page

Being woken up costs you sleep, so take the time back. If you are paged between 22:00 and 07:00 local time, start the next working day late and take the morning off. This recovery time is not deducted from your annual leave and you do not need to ask anyone first; just let your team know in chat.

If you are paged more than twice in one night, hand the pager to the secondary for the rest of the night.
