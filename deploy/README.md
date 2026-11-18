# Public live API

The production browser API base is `https://api.ithacapp.com/live`. Browsers
connect to this public domain over HTTPS; end users do not need Tailscale,
SSH, a VPN, or changes to their network security settings.

The existing nginx host `146.190.69.111` serves `api.ithacapp.com` and proxies
only `/live/` to the live backend. Other routes keep their existing behavior.
The proxy strips `/live/`, verifies the upstream HTTPS certificate and SNI,
and disables buffering for `/api/live/events` server-sent events.

`nginx/ithac-live-proxy.conf` records the locations installed in
`/etc/nginx/sites-available/ithac-web-api`. Back up the active site before
changing it, run `nginx -t`, and reload nginx only after validation succeeds.
Keep the upstream hostname internal to this proxy; do not reintroduce it
as a browser-facing API base.

GitHub Pages publishes the repository's `master` branch at `/`.
Development sources are on `main`; the live scraper files are in `native/`.
Publish the corresponding native changes to `master` and update the script
version in `index.html` whenever changing the deployed JavaScript.

After a deployment, verify the following from the affected network:

- `https://ithacapp.com` loads the script using the public API base.
- `https://api.ithacapp.com/live/health` responds 200.
- `/live/api/dashboard/snapshot?pageIndex=0&pageSize=1` responds 200 with data.
- A CORS preflight from `https://ithacapp.com` permits `cache-control,pragma`.
- `/live/api/live/events` streams events without nginx buffering.

The backend `/health` endpoint does not check database readiness. A healthy
HTTP listener alone is insufficient; validate the snapshot response too.

## Temporary fallback (2026-11-18)

`api.ithacapp.com` still resolves to the old nginx gateway, which no longer
answers. Until that record points at the VM, the published site tries
`https://api.ithacapp.com/live` first and falls back to the VM address. Once
`https://api.ithacapp.com/live/health` answers again, remove the fallback from
`resolveApiBaseCandidates()` in `app.js`.

The public site is read-only: it only sends GET requests. Operator actions
(Paper start/sync/stop, scrape retries) belong to the private cockpit.
Live events reload the scraper snapshot at most once every 3 seconds; the
rankings, Timex signals and Paper summary load after the snapshot and then
every 5 minutes.
