---
name: legacy-decomposition-dev
description: Safely continue CageLedger server_app/legacy.py decomposition with compatibility, migration, transaction, cache, audit, and HTTP contract guardrails. Use for tasks from docs/progress/MASTER.md or requests to split, shrink, migrate, or finish legacy.py.
---

# CageLedger Legacy Decomposition

## Continuity

Read `docs/progress/MASTER.md` and the active phase file before acting. Tracking mode is `LOCAL_ONLY`; these files are the source of truth. Update current task at session start and after every completed task.

## S.U.P.E.R Architecture — Mandatory Coding Standard

> Write code like building with LEGO — each brick has a single job, a standard interface, a clear direction, runs anywhere, and can be swapped at will.

All code produced in this project MUST conform to these five principles. Violations are treated as bugs.

### S — Single Purpose
- Each module, file, and function solves exactly one problem
- Prefer decomposition; power comes from composition
- **Litmus test**: Can you describe this module's responsibility in a single sentence? If not, split it.

### U — Unidirectional Flow
- Data flows in one direction: input → processing → output
- Dependencies point inward: outer layers depend on inner, inner layers know nothing about outer
- No circular imports, no reverse dependencies
- **Litmus test**: Can the core logic run unit tests with zero external services?

### P — Ports over Implementation
- Define interface contracts (JSON Schema, types, data structures) BEFORE writing implementation
- All cross-module I/O must be serializable
- Swapping a data source, render layer, or notification channel requires zero changes to core logic
- **Practice**: Every module boundary communicates via explicit, schema-defined contracts

### E — Environment-Agnostic
- Configuration via environment variables or config files, never hardcoded
- All dependencies explicitly declared (requirements.txt / package.json / Cargo.toml)
- Processes are stateless; persistence delegated to external storage
- Logs to stdout. Same codebase runs locally, in Docker, on cloud
- **Config precedence**: Environment variables > .env > config file > in-code defaults

### R — Replaceable Parts
- Any layer can be replaced without affecting others
- Replacement cost is THE core metric of architecture quality
- If replacing one component triggers cascading changes, the architecture is broken
- **Validation**: For each module, ask "Can I swap this with a different implementation by only touching this module's directory?"

## S.U.P.E.R Code Review — Run After Every Task

| # | Check | Principle | Pass? |
|:--|:------|:----------|:------|
| 1 | Every new module/file has exactly one responsibility | S | |
| 2 | No function does more than one conceptual thing | S | |
| 3 | Data flows input → processing → output, no reverse deps | U | |
| 4 | No circular imports introduced | U | |
| 5 | Cross-module interfaces are schema-defined (types/contracts) | P | |
| 6 | Module I/O is serializable | P | |
| 7 | No hardcoded paths, URLs, keys, or config values | E | |
| 8 | All new dependencies explicitly declared in dependency file | E | |
| 9 | New modules can be replaced without changes to other modules | R | |
| 10 | All tests pass after the change | — | |

Scoring: all pass = proceed; 1–2 fail = fix before completion; 3+ fail = stop and refactor.

## Python and Architecture Rules

- Keep HTTP handlers responsible for authentication, parsing, status mapping, and response assembly.
- Keep application services responsible for a complete transaction and its ordered post-commit effects.
- Keep repositories responsible for SQL and payload persistence.
- Preserve old payloads, schema migrations, audit action names, API response shapes, and status codes.
- Use explicit callable/dataclass ports for dependency injection. Avoid anonymous string-keyed dependency bags.
- Keep `server.py` compatibility resolution stable until Phase 6. Re-export moved symbols explicitly.
- Run focused Python tests after each edit; run architecture validation and `git diff --check` before task completion.

## Project Context

Target flow: `web → application/domain → repository/persistence → SQLite`. Current hotspots are the 7349-line `legacy.py`, its 1992-line handler, state transaction orchestration, dynamic compatibility exports, and billing/workflow/reimbursement side-effect ordering. The final `legacy.py` contains only explicit compatibility exports, thin HTTP composition, and runtime forwarding and stays at or below 250 lines.

## Progress and Parallel Work

- Read lane assignments from `docs/plan/task-breakdown.md`.
- Use isolated worktrees for parallel lanes and merge sequentially when files overlap.
- In `LOCAL_ONLY`, check the completed task in its phase file, update phase counts and Current Status in MASTER.md, then record telemetry.
- After every merge, rerun architecture validation and the relevant combined tests.

## Post-Task Telemetry — Execute After Every Task

1. Record effort: S `<30m`; M `30m–2h`; L `2–4h`; XL `>4h` or strategy rethink.
2. Run the 10-point checklist and record the score.
3. Count unplanned files, dependencies, and prerequisite tasks.
4. Append a row to MASTER.md Task Telemetry Log.
5. Update completed task count and cumulative drift score using `max(0, effort_delta) + stagnation + min(unplanned_deps, 2)`.
6. Compare drift to the active phase thresholds. Annotate at 20%, replan at 40%, rescope at 60%.

When every phase checkbox is complete, archive `docs/analysis`, `docs/plan`, `docs/progress`, and this Skill under `docs/archives/legacy-decomposition/`.
