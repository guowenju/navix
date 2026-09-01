# Repository Guidelines

## Project Structure & Module Organization

This monorepo uses two workspaces: Rust (`Cargo.toml`) and Node (`pnpm-workspace.yaml`).

- `apps/client`: Tauri client app (`src/` for React UI, `src-tauri/` for Rust host).
- `apps/server`: Rust + Axum backend (`src/api`, `src/services`, `src/models`, `migrations/`) and embedded web client (`web/src/pages`, `web/src/components`, `web/src/router`).
- `packages/`: shared packages used across frontend and backend, including Rust and TypeScript utilities.

### Verification

- `pnpm format`: format frontend code when only frontend code changed.
- `pnpm check`: verify frontend code when only frontend code changed.
- `cargo fmt`: format Rust code when only Rust code changed.
- `cargo clippy`: lint Rust code when only Rust code changed.
- `pnpm format:all`: format the repo when both frontend and backend changed.
- `pnpm check:all`: verify the repo when both frontend and backend changed.

## Coding Style & Naming Conventions

- Rust: `rustfmt` defaults (4-space indent), `snake_case` modules/files, `CamelCase` types.
- TypeScript/React: 2-space indent, `PascalCase` components (for example `UserMenu.tsx`), `camelCase` hooks/utilities (for example `useCurrentUser.ts`).
- Keep feature-local styles next to components (`*.module.css` in `apps/server/web`, `*.styles.ts` in client).
- Frontend in this repo means the TS/React code under `apps/server/web` and `apps/client`.
- Use the repo formatting commands for TS/React code: `pnpm format` for frontend-only changes, `pnpm format:all` when frontend and backend both changed.
- Frontend business UI must include stable, searchable DOM markers for debugging and automation. Prefer `data-page`, `data-ui`, and `data-slot`; use `id` only when global uniqueness is semantically required.

## Testing Guidelines

- Rust tests: place unit tests near modules (`mod tests`) and integration tests under crate-level `tests/`.
- `cargo test --workspace`: run Rust tests across crates when task scope requires it.
- Frontend automated tests are limited today; when adding critical UI logic, include tests and document how to run them.
- Before PRs touching backend sync/auth paths, run at least `cargo test --workspace` and a local smoke run of affected app(s).

## Documentation Guidelines

- Add Chinese documentation comments for frontend/backend functions, structs, and modules; Rust docs must use `//!` and `///` and comply with `cargo doc` conventions.
- CHANGELOG entries should be user-facing; avoid implementation details and internal refactors.

## Commit & Pull Request Guidelines

- Commit messages follow a Conventional Commits-style prefix such as `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `style:`, or `build:`.
- Keep commits scoped and descriptive; separate refactors from behavior changes when possible.

## Development Process

- If a task requires modifying more than five files, pause first and break it down into updated tasks.
- Before writing any code, please describe your proposed approach and wait for approval. If the requirements are unclear, make sure to ask clarifying questions before writing any code.
- After modifying only frontend code, run `pnpm format` and `pnpm check` before final verification.
- After modifying only backend Rust code, run `cargo fmt` and `cargo clippy` before final verification.
- After modifying both frontend and backend code, run `pnpm format:all` and `pnpm check:all` before final verification.
- During refactor compatibility is not required; prioritize a clean redesign.
- When a bug is caused by backend, engine, state machine, or lifecycle timing issues, do not add frontend “stopgap” patches to mask it. Fix the source of truth first, and only adjust frontend logic when the root cause is genuinely on the frontend side.
