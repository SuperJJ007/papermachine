# PaperMachine Desktop

English | [中文](README.zh.md)

The desktop application is an Electron shell around the dsh Web UI. It opens no listening port: a bundled upstream Node.js child boots the installed dsh project, versioned framed byte pipes carry Fetch requests and streaming responses without an outer Base64 envelope, Node IPC carries lifecycle control, and `dsh-app://` serves the matching client assets.

## Key technical decisions

| Decision | Why | Direct consequence |
|---|---|---|
| Release identity | The shell API, Web client, backend, and plugin graph are qualified as one combination; independent versions would create untested combinations and ambiguous update availability. | Electron and `@deepseek-ai/dsh` always have the same exact version. A dsh upgrade is a Desktop release, even when the shell code is unchanged. |
| Runtime | Electron's Node.js carries Electron patches, fuses, ABI, and lifecycle constraints, while system runtimes and package-manager state are uncontrolled. | dsh runs under the bundled upstream Node.js and every package operation uses the bundled pnpm. Electron's Node.js, system Node.js, system pnpm, and user package-manager configuration are outside the execution path. |
| Package sources | The exact dsh source build must be packageable before npm publication and install offline; plugins must remain ordinary user-selected npm packages. | The signed application carries locally packed first-party dsh packages and an offline seed store. Desktop plugins remain ordinary npm dependencies resolved from the fixed Desktop registry. |
| Seed transport | Apple notarization inspects code inside archives; shipping every pnpm store file separately would also make the application signature inventory tens of thousands of cache entries, while one compressed archive would amplify small package changes. | macOS packaging signs every Mach-O CAS object, rewrites its pnpm hashes, and proves another offline install before assigning store files to 16 deterministic uncompressed tar shards. The outer installer compresses them, and differential updates can reuse unchanged shards. |
| State ownership | Sharing executable dependency graphs would let CLI and Desktop change each other's dsh, Cordis, plugin, or native-module versions, while two desktop processes could race on the same profile. | Electron acquires its process-lifetime single-instance lock before any profile access and exclusively owns `$DSH_HOME/profiles/desktop` plus its package-manager state. PaperMachine CLI and Desktop share supported product data under the PaperMachine home, but never executable packages, plugin activation, lockfiles, or `node_modules`. |
| Transport | A listening Web service adds port ownership, authentication, CORS, and exposure concerns; Electron and upstream Node.js also need an explicit cross-process protocol. | The application opens no Web port. `dsh-app://` carries Web assets and Fetch traffic; framed byte pipes carry bounded request and response chunks with backpressure, while Node IPC carries only child lifecycle control. |
| Activation | Dependency resolution, lifecycle scripts, native modules, and plugin startup can fail, and a process can stop during directory replacement. | Release and plugin changes install in staging, boot a complete backend health check, and replace the active profile only after success; a journal and one rollback profile cover interrupted replacement. |
| Updates | Independent shell and dsh updates would recreate version splits, while unchanged shell blocks should not require a complete transfer. | The Electron shell, matching dsh seed, Node.js, and pnpm form one signed update unit. Platform update artifacts may reuse unchanged blocks, but runtime version selection never splits from the Desktop release. |

The [Electron packaging and update Agent Note](../../.agents/notes/implemented/architecture/2026-08-25-electron-desktop-packaging-and-updates.md) owns the rationale, alternatives, security constraints, and release qualification requirements behind these decisions.

## Installation ownership

PaperMachine resolves its data root from `PAPERMACHINE_HOME`, the saved absolute path in `~/.papermachine-home`, or `~/.papermachine`, in that order. It ignores inherited `DSH_HOME` and rejects paths overlapping the official `~/.dsh`, including symlink aliases. Electron sets both `userData` and `sessionData` to `<home>/desktop/electron-user-data` before claiming its single-instance lock or emitting `ready`. Active and staged Hosts receive the same resolved root as both `PAPERMACHINE_HOME` and `DSH_HOME`; the latter is the internal Harness path used below. The built-in profile includes `science-app` from the local first-party package set.

Electron owns the reserved profile at `$DSH_HOME/profiles/desktop`. Its manifest lists the built-in and installed plugin bundles in `dsh.profile.bundles`, while its `node_modules` contains the exact `@deepseek-ai/dsh` release, its matching private `@deepseek-ai/dsh-desktop-host`, and every desktop plugin. Keeping the Electron-only process entry and overlay in a private app package prevents Desktop implementation from becoming part of the public CLI package. The CLI cannot boot or mutate this profile. Electron always invokes its bundled Node.js and pnpm with the store at `$DSH_HOME/desktop/pnpm/store`; it never uses system pnpm or the caller's npm/pnpm configuration.

The main dsh renderer receives only the desktop protocol marker. The separate plugin window receives structured list, install, remove, update, and update-check operations; neither renderer receives filesystem access, raw Electron IPC, a shell, or arbitrary pnpm arguments.

Electron chooses typed English or Chinese shell copy from its application locale and falls back to English. Menus, native dialogs, and the plugin-management renderer use the same locale payload; the repository Client UI i18n gate checks these desktop sources.

### Seed installation

The packaged seed is an installation kit, not a ready-to-run `node_modules` tree. Packaging creates the lockfile, materializes the production graph online with lifecycle scripts disabled, deletes `node_modules` and every temporary pnpm cache, config, and state directory, and proves one complete installation offline from the final store alone with the private Desktop Host entry and overlay present. Each offline installation must also boot the complete Host and client-plugin composition under the bundled Node.js in an isolated temporary home, verify its release, and await shutdown; missing runtime dependencies fail preparation even when pnpm treats them as optional. A macOS build stages every Mach-O object from pnpm's content-addressed store, Developer ID signs at most four independent copies concurrently, and updates the affected SHA-512 index records only after all signers succeed. Another offline install proves the rewritten store before sharding; preparation then extracts the final archives and verifies every embedded signature. The signed seed retains the release identity, local first-party tarballs and their descriptor, project metadata, lockfile, integrity inventory, and pnpm store content required to repeat that installation on the user's machine.

| Seed content | Writable destination or use |
|---|---|
| `integrity.json` and `desktop-packages.json` | Verify every inventoried seed file, local tarball hash, and the bound dsh and Desktop Host versions before package state changes. |
| `store-archives.json` and `store-archives/*.tar` | Validate the deterministic uncompressed shards, extract them into a unique Desktop staging directory, replace matching immutable store files, and transactionally merge pnpm's versioned SQLite package index into `$DSH_HOME/desktop/pnpm/store` without removing packages already downloaded for Desktop plugins. |
| Project metadata and `desktop-packages/` | Copy into a unique `$DSH_HOME/desktop/staging/<transaction-id>/profile` project. |
| Lockfile and local package mappings | Drive the bundled pnpm installation without resolving a packaged core name from npm. |

Startup installs or reconciles the seed as one serialized transaction:

1. Recover an interrupted activation journal, verify the complete seed inventory and local package set, and require the seed version to equal Electron's application version.
2. If the active profile already contains that release plus the matching dsh and Desktop Host versions, verify that its complete local package set matches the seed and every installed package version matches that set before reusing it.
3. Otherwise validate every archive entry, extract all store shards into a temporary Desktop-owned staging directory, merge the package files and SQLite package-index records into the private store, create a staging profile, and run `pnpm install --offline --frozen-lockfile --trust-lockfile` through the bundled Node.js and pnpm. Seed records replace matching index keys while plugin-only records remain available.
4. During an Electron upgrade, read every plugin name and exact version from the old active profile and add those versions to staging with `--offline` from existing Desktop pnpm state. A first installation has no plugin-restore step.
5. Stop the active backend, boot and stop the complete staged backend as a health check, then restart the active backend before activation. This serialization prevents two desktop backends from sharing `$DSH_HOME`; installation or plugin incompatibility before activation deletes staging and leaves the active profile unchanged.
6. Persist each next activation phase before its directory move, move the active profile to `$DSH_HOME/desktop/rollback/profile`, and move staging into `$DSH_HOME/profiles/desktop`. Recovery combines the journal with the actual profile, rollback, and staging directories, so interruption in either write-to-move gap restores or retains a complete profile.

GUI plugin mutations use the same staging, health-check, activation, and rollback path after installing registry packages into the shared Desktop pnpm store.

The process-lifetime Electron lock is the primary desktop owner. The transaction lock is depth defense: it records Electron while preparing local state, records the spawned pnpm worker while that worker can still write, and returns ownership to Electron after the worker exits. A later process cannot treat a live orphaned worker as a stale transaction.

## Scientific environment and recovery

The product version is `PAPER_MACHINE_VERSION` in [product.ts](src/product.ts); the internal Electron package, dsh packages, and seed retain the harness release version. About, onboarding, and installer filenames use the product version. The bundled application remains one qualified shell/Host/client combination.

PaperMachine resolves its canonical data home before creating Electron browser data, taking the single-instance lock, or resolving desktop installation paths. Paths containing ASCII spaces are rejected because R requires a space-free scratch directory. The shell can choose a new location or reset the saved pointer; confirmation explains that existing data stays in place and the new location needs another runtime and environment installation. The application never relocates Session files. Shared home selection and official DSH isolation follow the [home-paths resolver](../../packages/util/home-paths/README.md).

On first run, the isolated onboarding page appears before seed extraction or package installation. Its locale-selected source and optional custom package list are validated in the main process. Explicit installation prepares the offline runtime, provisions and verifies the Conda environment, writes the durable binding, and starts the workspace. Cancellation waits for the installer process tree to stop; a failed install leaves onboarding available for retry. Changing environments stops the Host before provisioning can modify an existing prefix. Package transactions, environment changes, home changes, and shutdown cannot overlap.

The main process rewrites machine-specific Science configuration into each staged or active profile before starting its Host. Product composition remains in the Science bundle. Plugin staging copies `cordis.patch.yml`; release health checks and activation regenerate its prefixes, installation channels, timeout, and bundled-skills location. Reconciliation compares the whole local package descriptor and checks every installed package version, so a missing client package or a changed same-version package set triggers an offline repair. Session compatibility remains the persistence reader's responsibility; desktop repair does not rewrite Session files.

Onboarding and startup recovery are packaged assets served from `dsh-app://shell/`, with separate sandboxed preloads. Their IPC accepts only the owning window's main frame and exact page. The workspace receives only the desktop protocol marker. Startup failures offer install-location recovery, restart, and quit; an unexpected Host exit returns to setup. Electron browser data stays under the selected home, so the stable `dsh-app://app` origin retains client state across launches.

On POSIX systems the bundled Node Host leads its own process group. A separate bundled-Node watchdog collects that group if Electron disappears; orderly shutdown waits for Host descendants and the watchdog to exit. Host byte-pipe streams exclusively own their descriptors; shutdown awaits their close events after draining responses. The watcher never removes the package transaction lock: its recorded pnpm worker remains authoritative until that process exits. Host stderr is credential-redacted before persistence, bounded and rotated according to `resources/host.json`; theme preference is read before windows appear.

## Develop

`dev:desktop` selects the `papermachine` client build profile and builds the current Host, client bundles, Web frontend, and Electron shell, projects the built CLI and private Desktop Host packages with their workspace dependencies into a disposable desktop npm project, and launches Electron without downloading the packaged Node.js runtime or resolving dsh from npm:

```sh
pnpm run dev:desktop
```

Development Harness state defaults to `apps/desktop/.desktop-build/development/home`, the disposable npm project lives at `apps/desktop/.desktop-build/development/project`, and Electron browser data lives at `apps/desktop/.desktop-build/development/home/desktop/electron-user-data`. Sessions, settings, credentials, package links, and browser data therefore stay out of the user's normal Harness home. An explicit `PAPERMACHINE_HOME` replaces the development home and its browser-data directory; inherited `DSH_HOME` is ignored. Renderer DevTools opens automatically; Main, Renderer, and dsh Host debugging listen on ports 9229, 9222, and 9230. `DSH_DESKTOP_MAIN_INSPECT_PORT`, `DSH_DESKTOP_RENDERER_DEBUG_PORT`, and `DSH_DESKTOP_HOST_INSPECT_PORT` replace those ports, while `DSH_DESKTOP_OPEN_DEVTOOLS=0` keeps the detached Renderer tools closed.

After `pnpm run build --profile papermachine` and `pnpm run build:desktop`, `start:desktop` reconstructs the disposable project and launches the existing artifacts without building again:

```sh
pnpm run start:desktop
```

Both launch modes require a complete build record with the PaperMachine profile, `PaperMachine` document title, current commit and internal package version, and matching client artifact digest. `--skip-build` rejects official, missing, or subsequently modified client artifacts before resource preparation or Electron launch. The profile enables the PaperMachine sidebar and hero occupants; build metadata appears only in the default brand fallback. Rebuilding shared client outputs for another profile requires another PaperMachine build before Desktop can start.

Workspace development runs the current CLI and private Desktop Host packages under the invoking Node.js and disables desktop package mutations. Its explicitly linked disposable profile is the only mode allowed to resolve bundles outside its own directory. Use an unpacked application to exercise the bundled Node.js, bundled pnpm, release seed, plugin installation, staging, and rollback paths.

## Package

The normal packaging path is one complete command. It performs release preparation before creating the host platform's installers and update metadata. Every target defaults to the existing PaperMachine application ID `com.papermachine.desktop`; an explicit reverse-DNS `PAPERMACHINE_DESKTOP_APP_ID` overrides it. Keep the same ID across upgrades. The application is named `PaperMachine`, and installer names start with `papermachine-`. macOS targets additionally require the electron-builder certificate qualifier in `DSH_DESKTOP_MACOS_SIGNING_IDENTITY`, its 10-character Apple Team ID in `DSH_DESKTOP_MACOS_TEAM_ID`, and one complete notarytool credential strategy. The App Store Connect API-key strategy uses these variables:

```sh
export PAPERMACHINE_DESKTOP_APP_ID='com.papermachine.desktop'
export DSH_DESKTOP_MACOS_SIGNING_IDENTITY='<certificate name without the Developer ID Application prefix>'
export DSH_DESKTOP_MACOS_TEAM_ID='<10-character Apple Team ID>'
export APPLE_API_KEY='<absolute path to the .p8 file>'
export APPLE_API_KEY_ID='<App Store Connect API Key ID>'
export APPLE_API_ISSUER='<App Store Connect issuer UUID>'
```

`prepare:desktop` is not a prerequisite:

```sh
pnpm run package:desktop
```

Release automation uses fixed target commands so runtime preparation, seed installation, and electron-builder receive the same platform and architecture:

```sh
pnpm run package:desktop:mac:arm64
pnpm run package:desktop:mac:x64
pnpm run package:desktop:win:x64
```

The macOS arm64 command requires Apple Silicon. The macOS x64 command runs on Intel macOS or Apple Silicon with Rosetta. The Windows x64 command requires Windows x64. Linux is not a supported Desktop release target.

Each target owns its packed package inputs, prepared runtime, package set, seed, pnpm preparation state, unpacked application, update metadata, and final artifacts under `apps/desktop/.desktop-build/targets/<target>/`. The Node.js archive cache remains shared under `.desktop-build/downloads` because every archive name includes its version, platform, and architecture and is verified before extraction. A target build never consumes another target's mutable preparation state.

### Upload updates

`DSH_DESKTOP_AUTO_UPDATE_ENV` selects `test` or `production` for both the URL embedded during packaging and the later COS upload; an absent value selects `test`. Test packaging requires its HTTPS origin in `DOWNLOAD_TEST_ORIGIN`; production packaging requires `PAPERMACHINE_DOWNLOAD_ORIGIN`. Both reject the official `download.deepseek.com` host. Packaging embeds the selected URL, so installed applications need no environment variables to locate updates. Upload additionally requires the selected deployment's COS bucket in `DOWNLOAD_TEST_COS_BUCKET` or `DOWNLOAD_PROD_COS_BUCKET`. The target path is `_/papermachine/desktop/stable/<target>/`, where `target` is `mac-arm64`, `mac-x64`, or `win-x64`.

The update destination and upload credentials follow the selected deployment:

| Environment | Public origin | COS bucket | COS credentials |
|---|---|---|---|
| `test` or unset | `DOWNLOAD_TEST_ORIGIN` | `DOWNLOAD_TEST_COS_BUCKET` | `DOWNLOAD_TEST_COS_SECRET_ID`, `DOWNLOAD_TEST_COS_SECRET_KEY` |
| `production` | `PAPERMACHINE_DOWNLOAD_ORIGIN` | `DOWNLOAD_PROD_COS_BUCKET` | `DOWNLOAD_PROD_COS_SECRET_ID`, `DOWNLOAD_PROD_COS_SECRET_KEY` |

Package and upload one target under the same environment. For example, the default test deployment uses:

```sh
export DOWNLOAD_TEST_ORIGIN='https://desktop-updates.example.com'
pnpm run package:desktop:mac:arm64

export DOWNLOAD_TEST_COS_BUCKET='<test COS bucket>'
export DOWNLOAD_TEST_COS_SECRET_ID='<test COS SecretId>'
export DOWNLOAD_TEST_COS_SECRET_KEY='<test COS SecretKey>'
pnpm run upload:mac:arm64
```

Set `DSH_DESKTOP_AUTO_UPDATE_ENV=production` and `PAPERMACHINE_DOWNLOAD_ORIGIN` before packaging and keep both set for upload, then provide `DOWNLOAD_PROD_COS_BUCKET` and the production credential pair before running `upload:mac:arm64`, `upload:mac:x64`, or `upload:win:x64`. Packaging does not require a COS bucket or credentials. It explicitly disables electron-builder publishing, strips all four COS credential fields from its subprocesses, and writes a target completion record only after electron-builder and every signing or notarization hook succeeds. Upload requires that record to match the selected environment, target, public URL, and current dsh version; it also requires the root dsh version, Desktop version, channel metadata version, artifact names, sizes, and SHA-512 values to agree before it reads the selected COS credential pair. It uploads only that target's immutable versioned artifacts, uploads the version-derived channel metadata last with `no-cache`, and never deletes historical objects. Stable releases use `latest-mac.yml` or `latest.yml`; a prerelease such as `alpha` uses `alpha-mac.yml` or `alpha.yml`, matching electron-builder's emitted filename.

The macOS configuration uses the required release environment instead of accepting whichever certificate appears first in a keychain. It rejects empty values, a malformed Team ID, a signing identity that includes electron-builder's unsupported `Developer ID Application:` prefix, and incomplete notarization credentials. macOS packaging requires the configured identity and its private key. Seed preparation applies that identity, a secure timestamp, and hardened runtime to every embedded Mach-O file; after signing the application, a deep strict check rejects any other leaf authority or Team ID before artifact creation. Electron-builder notarizes and staples the application before packaging and signs the DMG. The DMG artifact-completion hook then notarizes and staples it before requiring its exact identity, ticket, and Gatekeeper acceptance; only after the hook succeeds can electron-builder publish the file. The private key can come from the login keychain or electron-builder's standard `CSC_LINK` input; ambient `CSC_NAME` and certificate discovery order do not select the release owner. Notary credentials may instead use electron-builder's complete Apple ID or keychain-profile strategy. The two macOS identity variables are also required when repeating the application check manually with `pnpm --dir apps/desktop run verify:mac-signature -- <path-to-app>`.

### Windows EV signing

Windows release packaging requires `DSH_DESKTOP_WINDOWS_CER_FILE` to identify the public GlobalSign EV leaf certificate, `DSH_DESKTOP_WINDOWS_SIGNTOOL` to identify the SafeNet-compatible SignTool executable, `DSH_DESKTOP_WINDOWS_KEY_CONTAINER` to identify the matching private-key container, and `DSH_DESKTOP_WINDOWS_TOKEN_PIN` to contain the SafeNet Token Password. The certificate file remains outside source control, and the matching private key stays on the USB token. Set the four inputs before running the fixed Windows target:

```powershell
$env:DSH_DESKTOP_WINDOWS_CER_FILE = 'C:\path\to\server.cer'
$env:DSH_DESKTOP_WINDOWS_SIGNTOOL = 'C:\path\to\the\validated\signtool.exe'
$env:DSH_DESKTOP_WINDOWS_KEY_CONTAINER = '<SafeNet private-key container name>'
$env:DSH_DESKTOP_WINDOWS_TOKEN_PIN = '<SafeNet Token Password>'
pnpm run package:desktop:win:x64
```

Insert and unlock the token before packaging. The electron-builder hook passes each artifact to the CRLF `scripts/windows-sign.cmd`, which invokes the configured SignTool once with `/f`, SafeNet `/kc "[{{PIN}}]=container"`, `/csp "eToken Base Cryptographic Provider"`, a SHA-256 file digest, and a DigiCert SHA-256 RFC 3161 timestamp. The hook never substitutes electron-builder's bundled SignTool and never retries a failed signing request. Windows packaging fails instead of emitting unsigned artifacts when the SignTool, certificate, container, PIN, token, or signature is unavailable.

The PIN cannot contain `]`, a quote, or a line break because those characters delimit the SafeNet `/kc` value or its CMD argument. The CMD disables delayed expansion so a PIN containing `!` reaches SafeNet unchanged. Packaging withholds every `DSH_DESKTOP_WINDOWS_*` field from build and seed-preparation subprocesses, gives electron-builder only the four configured inputs, gives the signing CMD only the validated signing fields in an otherwise scrubbed environment, clears those fields before SignTool starts, and redacts SignTool diagnostics. SafeNet still requires the PIN in the SignTool process command line. Inject it as an ephemeral secret only on a controlled self-hosted Windows runner with the physical token attached; never commit it, put it in `.env`, or persist it as a Windows user or system environment variable.

Create a runnable application directory instead of an installer by using the matching `:dir` command, such as:

```sh
pnpm run package:desktop:dir
pnpm run package:desktop:mac:arm64:dir
```

To inspect or troubleshoot the prepared host-target resources without invoking electron-builder, stop the same pipeline after preparation:

```sh
pnpm run prepare:desktop
```

This diagnostic command is an alternative stopping point, not the first half of a two-command build. A later `package:desktop*` command repeats the PaperMachine build and preparation so it cannot consume stale dsh packages, runtime files, or seed content.

Every package command performs the complete `papermachine` repository build, validates its client artifact record, packs the dsh family through the local Desktop preparer and the vendored family through release tooling, locally packs the private Desktop Host package, and packs the Landlock entry before preparing release resources. `prepare:packages` selects the union of the first-party production closures rooted at `@deepseek-ai/dsh` and `@deepseek-ai/dsh-desktop-host`, verifies that the private Host tarball contains `lib/index.js` and `config/desktop.cordis.patch.yml`, copies the selected tarballs into the seed input, and records their sizes and SHA-512 integrity. The Host package is never published to npm; its `files` manifest contains only that runtime entry and overlay. Package tarballs remain the `pnpm pack` outputs governed by each package's publication manifest, so Desktop adds no second filter, retains published declarations such as `lib/types`, and neither strips nor adds source maps independently. The local Desktop preparer reuses family version and tarball-content validation, but writes no npm publish-order manifest. Official `release:pack --family dsh` retains its exact official-profile check and rejects PaperMachine artifacts. Registry packages likewise retain their published package bytes in pnpm's content-addressed store. The dsh release bump updates both private Desktop manifests together with the root and publishable workspaces; packaging also requires the root dsh package, Desktop Host package, and Electron package to have the same version. Neither dsh nor the private Host needs to be published to npm before the Desktop application is built. `prepare:runtime` downloads Node.js 24.17.0 from the official Node.js release service, verifies its SHA-256 entry before extraction, and executes the prepared target binary on a compatible build host to verify its reported version. It copies the pnpm version declared by the desktop package and records both runtime versions in the release seed. `prepare:seed` runs that target Node.js and bundled pnpm, so platform- and CPU-filtered optional dependencies make the pnpm store and seed target-specific. It generates local core-package mappings, disables the global virtual store, materializes external production dependencies from npm without lifecycle scripts, deletes `node_modules` and all temporary pnpm cache, config, and state, proves the complete graph installs offline with the private Host entry and overlay, performs the macOS rewrite when applicable, proves the rewritten store with another offline installation, removes temporary pnpm project registrations, and replaces the loose store with 16 deterministic uncompressed tar shards. It extracts those final shards and verifies every embedded macOS signature before inventory generation. Later GUI plugin operations retain the local core mappings while resolving plugin packages and their external dependencies from the fixed Desktop npm registry. `electron-builder` emits each target's platform artifacts under `apps/desktop/.desktop-build/targets/<target>/artifacts`; a later version keeps differently named immutable installers and blockmaps while replacing that target's unpacked application, diagnostics, completion record, and channel metadata.

An unpacked artifact contains four independent size contributors: Electron, the offline seed store shards and local dsh tarballs, the upstream Node.js and pnpm runtime, and the small shell application. The shards are uncompressed so the outer DMG, ZIP, or NSIS compressor and differential updater can operate on stable ranges. Filesystem size is not installer download size, so measure both separately. First packaged startup also extracts the seed store into `$DSH_HOME/desktop/pnpm/store` before installing the writable profile, so release qualification must measure both application and Harness-home disk use.

## Updates

A packaged application checks its target-specific release stream ten seconds after the main window opens; the localized **Check for Updates…** menu item triggers the same check manually. An available release opens one native confirmation dialog. Accepting it waits for an in-flight check, downloads and verifies the signed Desktop release, stops the dsh child, and hands installation plus restart to electron-updater. The next launch reconciles the version-bound seed before reopening the product window. Startup compares the seed package descriptor and installed package versions even when the internal release number is unchanged; a changed closure or missing client package triggers staged repair.

Electron-builder always emits generic-provider channel metadata for the deployment selected by `DSH_DESKTOP_AUTO_UPDATE_ENV`. NSIS differential packages and the macOS ZIP target allow electron-updater to reuse unchanged blocks; the manually installed DMG is notarized without a blockmap because it is not a macOS updater payload. The seed and shell still form one signed Desktop release. macOS signing and notarization credentials use electron-builder's standard environment; Windows EV signing uses the public certificate, validated SignTool, SafeNet container, and runner PIN described above. The required Desktop release environment selects the application and platform signature identities that the build verifies.

## Product resource preparation

`src/product-version.json` is the source for `PAPER_MACHINE_VERSION` and electron-builder's artifact name: `papermachine-0.1.3-${os}-${arch}.${ext}`. Update metadata and seed verification retain the internal package version. `extraResources` includes the product environment declarations, bundled skills, host and telemetry configuration, and prepared executables under `product/`. Telemetry configuration is present, but the desktop main process does not currently send telemetry.

Both the development launcher and target packaging prepare micromamba before starting their work. The resource preparer verifies cached bytes against `resources/micromamba.json`, downloads missing or mismatched bytes from its existing official release URLs, and publishes files only after SHA-256 verification. Windows resource preparation also extracts the pinned app-local CRT; Windows execution and installer qualification remain separate checks. Generated executables under `resources/bin/` are ignored by Git.

After the repository and Desktop builds have completed, run from the repository root without invoking installation or another build:

```sh
node --import tsx/esm apps/desktop/scripts/prepare-product-resources.ts
PAPERMACHINE_HOME=/private/tmp/papermachine-desktop-acceptance DSH_TELEMETRY_DISABLED=1 node --import tsx/esm apps/desktop/scripts/dev.ts --skip-build
```

Choose a fresh, space-free home for first-run acceptance. The launcher opens onboarding; installing its scientific environment requires access to the selected Conda package sources. Closing and reopening with the same home preserves browser storage. To prepare a different packaged target's executable explicitly, pass `darwin-arm64`, `darwin-x64`, or `win32-x64` to the resource preparer.

The development launcher projects workspace dependency links and skips `DesktopProjectManager.applyRelease()`. It exercises onboarding, environment provisioning, Host startup and UI behavior, but does not qualify seed extraction, offline installation, staged activation or installed-profile upgrades. The macOS seed preparer requires Developer ID signing identity and Team ID, including in `--prepare-only` packaging; there is no supported unsigned macOS seed-preparation mode.

## Low-level development overrides

`DSH_DESKTOP_NODE_BINARY`, `DSH_DESKTOP_PNPM_ENTRY`, `DSH_DESKTOP_SEED_DIR`, and `DSH_DESKTOP_DEV_PROJECT_DIR` select explicit resources for an unpackaged Electron process. Packaged applications ignore these variables and resolve signed resources from `process.resourcesPath`.

## Known limitations

- The Web "Open In..." action is disabled in Desktop because its host plugin requires HTTP routes; Desktop does not provide a `webServer`.
- Release signing, notarization, update hosting, and previous-version installed-artifact qualification require the production release environment.
- Desktop plugins with dependency lifecycle scripts are rejected unless their package appears in the desktop project's reviewed `allowBuilds` policy.
- The desktop shell shares sessions, settings, credentials, workspaces, and storage under `$DSH_HOME` with the PaperMachine CLI, while executable packages, plugin activation, lockfiles, and package-manager state remain separate.
