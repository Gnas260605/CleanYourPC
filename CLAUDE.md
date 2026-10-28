# CLAUDE.md

WinPulse Optimizer — Windows system optimizer. Tauri v2 (Rust backend in `src-tauri/`) + React 18/TypeScript/Vite/Tailwind (frontend in `src/`). UI text and code comments are Vietnamese; keep that.

## Current work
Follow `UPGRADE_PLAN.md` in order (phase 1 security fixes first). Tick boxes there as items land.

## Commands
- Frontend: `npm ci`, `npm run build` (runs `tsc` + `vite build`), `npm run dev` (port 1420).
- Backend (Windows only): `cd src-tauri && cargo test`, `cargo clippy -- -D warnings`.
- App: `npx @tauri-apps/cli dev`.

On a Linux/cloud machine the Rust crate cannot be built or tested (uses `windows` crate and `std::os::windows`). Use the `verify-change` skill to see what can be checked there; Windows CI is the source of truth.

## Architecture in one paragraph
`lib.rs` registers every `#[tauri::command]` from `commands.rs`; commands are thin wrappers over modules (`cleaner`, `process_guardian`, `startup`, `restore_point`, `metrics`, `config`, `history`, `tray`). All file deletion must go through `safety.rs` (`PathSafetyValidator`, `SafeFileOps`). Frontend calls the backend only via `src/services/apiBridge.ts` (and `useHardwareMetrics` for metrics); types mirror Rust structs in `src/types/index.ts`.

## Hard rules (from RULE.md)
- Any code that deletes files, kills processes, edits registry or services: run the `zero-harm-review` skill before considering it done.
- Never trust paths/PIDs/ids from the frontend alone — validate in Rust.
- No `unwrap()`/`expect()` in non-test Rust code; return `AppResult`.
- Never add registry cleaning or "free all RAM" features.
- Prefer Recycle Bin over permanent delete for user-visible deletions.
