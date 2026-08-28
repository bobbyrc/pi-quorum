# pi-quorum

**Independent model perspectives for decisions that matter—without giving the reviewers permission to change your code.**

`pi-quorum` is a native [Pi](https://pi.dev) extension for bounded, multi-model deliberation. It asks 2–4 models to evaluate a decision independently, lets them challenge material disagreement within a strict round limit, and returns either a shared direction or a clear set of choices for you.

It can also review the complete Git change set through the same read-only boundary. Quorum members advise; your main Pi agent remains the only writer.

## Quick start

You need at least two models available in Pi.

```bash
pi install npm:pi-quorum
```

Open Pi and run the configuration wizard:

```text
/quorum configure
```

Choose 2–4 models, how much conversation context they may receive, a 1–3 round limit, and whether to run automatic final reviews.

Then work normally. Pi is reminded to use quorum for material decisions, or you can ask explicitly:

```text
Use quorum before choosing the storage architecture for this feature.
```

That is all you need to get started.

## When quorum helps

Use it when a decision is expensive to reverse or benefits from genuinely different perspectives:

- Architecture and system boundaries
- Public APIs and compatibility promises
- Security, privacy, and reliability choices
- Data models, migrations, and retention
- Dependencies, infrastructure, and ongoing cost
- Trade-offs where the “best” answer depends on risk tolerance

Skip it for routine edits, formatting, obvious bug fixes, and low-impact naming choices. Quorum is deliberately bounded so that better judgment does not turn into endless debate.

## How it works

1. The main agent sends one decision—or a batch of up to eight related decisions—to `quorum`.
2. Every configured member evaluates it independently in a new, in-memory Pi session.
3. If the recommendations materially differ or include explicit dissent, members receive the peer reports for critique rather than deference, up to the configured round limit.
4. The extension preserves each member report and classifies the result without using a majority-vote shortcut.

For an unresolved decision, Pi presents concrete options with rationale, trade-offs, risks, and prerequisites. In an interactive session, you choose the direction. In a headless session, the same structured options are returned without silently choosing a default.

### What the result means

| Outcome | Meaning |
| --- | --- |
| `consensus` | Every member supports the same direction without a material reservation. |
| `qualified-consensus-with-dissent` | Every member supports the same direction, but at least one retains an explicit reservation. |
| `unresolved` | The members still recommend materially different directions. The decision returns to you with viable options. |

Two models agreeing does not erase a material objection from a third.

## Example decision

You can simply ask Pi to consult the quorum:

```text
We need a durable job queue for a single-node deployment. Use quorum to decide
between SQLite, Postgres, and an embedded queue before implementing anything.
```

The agent-facing tool can also batch related questions so members consider them together:

```json
{
  "decisions": [
    {
      "id": "storage",
      "question": "Should the local cache use SQLite or Postgres?",
      "context": "The service runs on one host today but may become multi-region next year."
    },
    {
      "id": "retention",
      "question": "How long should cache entries be retained?"
    }
  ]
}
```

Decision-specific `context` is optional. Omit it when you want the members to form a fresher view from the question and repository alone.

## The read-only boundary

Each member gets a purpose-built session with a small capability set:

| Capability | Quorum member access |
| --- | --- |
| Inspect files | `read`, `grep`, `find`, and `ls` only |
| Edit files or run shell commands | No |
| Load extensions, skills, prompts, or themes | No |
| Inherit project context files | No |
| Persist its session | No—in-memory only |
| See the main conversation | Only in bounded-summary mode |

The restriction is enforced through the tools and resources given to each child session, not just through prompt wording. It is a capability boundary, not a general-purpose operating-system sandbox; as with any Pi extension, install only code you trust.

## Context modes

The setup wizard offers two modes:

| Mode | What members receive |
| --- | --- |
| **Fresh request only** | The decision, any decision-specific context, and read-only repository tools. Main-session conversation history is excluded. |
| **Bounded session summary** | Everything above, plus a truncated snapshot of recent text from the main session. |

Fresh mode is the strongest defense against anchoring and inherited assumptions. Bounded-summary mode is useful when the trade-off depends on discoveries already made during a long session.

## Automatic final review

Turn on automatic review in `/quorum configure` to have the same members examine new work when the main agent settles.

The review:

- Includes staged, unstaged, and untracked Git changes
- Looks for correctness issues, regressions, security risks, and missing tests
- Splits large change sets into bounded parts and reviews every part
- Shows progress and lets interactive users cancel with `Ctrl-C`
- Stops after ten minutes and waits five minutes before retrying a failed change set
- Sends a clearly labelled result to the main agent and prompts it to address actionable findings
- Deduplicates identical change sets and suppresses review-triggered review loops

Reviewers never apply fixes themselves. The main agent receives every member’s findings and remains responsible for evaluating and editing the code. A change-set fingerprint is marked complete only after every part has been reviewed.

Automatic review requires a Git worktree with at least one staged, unstaged, or untracked change.

## Commands

| Command | Purpose |
| --- | --- |
| `/quorum configure` | Select members, context mode, round limits, and review settings |
| `/quorum` | Show the current configuration |
| `/quorum status` | Show the current configuration explicitly |

Configuration is stored at `$XDG_CONFIG_HOME/pi-quorum/config.json`, or `~/.config/pi-quorum/config.json` when `XDG_CONFIG_HOME` is not set. The directory and file are created with owner-only permissions.

If a saved model is no longer available, run `/quorum configure` again and choose from the models currently authenticated or scoped to the session.

## Cost and latency

Each decision calls every configured member once per round. Deliberation stops early when the reports no longer materially disagree; otherwise it continues up to the configured limit. Batched decisions are processed one at a time.

Automatic review uses its own round limit for each bounded part of the change set. For a good default, start with two complementary models and two decision rounds. Add more members or rounds when the decision justifies the extra time and tokens.

## Design principles

- **Independence first:** members answer separately before seeing peer reports.
- **Disagreement is useful:** reservations and unresolved trade-offs remain visible.
- **Least authority:** advisors can inspect, but cannot implement.
- **Bounded effort:** a small member count and round cap keep deliberation proportional.
- **One writer:** only the main agent acts on the result.

## Development

Build and test a local checkout:

```bash
npm install
npm test
```

Run the coverage thresholds used by CI:

```bash
npm run test:coverage
```

Load the checkout into Pi directly:

```bash
pi install /path/to/pi-quorum
```

## Publishing

Published GitHub Releases are delivered to npm by `.github/workflows/publish.yml` using npm Trusted Publishing. The workflow verifies that the release tag matches `package.json`, requires the tagged commit to be on `main`, runs the coverage gates, verifies the committed build, and publishes without a long-lived npm token. Stable releases use npm’s `latest` tag; GitHub prereleases use `next` and require a prerelease package version such as `0.2.0-beta.1`.

Configure the npm package’s **Settings → Trusted Publisher** once:

| Field | Value |
| --- | --- |
| Provider | GitHub Actions |
| Organization or user | `bobbyrc` |
| Repository | `pi-quorum` |
| Workflow filename | `publish.yml` |
| Environment | Leave blank |
| Allowed action | `npm publish` |

To make a stable release, update and commit both `package.json` and `package-lock.json`, push that commit to `main`, then publish a GitHub Release tagged with the matching `v`-prefixed version—for example, package version `0.2.0` uses tag `v0.2.0`. Creating or pushing a tag without publishing a GitHub Release does not trigger this workflow.

Trusted Publishing automatically adds npm provenance for public packages built from this public repository. The `pi-package` keyword makes each published version automatically discoverable in the [pi.dev extension catalog](https://pi.dev/packages?type=extension).

## License

[MIT](LICENSE)
