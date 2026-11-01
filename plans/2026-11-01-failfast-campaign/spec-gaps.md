# Experimental spec gaps — not approvals

- **FF-1:** architecture/runner A-15 currently describes default concurrency 2. The user's 2026-11-01 instruction to save money by stopping other runs on error justifies experimental default 1; an explicit `--concurrency N` still opts into parallel execution.
- **FF-2:** architecture/runner §7 describes two automatic retries with 10/60-second delays, then stopping. Experimental behavior now stops on the first terminal failure and does not retry. User chooses whether to initiate another campaign after diagnosis; no implicit recovery spend.
- **FF-3:** architecture/runner §7 describes waiting for in-flight jobs. This implementation additionally requests cancellation before draining them. It preserves their costs/results, including unknown charges, without asserting cancellation guarantees provider settlement.
- **FF-4:** Ordinary task-tool errors are recoverable according to framework-runner; fail-fast does not reinterpret every failed shell check as an infrastructure outage. Terminal job non-pass, model/infra failure, nested-model error with uncertain charges, scheduler failure, or unknown accounting stops the campaign.

Original specifications stay in review with legacy provenance unchanged. The explicit latest user instruction and experimental-development authorization govern this unmerged branch; no approval statuses were invented.
