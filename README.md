# ⚡ WinPulse Optimizer (CleanYourPC)

> **A modern, safe and transparent Windows optimizer, with no ads, no bloat and no placebo tricks.**
>
> 🇻🇳 Bản tiếng Việt: [README.vi.md](./README.vi.md)

![License: MIT](https://img.shields.io/badge/license-MIT-green)
![Platform: Windows 10/11](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-blue)
![Built with Rust + Tauri v2](https://img.shields.io/badge/built%20with-Rust%20%2B%20Tauri%20v2-orange)

---

## Why another PC cleaner?

Many popular Windows "optimizers" cause more problems than they fix:

1. **Ads and bundled bloatware.** The tool itself becomes the heaviest thing on the machine.
2. **Placebo optimizations.** Forced RAM flushing and wiping useful caches make Windows reload everything, so the PC gets slower.
3. **Blind registry cleaning.** Deleting registry keys it doesn't understand can break Windows Update or crash apps.
4. **No transparency.** Users never see what was deleted or which process was touched.

WinPulse is built around the opposite principles:

- **Zero bloat:** under 25 MB of RAM in the background and about 0% CPU when idle.
- **Safety first:** a dry-run before every action, restore points, backups and undo.
- **Official Windows APIs:** EcoQoS / Efficiency Mode, Process Power Throttling and the StartupApproved flags, with no shell hacks.
- **Full transparency:** every file, process, startup entry and service is listed before anything changes.

## Features

| Module | What it does |
| :--- | :--- |
| **Dashboard** | Real-time CPU (total and per core), RAM, disk I/O and network gauges, a 0–100 health score, and one-click Quick Boost. |
| **Startup Manager** | Scans `HKCU\Run`, `HKLM\Run` and the Startup folders, and estimates each entry's boot impact. It toggles entries only through `StartupApproved` flags (never deletes them) and writes a JSON backup first. |
| **Process Guardian** | Live process list with multi-tier protection for critical processes (`csrss`, `lsass`, `dwm`, `explorer`, …). Supports Windows 11 Efficiency Mode (EcoQoS) and on-demand working-set trimming. |
| **Safe Cleaner** | Always runs a dry-run first, so you review every file before deletion. Temp files younger than 24 h are skipped. System32, SysWOW64, Boot, EFI, user folders and browser databases are permanently blacklisted. Locked files are skipped without crashing. |
| **Services Optimizer** | Groups Windows services into three tiers (*Safe to disable*, *Caution*, *Locked*), with an explanation for each one. |
| **History and tray** | Audit log of every optimization, persistent settings, minimize to tray and a background Quick Boost. |

## Safety guarantees

These rules are enforced in code and covered by tests (see [`RULE.md`](./RULE.md) and [`SAFETY_AUDIT_REPORT.md`](./SAFETY_AUDIT_REPORT.md)):

- **Absolute path blacklist** with path normalization and `..` traversal protection.
- **No blind registry cleaning.** Only `StartupApproved` flags are modified, and a backup is always made first.
- **Mandatory dry-run.** Nothing is deleted without explicit user approval.
- **No shell execution.** The app never runs `powershell` or `cmd.exe`; all system access goes through `windows-rs`, `sysinfo` and `winreg`.
- **No `.unwrap()` / `.expect()`** in the production backend. All errors flow through `Result<T, AppError>`.
- **Least privilege.** The app runs as a standard user and asks for admin rights only when an action needs them.

The test suite has **39 tests**: 31 unit tests and 8 safety integration tests in `src-tauri/tests/`.

## Tech stack

- **Core:** Rust 2021 (`windows` crate, `sysinfo`, `winreg`, `tokio`)
- **Shell:** Tauri v2, which uses the system WebView2 instead of bundling Chromium, so the installer is about 10–15 MB
- **UI:** React 18, TypeScript, Vite, Tailwind CSS and Lucide icons

## Getting started

**Requirements:** Windows 10/11, [Rust](https://rustup.rs) (stable), Visual Studio C++ Build Tools, Node.js LTS (20 or 22), and the WebView2 runtime (preinstalled on Windows 11).

```bash
git clone https://github.com/Gnas260605/CleanYourPC.git
cd CleanYourPC
npm ci

# Run in development mode
npx @tauri-apps/cli@^2 dev

# Build an installer
npx @tauri-apps/cli@^2 build

# Backend tests and lints (Windows only)
cd src-tauri
cargo test
cargo clippy -- -D warnings
```

## Project documentation

| File | Contents |
| :--- | :--- |
| [`PLAN.md`](./PLAN.md) | Implementation phases and milestones |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Architecture, privilege separation and IPC |
| [`SPECS.md`](./SPECS.md) | Functional specs and the safety classification matrix |
| [`RULE.md`](./RULE.md) | Safety rules, coding conventions and review criteria |
| [`REAL_WORLD_ANALYSIS.md`](./REAL_WORLD_ANALYSIS.md) | Common cleaner myths, antivirus issues and Windows 11 API notes |
| [`MEMORY.md`](./MEMORY.md) | Architecture decision records and trade-offs |
| [`UPGRADE_PLAN.md`](./UPGRADE_PLAN.md) | Roadmap |

*Most of these documents are currently written in Vietnamese. English translations are welcome.*

## Contributing

Issues and pull requests are welcome. Before you open a PR, please read [`RULE.md`](./RULE.md): any change that touches files, the registry, processes or services must keep every safety guarantee above and include tests.

## License

[MIT](./LICENSE) © 2026 Gnas260605
