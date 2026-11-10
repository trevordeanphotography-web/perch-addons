# Perch at a Glance — scaffold

Self-hosted household dashboard as a Home Assistant add-on. Phase 1 is
**feed-only**: Skipper + Amanda push structured items to `POST /api/feed`;
the server polls Open-Meteo for weather. No HA calls in Phase 1.

## Layout

```
perch-app/
  PHASE0-REPORT.md            Phase 0 verification + blocked-on-Trevor list
  FEED-SCHEMA.md              POST /api/feed contract (types, auth, idempotency)
  THEME.md                    Palette extraction + viewer→theme mapping
  README.md                   This file
  repository.yaml             Custom add-on repo manifest (URL is a placeholder)
  docs/
    phase2-reference/         Trevor's Phase 2 Smart Home reference images
  perch_at_a_glance/          The add-on (copy this folder into the repo)
    config.yaml               Add-on manifest (slug, version, arch, ingress, ports, options)
    Dockerfile                HA base image + Node 20 + better-sqlite3
    run.sh                    Entrypoint (reads /data/options.json via bashio)
    app/
      package.json
      server.js               Node server: /api/state, /api/feed, /api/quickadd,
                              /api/task-state, Open-Meteo polling, SQLite
      public/
        index.html            Perch panel + Smart Home stub + switcher bar
        style.css             Blush / Northdatum-dark / pine / daylight / dusk / midnight
        app.js                ES5 front-end: polling, panels, swipe, viewer toggle
```

## Install (Trevor, in Home Assistant)

1. Create the repo (e.g. `perch-addons` under
   `trevordeanphotography-web` on GitHub), put `perch_at_a_glance/` in it,
   update `repository.yaml` with the real URL.
2. HA → Settings → Add-ons → Add-on Store → ⋮ → Repositories → add the repo
   URL → install **Perch at a Glance**.
3. Configuration tab: set the fresh **Perch App** long-lived token (create it
   first in HA Profile → Security → Long-lived access tokens; delete the old
   Nov 8 chat-pasted token in the same screen) and the two feed bearer
   tokens (one per assistant; generate two random strings — they go into
   Skipper's and Amanda's secure stores, never into chat).
4. Start the add-on. Open it from the sidebar (ingress) or the exposed port.
5. Phase 1 needs no HA token to run — the token field can stay empty until
   Phase 2. The feed tokens are required for `POST /api/feed`.

## Tunnel (later, with the Cloudflared add-on)

Domain `northdatum.net` (Namecheap) → add it to Cloudflare, swap its
nameservers at Namecheap to Cloudflare's, install the official Cloudflared
add-on, and route a hostname (e.g. `perch.northdatum.net`) to the Perch
add-on at `http://perch_at_a_glance:8099` (add-on containers reach each other
by slug on the `hassio` Docker network). Put Cloudflare Access in front of
it (free, ≤50 users).

## Local smoke test (this VM — not against HA)

```bash
cd perch-app/perch_at_a_glance/app
npm install
PERCH_PORT=8099 PERCH_DATA_DIR=/tmp/perch-data \
  PERCH_FEED_TOKEN_SKIPPER=test-skipper-token \
  PERCH_FEED_TOKEN_AMANDA=test-amanda-token \
  PERCH_OPEN_METEO_ENABLED=0 \
  node server.js
# then, in another shell:
curl -s localhost:8099/health
curl -s localhost:8099/api/state | head -c 400
curl -s -X POST localhost:8099/api/feed \
  -H "Authorization: Bearer test-skipper-token" \
  -H "Content-Type: application/json" \
  -d '{"id":"smoke-1","type":"task","title":"Smoke test task","payload":{"title":"Smoke test task","list":"home","status":"proposed"}}'
curl -s localhost:8099/api/state | grep -o "Smoke test task" | head -1
```
