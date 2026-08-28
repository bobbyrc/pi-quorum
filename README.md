# pi-quorum

A native [pi.dev](https://pi.dev) extension for bounded multi-model deliberation and read-only final code review.

## Install

```bash
pi install /path/to/pi-quorum
```

Then configure it in Pi:

```text
/quorum configure
```

The wizard discovers authenticated (or session-scoped) models, selects 2–4 members, chooses fresh versus bounded-session context, sets the decision round cap (1–3), and optionally enables automatic final review.

## `quorum()`

Call `quorum` with one decision or a batch of related decisions:

```json
{
  "decisions": [
    { "id": "storage", "question": "Should we use SQLite or Postgres for the local cache?" },
    { "id": "retention", "question": "How long should cache entries be retained?" }
  ]
}
```

Each configured member runs in a new, in-memory Pi session with only `read`, `grep`, `find`, and `ls`. Members never receive write, edit, shell, extensions, skills, or inherited context-file capabilities. Their outputs are independent in round one; when they materially disagree, later rounds receive curated peer reports. The extension never treats a majority as consensus.

Results are `consensus`, `qualified-consensus-with-dissent`, or `unresolved`. An unresolved interactive result displays fleshed-out selectable directions (rationale, trade-offs, risks, and prerequisites); headless modes receive the same structured options without choosing a default.

## Automatic final review

When enabled, pi-quorum watches `agent_settled`, reviews a new Git diff with the same read-only member boundary, and queues a provenance-labelled message instructing the main agent to address actionable findings. It is guarded against recursion: one review per diff fingerprint, no review while a review is running, and no review triggered by its own automatic follow-up. Quorum members only report findings; the main agent remains the sole writer.

## Configuration

Configuration is saved at `$XDG_CONFIG_HOME/pi-quorum/config.json` (or `~/.config/pi-quorum/config.json`) with owner-only permissions. Saved model identifiers are checked when quorum is called; unavailable members fail clearly so the user can reconfigure.

## Deliberation policy

The extension adds a short policy reminder to use quorum for material architecture, API, security, reliability, cost, data, dependency, and irreversible decisions. It intentionally does not block ordinary work or make members implementation-capable.
