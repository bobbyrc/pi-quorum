# pi-quorum architecture decision record

## Council evidence

A bounded two-pass council was convened with fresh, read-only `council-sol` and `council-fable` advisors.

- **Pass 1:** `47c9e4c7-38c8-426a-89e8-2a153a8b9e9b` and `6977b2eb-7213-4d93-bb3c-8da6d72575a3`
- **Pass 2:** `b4670cc3-7696-440b-9b8c-865f51e4f74c` and `e308bfb5-90ce-44f2-a376-fd5bbb901852`
- **Outcome:** qualified consensus, with no material dissent after cross-examination.

Both advisors supported a native extension that creates isolated child Pi sessions rather than relying on pi-subagents. They agreed that child capability limits—not prompt wording—must enforce read-only participation; that material disagreement must remain unresolved rather than be misrepresented as a majority consensus; and that a tool alone does not retain the prior mandate to deliberate.

They also agreed that `agent_settled` is the appropriate post-work boundary and that automatic review follow-up requires persisted provenance, diff-fingerprint deduplication, single-flight state, queued delivery, and recursion exclusion.

## Main-session decision

`pi-quorum` is a distributable pi package exposing `quorum()` and `/quorum configure`.

1. **Member isolation:** each member receives an in-memory `createAgentSession` with only `read`, `grep`, `find`, and `ls`; no extensions, skills, prompt templates, themes, or inherited context files.
2. **Decision protocol:** a batch is capped at eight decisions. Members make independent first-pass reports; a bounded second/third round supplies peer reports only while recommendations or explicit dissent materially differ. Consensus requires a substantive recommendation from every member; explicit reservations produce qualified consensus rather than being erased.
3. **Context:** configuration exposes `fresh` and bounded `session-summary` modes. Only the latter shares a truncated, recent session snapshot.
4. **User resolution:** unresolved outcomes return fleshed-out options. In interactive Pi sessions the user selects an option; headless sessions receive the options without a default choice.
5. **Review:** optional review uses the same read-only boundary at `agent_settled`. It collects staged, unstaged, and untracked changes, reviews every bounded diff part, and sends the full member reports in a provenance-labelled queued instruction. Progress remains visible; cancellation propagates to member sessions, a timeout bounds unattended work, and failed fingerprints cool down before retry. A completed-change-set fingerprint, in-flight flag, and automatic-follow-up suppression prevent review loops.
6. **Policy:** the extension retains a short `before_agent_start` policy that requires quorum for material decisions, while detailed mechanics live in the tool guidance.

## Migration note

The user explicitly authorized removal of the legacy `design-council` extension, council agent profiles, and pi-subagents/watchdog settings. This session's auto-mode guard rejected changes under `~/.pi/agent`, so those global deletions remain a manual follow-up rather than being bypassed. Historical sessions and mission artifacts must be preserved.
