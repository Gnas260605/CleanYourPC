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
The crate targets Windows only (`windows` crate, `std::os::windows`, registry APIs). On Linux:
```bash
rustup target add x86_64-pc-windows-msvc
cd src-tauri && cargo check --target x86_64-pc-windows-msvc
```
This type-checks without linking. If it fails inside a build script (e.g. resource compilation from `tauri-build`) rather than in project code, say so explicitly — do not claim the Rust side is verified. `cargo test` cannot run here.

## Windows (full)
```bash
cd src-tauri && cargo test && cargo clippy -- -D warnings
npx @tauri-apps/cli dev
```
In the running app, exercise the changed tab by hand.

## Reporting
State exactly which of the above ran and their result. If Rust tests could not run, say they still need Windows CI.
