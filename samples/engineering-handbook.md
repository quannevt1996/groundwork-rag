# Fernbrook Engineering Handbook

This handbook describes how the Wayline engineering team at Fernbrook Labs plans, builds and ships software. It is a living document: if something here no longer matches how we work, open a pull request against it.

## How we ship

### Environments

We run four long-lived environments. Every engineer also gets a personal `dev` namespace that is torn down after 14 days without a deploy.

- `stg-eu1` is staging, hosted in Frankfurt. It mirrors production configuration but only ever holds synthetic data. Never copy production data into staging, not even a single customer record for debugging.
- `prod-us2` serves customers whose account region is United States.
- `prod-eu1` serves customers whose account region is European Union.

Configuration lives next to the code in `deploy/<environment>.yaml`. A change to a production configuration file is reviewed exactly like a code change.

### Deploy windows

Production deploys happen Monday to Thursday between 09:00 and 16:00 in the deployer's local time, so that the person who shipped a change is awake and at their desk while it settles. We do not deploy on Fridays. The only exception is a hotfix for an open SEV1 or SEV2 incident, approved by the incident commander.

During the last two weeks of December we observe a quiet period: only fixes for SEV1 and SEV2 incidents go out, and each one needs a second reviewer from a different team.

### Code review

Every change needs one approving review before it merges. Changes that touch `billing/` or `auth/` need two approvals, and one of them must come from the team that owns that directory. Reviewers aim to respond within one business day.

Keep pull requests small. Changes under 400 lines get reviewed faster and more carefully; if a change is larger, split it into a stack of reviewable steps.

### Feature flags

Risky changes ship dark behind a flag in Flagpole, our internal flag service, and are enabled gradually: internal accounts first, then 5% of customers, then everyone. A flag that has been fully on for 90 days is reported to its owner for cleanup, because stale flags turn into untested code paths.

## Working arrangements

### Core hours

Core collaboration hours are 10:00 to 15:00 in your team's home time zone. Meetings belong inside core hours; outside them, people are free to focus or to keep different schedules.

### Working from another country

Engineers may work from outside their country of employment for up to 30 days in any rolling 12-month period, as long as their manager agrees and they can still cover any on-call shifts. Longer stays need approval from People Ops in advance, because they can create tax and immigration obligations for both you and the company.

## Growth

### Learning budget

Each engineer has an annual learning budget of 1,200 EUR for courses, books and conference tickets. Travel to a conference is paid from the travel budget, not the learning budget. Unused learning budget does not roll over into the next year.

### Career conversations

Managers hold a career conversation with each engineer twice a year, separate from performance reviews. The engineer owns the agenda.
