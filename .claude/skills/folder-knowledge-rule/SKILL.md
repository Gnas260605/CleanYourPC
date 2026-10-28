---
name: folder-knowledge-rule
description: How to add or change a Disk Analyzer classification rule in WinPulse (src-tauri/src/folder_knowledge.rs) with Vietnamese texts, the right safety level, and tests. Use when a large folder shows up as "Chưa rõ" (Unknown) or is classified wrongly.
---

# Add a folder-knowledge rule

Rules live in `RULES` in `src-tauri/src/folder_knowledge.rs`. The scanner (`disk_analyzer.rs`) calls `classify` for every folder/file; a matched folder is reported as one block and not descended into.

## 1. Pick the safety level (be conservative)
| Level | Use when | UI |
| :-- | :-- | :-- |
| `Safe` | Pure cache that the app recreates; deleting loses no user data or login | Recycle button |
| `Caution` | Deletable but with a cost (re-download, rebuild, re-login) | Recycle button + `consequence` shown in the confirm dialog |
| `UseTool` | Must be cleaned by an official tool/command (WSL/Docker vhdx, WinSxS, Windows Update, installed apps) | Guide only |
| `Keep` | Personal or profile data (Documents, browser profile, .ssh...) | Open in Explorer only |

When unsure, choose the stricter level. Never mark anything under a user's personal folders, a browser profile root, or `C:\Windows` as `Safe`/`Caution`.

## 2. Write the pattern
- Components are **lowercase**; `"*"` matches exactly one component. Matching is per path component, never substring.
- `Anchor::End` = the path *is* that folder (use for caches/targets). `Anchor::Anywhere` = the path is *inside* it (use for `Keep` areas).
- Anchor app caches to their real location so a user's own folder with the same name does not match, e.g. `["appdata", "roaming", "code", "cache"]`, not `["code", "cache"]`.
- Need a filesystem check (e.g. sibling `Cargo.toml`)? Add a `Condition` variant, compute it in `disk_analyzer::classify_path`, and pass it via `ClassifyInput`.
- Order matters only among non-`Keep` rules (first match wins; put specific rules first). `Keep` always wins, and a blacklisted path (`PathSafetyValidator::is_blacklisted_path`) is forced to `Keep`.

## 3. Write the Vietnamese texts
- `title`: short name. `description`: "Đây là gì". `consequence`: "Xóa có sao không" — concrete effect. `how_to_clean`: the correct way, with the exact command for `UseTool` (shown as code).

## 4. Test
Add the path to the matching test in `folder_knowledge.rs` (`test_safe_rules`, `test_caution_rules`, `test_use_tool_rules`, `test_keep_rules`) and, for a cache rule, a negative case in `test_safe_rules_need_appdata_anchor` showing a same-named user folder is not matched. `test_rule_ids_unique_and_patterns_lowercase` checks ids/patterns automatically.

`folder_knowledge.rs` only depends on `safety.rs`, so its tests can run on Linux with a scratch crate (outside the repo) that has `serde`, `serde_json`, `tracing`, `thiserror` and a stub `error` module (`AppError` with `IoError`, `PermissionDenied`, `InvalidPath`, `SystemError`, `ResourceBusy`, `InvalidState`, `Unknown` + `From<std::io::Error>` + `AppResult`), including the real files via `#[path = ".../src-tauri/src/safety.rs"] pub mod safety;` and the same for `folder_knowledge.rs`. Then run `cargo test`. The full suite still runs only on Windows CI.

## 5. Finish
Run the `zero-harm-review` skill if the rule is `Safe` or `Caution` (it enables a delete button), then `verify-change`.
