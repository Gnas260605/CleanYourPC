---
name: add-tauri-command
description: Steps to add or change a backend command in WinPulse end to end (Rust module, commands.rs, lib.rs registration, TS types, apiBridge). Use whenever a feature needs new data or a new action from the Rust backend.
---

# Add a Tauri command

1. **Logic in a module**, not in `commands.rs`: e.g. `src-tauri/src/disk_analyzer.rs`. Declare it with `pub mod` in `src-tauri/src/lib.rs`. Return `AppResult<T>` (`src-tauri/src/error.rs`); add an `AppError` variant only if none fits.
2. **Payload structs** derive `Debug, Clone, Serialize, Deserialize`. Field names stay snake_case (existing convention — the frontend reads snake_case from the backend, see `BackendHardwareMetrics` in `src/types/index.ts`).
3. **Command wrapper** in `src-tauri/src/commands.rs`: `#[tauri::command] pub async fn name(...) -> Result<T, AppError>`. Blocking/filesystem work goes in `tokio::task::spawn_blocking`. Long jobs emit progress with `app.emit("event-name", payload)` and support cancel via shared state managed with `.manage(...)`.
4. **Register** it in the `generate_handler![...]` list in `src-tauri/src/lib.rs`, grouped with its feature.
5. **Types**: add the matching interface to `src/types/index.ts`.
6. **Bridge**: add a function in `src/services/apiBridge.ts` that calls `invoke` when `isTauriContext()`. Read-only commands may fall back to the debug HTTP server (GET only); mutating commands must throw a clear Vietnamese error outside Tauri — never fall back to HTTP.
7. **UI** uses only the bridge function, never `invoke` directly.
8. If it deletes/kills/edits registry or services, run the `zero-harm-review` skill.
9. Run the `verify-change` skill.
