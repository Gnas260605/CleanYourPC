---
name: verify-change
description: How to verify a WinPulse change, both on a Linux/cloud sandbox (limited) and on Windows/CI (full). Use before committing or declaring a task done.
---

# Verify a change

## Frontend (works everywhere)
```bash
npm ci
npm run build
```
`npm run build` runs `tsc` then `vite build`; both must pass with no new errors.

## Rust on Linux / cloud (limited)
The crate targets Windows only (`windows` crate, `std::os::windows`, registry APIs). On Linux you can type-check and lint for the Windows target (no linking, no running):
```bash
rustup target add x86_64-pc-windows-msvc
cd src-tauri
cargo check  --target x86_64-pc-windows-msvc --tests
cargo clippy --target x86_64-pc-windows-msvc --tests -- -D warnings
cargo clippy --target x86_64-pc-windows-msvc -- -D warnings   # same as CI
```
A "GNU compiler is not supported for this target" warning from a build script is expected and harmless. If a build script fails outright, say so — do not claim the Rust side is verified.

Platform-independent modules (`safety.rs`, `scan_session.rs`, `folder_knowledge.rs`, `services.rs` pure parts, `disk_analyzer.rs` scanner/validation) can have their unit tests **run** on Linux through a scratch crate outside the repo — see the `folder-knowledge-rule` skill, step 4. Report these as "logic tests run on Linux", not as the full suite.

## Windows (full)
```bash
cd src-tauri && cargo test && cargo clippy -- -D warnings
npx @tauri-apps/cli dev
```
In the running app, exercise the changed tab by hand.

## Reporting
State exactly which of the above ran and their result. If Rust tests could not run, say they still need Windows CI.
