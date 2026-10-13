# @awareness.market/cli · Acceptance Criteria

Applies to: `pack publish`, `agent install`, `pack install`, `recall`, `record`, `balance`, `doctor`.

## Journey 1 · Author publishes a new memory pack via CLI
- **Given** an author with a valid API key and a manifest JSON on disk that references a brand-new slug
- **When** they run `awareness pack publish ./manifest.json`
- **Then** the CLI auto-creates a `draft` pack from `manifest.pack`, then publishes version `manifest.version`, and prints `{version_id, version, state:"published"}`
- **Assert**: `sdks/awareness-cli/tests/cli-journeys.test.mjs → pack publish creates draft + first version`
- **Backend verification**: `GET /api/v1/packs/{slug}` returns `state=published` with the version row visible

## Journey 2 · Author publishes a second version of an existing pack
- **Given** a slug that already has a published version
- **When** the CLI runs `pack publish` with a new `version` value and no `pack` block needed
- **Then** create-step is skipped; only `POST /packs/{slug}/versions` fires
- **Assert**: same test file → `pack publish skips create when pack already exists`

## Journey 3 · User installs an agent from marketplace
- **Given** a seeded marketplace agent slug
- **When** `awareness agent install <slug> --runtime claude-code` runs
- **Then** exit 0, install-ping counter increments by exactly 1, stdout shows emoji + name + new counter
- **Assert**: `agent install bumps install-ping and prints hint`

## Failure Modes (L3)

### F1 · Manifest file missing
- **If** `awareness pack publish /does/not/exist.json`
- **Then** exit code 1, stderr contains `cannot read manifest`, no HTTP calls to backend
- **Assert**: `publish fails cleanly on missing manifest`

### F2 · Manifest missing required fields
- **If** manifest has no `slug` / `version` / `contents`
- **Then** exit 1, stderr lists required fields
- **Assert**: `publish rejects incomplete manifest`

### F3 · Publish against an existing slug without pack block (not author)
- **If** slug exists but manifest omits `pack` block and current user is not the author
- **Then** backend 403 → CLI exits with clear `HTTP 403`
- **Assert**: covered by Journey 2 inverse

### F4 · Agent not found
- **If** `awareness agent install nonexistent-slug-xyz`
- **Then** exit 1, stderr `agent not found`
- **Assert**: `agent install handles 404 cleanly`

### F5 · Pack install without credits (402)
- **If** user burn+wallet < price
- **Then** backend 402 → CLI exits with stderr `HTTP 402 ... insufficient_credits`
- **Assert**: `pack install surfaces 402 on insufficient credits`

### F6 · Missing API key
- **If** `AWARENESS_API_KEY` unset and command requires auth
- **Then** exit 1, stderr `AWARENESS_API_KEY not set`, no HTTP call
- **Assert**: `record fails fast when API key missing`

## L1 Contract Guard
- Every `fetch(...)` path in `src/cli.mjs` must match a live backend route.
- **Assert**: `scripts/verify-cli-endpoints.mjs` passes when run against running backend.
