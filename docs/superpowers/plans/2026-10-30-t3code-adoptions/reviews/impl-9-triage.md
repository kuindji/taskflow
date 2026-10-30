# Section 9 review triage

Review: `impl-9.md` (`codex exec review --base cd4b7ad2`, gpt-6.1-sol). One finding, reported twice.

- **P2, account diagnostics missing from an older backend's answer** (`AgentAccountsSection.tsx:47`): confirmed. A backend from before Section 9 answers `codex:models` with `{ models }`; both advertise protocol version 2, so the handshake accepts it. `setStatus(undefined)` then makes `status.state` throw while rendering Codex settings. Fixed in the shared loader (`lib/agent-discovery.ts`): `account` absent reads as `{ state: "unknown" }`, so the model picker and every diagnostic row get a defined status. Test `lib/agent-discovery.test.ts` fails on the old loader (2/2) and passes on the fix. Commit `f8584236`.

Own checks, no change:
- Pi table fallback now throws on a non-zero `pi --list-models` exit (the old `captureCliOutput` path ignored the exit code), so a CLI that printed the table and exited non-zero would return no models. Pi exits 0 there; left as is.
- Pi RPC waits for both `get_state` and `get_available_models` responses; a CLI that never answers `get_state` holds discovery until the 60 s deadline and returns no models. Pi 0.74.2 answers both; a `success: false` state answer is handled (models without default).
