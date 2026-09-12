# Agent Note: Local Windows installed-package acceptance

Status: implemented

English | [中文](2026-09-12-local-windows-package-acceptance.zh.md)

## Problem

Windows installed-app acceptance requires an NSIS package, but release packaging requires a SafeNet token. A development machine may already have a test Code Signing certificate suitable for local execution.

## Decision

Extend the explicit local acceptance mode to Windows with a thumbprint selecting an existing `LocalMachine\\My` certificate. PowerShell applies SHA-256 Authenticode signatures without exporting private keys or changing trust stores. Both ordinary executable signing and the temporary NSIS bootstrap use this signer; generated PE certificate-table repair remains in place. Certificate selection, private-key availability, Code Signing usage, signer identity, and signature status fail closed. Only valid or certificate-untrusted signatures qualify for local packaging.

PowerShell may report an untrusted self-signed certificate as `UnknownError`. The native [WinVerifyTrust](https://learn.microsoft.com/en-us/windows/win32/api/wintrust/nf-wintrust-winverifytrust) result distinguishes the specific `CERT_E_UNTRUSTEDROOT` failure from an invalid digest or other trust failure without parsing localized messages. Local packaging permits that one trust failure and zero; it does not mark the certificate trusted. Every verification closes the provider state. Signer identity comes from the embedded certificate because PowerShell can prefer a catalog signature. Windows certificate-backed tests sign disposable copies of Node and a catalog-signed system executable, then verify that changing a covered byte produces `TRUST_E_BAD_DIGEST`.

## Alternatives considered

**Request release credentials for every local run.** Local installed behavior does not require release distribution identity. The selected test certificate is sufficient without changing the SafeNet release workflow.

**Disable signing or application control.** This would omit NSIS bootstrap signature behavior or weaken the host. Local mode retains signing and leaves Windows execution decisions unchanged.

## Consequences

Local Windows artifacts use the existing isolated target directories and local filenames, omit update configuration and release completion records, and cannot enter the upload workflow. Tests cover certificate selection, SHA-256 enforcement, subprocess credential removal, target paths passed as data, signing failure, and packaging isolation. Real Windows signing and installed UI acceptance remain distinct evidence. No Session output changes, so a recorded-session snapshot does not exercise this packaging behavior.
