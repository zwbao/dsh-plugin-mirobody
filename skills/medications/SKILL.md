---
name: mirobody-medications
description: Read a medication plan, dose log, or course history from Mirobody. The tool cannot change a dose.
---

# Medications

`query_medications` is read-only. It cannot start, stop, or change a medicine. If the user asks to change a dose, refuse and tell them to talk to the prescriber.

## Views

- `plan` (default): what the person intends to take, plus today's slot states. This is not proof a dose was swallowed.
- `log`: doses recorded as taken or skipped. Use this for "did I take it". The default window is the last 30 days when no dates are given. A missing row is not evidence the dose was skipped.
- `history`: courses with start, end, and why they closed. Use this for "when did I switch", then pass that date to `query_health_indicators` if the question is about a lab afterwards.

`keywords` narrow by drug name or code. Dates are `YYYY-MM-DD`. `member` is a care-circle id.

Do not answer interaction questions, dosing questions, or "should I stop this" from this tool. Absence means not recorded here.
