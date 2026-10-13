# `@awareness.market/cli`

Minimal command-line client for [Awareness Memory](https://awareness.market/).

## Install

```bash
npm i -g @awareness.market/cli
```

## Setup

```bash
export AWARENESS_API_KEY=aw_…
export AWARENESS_MEMORY_ID=<uuid>
export AWARENESS_HOST=https://api.awareness.market   # optional, default http://localhost:8000
```

## Commands

```bash
awareness doctor                             # health + credits balance
awareness balance                            # {wallet, burn, total}
awareness recall "<query>" --limit 5         # semantic + keyword
awareness record "<content>"                 # append-only
awareness agent list --locale zh-CN          # F-075 marketplace, any tier-1 locale
awareness pack list  --delivery reference    # F-076 packs
awareness pack install <slug>                # spends credits, installs into memory
```

## Design notes

- Pure `node:fetch` — no deps, single-file bin.
- 402 / 404 / 409 / 429 from the API are surfaced verbatim (no retry logic).
- Locale + runtime filters map 1:1 to `/market/*` query params (F-075/F-076/F-079).

MIT.
