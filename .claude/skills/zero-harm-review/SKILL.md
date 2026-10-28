---
name: zero-harm-review
description: Safety checklist for WinPulse code that deletes files, kills/throttles processes, edits registry startup keys, or changes Windows services. Use before finishing any change touching cleaner.rs, safety.rs, process_guardian.rs, startup.rs, services, disk analyzer deletion, http_server.rs, or the matching frontend actions.
---

# Zero-Harm review

Go through every item for the diff. Report each as pass / fail / n.a. with file:line. Fix every fail before finishing.

## Input trust
1. Every path, PID, registry id or service name arriving from the frontend is re-validated in Rust. Paths to delete must come from the backend's own scan session (scan id + item id), not raw strings.
2. Paths are compared after normalization/canonicalization by path components — not with `str::contains`.
3. Symlinks and junctions are not followed (`symlink_metadata`), so a link cannot redirect a delete outside allowed roots.

## Blast radius
4. Deletion target is under an explicitly allowed root and not matched by `PathSafetyValidator::is_blacklisted_path`. Rules marked Keep/UseTool/Unknown never reach a delete call.
5. User-visible deletes go to the Recycle Bin; permanent delete only for temp/cache that the scanner itself classified Safe.
6. Process actions refuse `is_critical_process` and PID 0/4/own PID. Service changes refuse `is_core_system_service`.
7. Registry writes are limited to `is_allowed_registry_startup_key` and are preceded by a backup that the UI can restore.

## Failure behaviour
8. Locked/denied items are skipped and counted, never abort the batch, never panic. No `unwrap()`/`expect()` outside tests.
9. The function returns the real outcome — no reporting success when Windows refused (e.g. missing admin rights).
10. The action is written to `history.rs`.

## Exposure
11. No mutating operation is reachable through `http_server.rs`; that server runs only in debug builds and checks Origin.
12. Frontend shows a confirmation that names the items and consequences before calling the command.

## Tests
13. A Rust test covers the rejection path (blacklisted path, path outside session, critical process). Note that these only run on Windows (CI `windows-latest`).
