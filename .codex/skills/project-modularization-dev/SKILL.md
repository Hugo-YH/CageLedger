---
name: project-modularization-dev
description: Continue CageLedger project modularization across Python, React, CSS, scripts, tests, and contracts. Use when implementing or reviewing tasks from docs/progress/MASTER.md on the codex/project-modularization branch.
---

# CageLedger Modularization

## Continuity

Read `docs/progress/MASTER.md` first. In `LOCAL_ONLY` mode, read the active phase file, execute the next unchecked task, record telemetry, then update both files.

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
- All dependencies explicitly declared
- Processes are stateless; persistence delegated to external storage
- Logs to stdout. Same codebase runs locally, in Docker, on cloud
- **Config precedence**: Environment variables > .env > config file > in-code defaults

### R — Replaceable Parts

- Any layer can be replaced without affecting others
- Replacement cost is THE core metric of architecture quality
- If replacing one component triggers cascading changes, the architecture is broken
- **Validation**: Ask whether an implementation can be swapped by touching only its module directory.

## S.U.P.E.R Code Review — Run After Every Task

| #   | Check                                                | Principle  |
| --- | ---------------------------------------------------- | ---------- |
| 1   | Every new module/file has exactly one responsibility | S          |
| 2   | No function does more than one conceptual thing      | S          |
| 3   | Data flows input → processing → output               | U          |
| 4   | No circular imports introduced                       | U          |
| 5   | Cross-module interfaces are schema-defined           | P          |
| 6   | Module I/O is serializable                           | P          |
| 7   | No hardcoded paths, URLs, keys, or config            | E          |
| 8   | Dependencies are explicitly declared                 | E          |
| 9   | New modules are replaceable within their boundary    | R          |
| 10  | Required tests pass                                  | Validation |

All pass: proceed. One or two failures: fix first. Three or more failures: stop and refactor.

## Project Rules

- Preserve API, SQLite, QR ID, IACUC, permission, audit, billing, UI and export behavior.
- Keep Python dependencies `routes -> service -> repository/rules`.
- Keep React View components focused on query orchestration and layout; move drafts to hooks and UI sections to components.
- Preserve Query keys and mutation invalidation semantics.
- Split CSS mechanically in original cascade order before deduplication.
- Use temporary databases and leave `data/`, `dist/`, and `web-dist/` untouched.
- Run the validation matrix from `AGENTS.md` and `docs/plan/task-breakdown.md`.

## Progress And Telemetry

Before checking a task:

1. Record estimated and actual effort.
2. Record S.U.P.E.R score out of 10.
3. Count unplanned dependencies.
4. Calculate drift contribution.
5. Update the phase checkbox, MASTER counts, Current Status, telemetry log and drift state.
6. Apply annotate, replan or rescope threshold action before the next task.

## Parallel Work

Use lane assignments in `docs/plan/task-breakdown.md`. Keep write sets disjoint, merge sequentially, run full tests after consolidation, and recheck dependency direction.

## Archive Trigger

When all tasks are complete, move analysis, plan, progress and this Skill into `docs/archives/project-modularization/`, then update `docs/archives/README.md`.
