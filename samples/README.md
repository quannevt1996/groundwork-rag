# Sample corpus

Thirteen short documents from the internal wiki of **Fernbrook Labs**, a fictional company that runs **Wayline**, a fictional webhook delivery service. Every document was written for this repository; the company, product, people, IP ranges (RFC 5737 documentation ranges) and numbers are made up. The corpus is covered by the repository's MIT license.

`npm run seed` ingests these files into a collection called "Wayline samples", and `npm run eval` indexes them into a throwaway database to measure retrieval. Both skip this README.

| File | Format | What it covers |
| --- | --- | --- |
| `engineering-handbook.md` | Markdown | Environments, deploy windows, code review, working abroad, learning budget |
| `oncall-runbook.md` | Markdown | Rotation, severity levels, escalation, alert codes, recovery time after night pages |
| `webhook-signatures.md` | Markdown | `Wayline-Signature` HMAC verification, replay tolerance, secret rotation |
| `release-notes.md` | Markdown | Versions 3.4.0 to 3.6.0 |
| `architecture-overview.md` | Markdown | Gateway, event log, fan-out, workers, storage, regions |
| `onboarding-guide.md` | Markdown | First weeks, buddy, first deploy, joining on-call |
| `expense-policy.md` | Markdown | Approval limits, travel classes, per diem, home office |
| `api-reference.html` | HTML | Auth, rate limits, idempotency, pagination, error codes |
| `customer-faq.html` | HTML | Disabled endpoints, IP ranges, duplicates, timeouts, SLA |
| `security-policy.txt` | Plain text | Policy sections `SEC-01` to `SEC-09` |
| `glossary.txt` | Plain text | Acronyms: DLQ, RPO, RTO, SLO, MTTA... |
| `postmortem-pm-2026-014.pdf` | PDF, 2 pages | A connection-pool outage and its action items |
| `data-retention-policy.pdf` | PDF, 2 pages | Policy `DRP-3`: retention periods, erasure, RPO/RTO |

## Why it looks like this

The corpus is small, but it was written to make the three retrieval modes behave differently:

- **Shared vocabulary.** "Retention", "rotation", "limit", "timeout" and "escalation" each appear in several documents with different meanings (key rotation vs. on-call rotation, rate limits vs. expense limits), so plain keyword overlap is often ambiguous.
- **Exact identifiers.** Error codes (`WL-4291`), config keys (`db.pool.acquire_timeout_ms`), policy sections (`SEC-06`), action items (`ACT-113`) and version numbers are the kind of query where keyword search should beat embeddings.
- **Paraphrase gaps.** Some facts are worded differently from how people ask about them. The retention policy talks about "restore points" and "snapshots", never "backups"; the runbook says "paged between 22:00 and 07:00", not "woken up at night". Those are the cases where vector search should win.

The PDFs were produced from plain text with a small PDF writer (`server/test/helpers/pdf.ts`), so their text extracts cleanly. Scanned PDFs are not supported.
