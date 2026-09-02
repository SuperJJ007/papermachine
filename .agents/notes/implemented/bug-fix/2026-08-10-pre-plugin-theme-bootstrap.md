# Agent Note: Pre-Plugin Theme Bootstrap

Status: implemented

English | [中文](2026-08-10-pre-plugin-theme-bootstrap.zh.md)

## Problem

The web shell renders `Loading plugins…` before the browser-side plugin tree activates. ui-theme's token styles arrive with its dynamic client bundle, so the framework-free loading page uses a private light/dark fallback palette. Without an earlier write to `color-scheme` and `body[data-ds-dark-theme]`, a persisted dark preference would still render that page first with its light fallback and then switch to dark when ui-theme's ThemeRuntime and ui-layout's ThemePresenter activate.

`dshClient.immediately` only includes the bundle in first-stage prefetching; it does not cause the plugin to execute before HTML parsing or the shell's initial render. Changing only the client plugin's loading tier cannot close this window.

## Decision

ui-theme's host half answers every `webserver/index-inject` collection with one body-placed script row (`bootThemeInjection`), which `renderIndex` renders as a synchronous inline script immediately after the opening `<body>` tag. The subscription is unconditional — a composition without a web server never emits the event, so ui-theme still activates and contributes nothing. When the HTML parser executes the script, the body exists, but the shell's module script and framework-free boot page have not yet run.

The host half registers the [`ui-theme.preference` settings section](2026-08-06-host-backed-web-preferences.md) when a settings provider exists. For each index response, it embeds that schema-validated built-in preference in the inline script; without a settings provider or active registration, it embeds the `system` default. The browser resolves `system` through `prefers-color-scheme`, falling back to light when `matchMedia` is unavailable. It writes only the two pieces of DOM state that ThemePresenter later owns: `document.documentElement.style.colorScheme` and `body[data-ds-dark-theme]`.

The bootstrap logic recognizes only the built-in `light`, `dark`, and `system` semantics. It registers no listeners and does not resolve third-party themes or token overrides. After the browser-side plugin tree activates, ThemeRuntime remains authoritative for theme state, and ThemePresenter writes the complete resolved result back to the same DOM state and owns subsequent updates and disposal.

The Electron workspace window separately resolves its opaque pre-document background from the same durable `ui-theme.preference`, read directly from `<dshHome>/settings.yaml` before the window is created (`apps/desktop/src/window-theme.ts`'s `resolveWindowThemePreference`; a missing file, an unparseable document, or a value this reader does not recognize all resolve to `system`, since this read only paints a cosmetic background and the Host's own settings-file load is the actual fail-loud validation of this document). An explicit `light`/`dark` preference paints that color regardless of the OS theme and never subscribes to `nativeTheme`; only `system` (or an unresolved preference) falls back to `nativeTheme.shouldUseDarkColors` and updates on `nativeTheme`'s `updated` event. The browser still resolves the user's `ui-theme.preference` for the page itself; the native background only prevents a flash of the wrong color before Chromium paints the Web shell — painting it unconditionally from `nativeTheme` would introduce that exact flash for a `light`/`dark` preference that differs from the OS theme.

## Verification

ui-theme's unit tests cover activation without either optional Host service, the script position, Host-setting precedence, the OS preference, missing `matchMedia`, input without a body, live settings reads, and disposal of the Host registrations with the plugin fiber. A Chromium scenario for the real web composition selects the durable dark preference, holds the plugin bundle request open to keep the loading page observable, then asserts that the index response produces a dark background, the body attribute, and the root element's `color-scheme`. The change does not alter the accessibility tree, so it produces no new page golden. `apps/desktop/tests/window-theme.spec.ts` covers the Electron window's own resolution separately: the background for each explicit preference regardless of the OS theme, `system` following the OS theme, and every way `resolveWindowThemePreference`'s read of `settings.yaml` falls back to `system` (absent file, invalid YAML, missing section, unrecognized value, non-map document).

## Alternatives considered

**Hard-code the logic in `apps/web/index.html`.** This would run at the same point, but static HTML cannot embed the current Host setting and would duplicate the preference resolution and DOM fields owned by ui-theme. The Host transform follows the theme plugin's lifecycle and keeps the application shell unaware of the theme domain.

**Make the ui-theme client bundle synchronous or activate it earlier.** `immediately` controls only prefetching; plugin instantiation still occurs after the shell starts running. Blocking the initial render until ThemeRuntime activates would delay the visible loading and error screens and make the shell depend on the plugin tree it monitors to render failures.

**Rely only on CSS `prefers-color-scheme`.** Media queries cannot read an explicit persisted choice, so a user who selects dark while the operating system uses light would still see a flash.

**Run in `<head>` and add a temporary class to html.** The body does not exist yet, and this would require a set of temporary selectors separate from the final palette attributes. Immediately after `<body>` is the earliest parse position that can write the final DOM fields directly.

## Consequences

The loading page's first frame matches the durable built-in preference and defaults to the OS preference when no settings provider is composed. The Electron window background matches the durable `ui-theme.preference` before the document paints; it follows the native system theme, including while the OS theme changes, only when that preference is `system` or unresolved. A device report that switching the OS theme left the page's own colors unchanged is expected, not a defect, whenever the in-app Appearance setting names an explicit `light` or `dark` preference rather than `system` — that preference is exactly what both the page (`boot-theme.ts`) and the window background are honoring; setting Appearance to System is what makes both follow the OS theme. The index transform reads Host settings for every response, while the inline script contains only the selected built-in value and `system` resolution. Changes to the built-in preference semantics or ThemePresenter DOM fields must update both the script and ThemeRuntime. A custom theme still applies fully only after the browser plugins activate; during the loading interval, the page uses its private light or dark fallback palette.
