# UI Architecture

The desktop app owns its UI layer locally. Shared UI ideas are implemented as target-owned components and tokens so the project can remain independent.

The current desktop app is a local analysis tool, not a marketing site. Keep the interface compact, operational, and optimized for repeated editorial review.

## Current Pages

- Reports: session-only report table with status, band/date filters, selected report detail, Markdown/JSON/claims CSV export, shared report sections, claim review, proofreading, caveats, and optional raw JSON.
- Settings: local defaults and diagnostics, including language hints, genre defaults, local proofreading, optional localhost-only LanguageTool checks, raw metrics, and private-network blocking status.
- New analysis modal: text or URL input, optional genre and reference-source context, and a local run action.

## Contracts

- `apps/desktop/src/ui.tsx` is the desktop UI boundary.
- Screens should compose `AppShell`, `Button`, `Card`, `Badge`, form controls, `Field`, `StatCard`, `Alert`, `Cluster`, `Stack`, and `EmptyState`.
- Page components should not define new top-level shells, sidebars, headers, or one-off button/card systems.
- `AppShell` owns the fixed left navigation, top header, app identity slot, header actions, and single scrollable content region.
- Navigation entries should be typed page objects. Settings belongs last when it exists.
- Reports are session-only unless a future persistence feature is explicitly added and documented.

## Tokens

- Theme values live in `apps/desktop/src/styles.css` as semantic CSS variables.
- Components should use semantic tokens such as `--background`, `--foreground`, `--card`, `--muted`, `--border`, `--input`, `--primary`, `--accent`, `--destructive`, `--ring`, `--radius`, and `--shadow-soft`.
- Avoid page-specific hard-coded colors, decorative gradients, or layout chrome outside the shell.
- Prefer stable dimensions for tables, controls, stat cards, and bounded panels so report content does not shift the layout unexpectedly.

## Screen Composition

- Analysis input should live in the header-launched modal and use cards only for bounded work surfaces and repeated result items.
- Use compact, predictable controls for repeated work: segmented buttons for mode choices, selects for option sets, checkboxes for binary settings, and icon buttons for direct commands.
- Keep one main content scroll container. Inner panels may scroll only for bounded data blocks such as raw JSON.
- Keep visible copy practical. Explain analysis caveats in reports and docs, not as persistent instructional banners.

## Accessibility Expectations

- Buttons that perform actions should be real `<button>` elements through the shared `Button` component.
- Table rows that are clickable must remain keyboard reachable.
- Form controls must have labels through `Field` or explicit label markup.
- Do not add hover-only functionality without an equivalent keyboard path.

## Agent Notes

- Reuse existing UI primitives before adding new ones.
- If a desktop change introduces a new setting or report field, update `docs/USER_GUIDE.md` and `docs/AGENT_GUIDE.md` when relevant.
- Run `pnpm --filter @flavorpress/desktop build` for UI-only TypeScript/Vite changes. Run `pnpm desktop:build` when Tauri behavior or packaging is affected.
