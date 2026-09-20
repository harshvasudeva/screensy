# Screensy — codebase analysis, security review, and improvement scope

**Repository:** self-hosted WebRTC screen sharing (`screensy`)  
**Fork:** `harshvasudeva/screensy` ← **upstream:** `screensy/screensy`  
**Sync checked:** 2026-09-20 — fork `main` and `development` match upstream (0 ahead / 0 behind).  
**Version reviewed in depth:** **1.9.0 on `main`** (that is also GitHub’s default clone). Unreleased work lives on `development` (see §0).  
**Review date:** 2026-09-20  
**Method:** full source and config review of `main`; `npm audit` on rendezvous lockfiles for `main`, `development`, and fork `deps-upgrade-latest`; `govulncheck` on website (generated `go.sum` for `main`). Opsera MCP scanners were not available (auth required).

**Overall risk for an internet-facing instance: high** on both `main` and `development`. Dependency/image work on `development` **does not** change room or TURN authorization.

This document is analysis and a backlog. It does not change application behavior.

---

## 0. Fork sync and upstream `development` (unreleased)

### Sync result

| Ref | Fork SHA | Upstream SHA | Result |
| --- | --- | --- | --- |
| `main` (default) | `b23e146` | `b23e146` | Already identical. Last upstream `main` merge: 2023-02-20 (release 1.9.0). |
| `development` | `f206edb` | `f206edb` | Already identical. Last commit 2024-11-18. |

No merge or push to `main`/`development` was required. The fork also has a **local-only** branch `deps-upgrade-latest` (`9b7d233`) that is **not** on upstream.

`main` is what `git clone` and this review originally used. **Nine commits on `development` have never been released to `main`.**

### What `development` adds vs 1.9.0 `main`

Commits (oldest first): Polish translation; dependency/Compose bump; Polish copy fix; drop Compose `version:` / default network mapping; changelog wording; **WORKDIR `/home/screensy`** so `http.FileServer(".")` no longer serves the container root (upstream issue [#53](https://github.com/screensy/screensy/issues/53)); changelog “UNRELEASED”.

| Area | `main` (1.9.0) | `development` (unreleased) | Effect on this review |
| --- | --- | --- | --- |
| `ws` | 7.4.6 | **8.18.0** | Closes the old header-DoS advisory; **still** `npm audit` high: GHSA-58qx-3vcg-4xpx (uninit memory, 8.0.0–8.20.1) and GHSA-96hv-2xvq-fx4p (fragment DoS). |
| `golang.org/x/text` | v0.3.6, no `go.sum` | **v0.17.0** + `go.sum` | **Fixes S-06** (Accept-Language DoS/OOB). |
| Node / Alpine (app images) | 14.16 / 3.13 | **22.6 / 3.19** | Large EOL burn-down (**S-07** partial). |
| Go build image | 1.15 | **1.22.6** (`go.mod` 1.21.13) | Stdlib much newer; still not current patch. |
| Caddy | 2.3.0-alpine | **2.8.4** | Closes several proxy-era issues (**S-07** partial). |
| Coturn | 4.5.2 | **4.6.2** | Newer, still far from 4.16. Host network **unchanged** (S-08). |
| File server | CWD `/` → whole image browsable (`//`) | `WORKDIR /home/screensy` | **Partial S-10:** no longer lists `/bin`/`/etc`. Still serves `screensy.ts`, `.js.map`, and the Go binary. Still **root**. |
| Compose | file version 3.3 | `no-new-privileges:true`, container names | Defense-in-depth; no resource limits still. |
| Product | 9 locales | + **Polish** | Feature only. |
| Signaling / rooms / TURN / client | same `server.ts`, `screensy.ts`, `Caddyfile`, `turnserver.conf` | **unchanged** | **S-01, S-02, S-03, S-04, S-09, S-11, S-12, S-13 still open.** |

### Fork branch `deps-upgrade-latest` (not upstream)

One extra commit on top of `development`: newer pins (`ws@8.21.1`, `x/text v0.40.0`, Go **1.26.5**, Node **24.18.1-alpine3.24**, Alpine **3.24.1**, Caddy **2.11.4**, Coturn **4.16.0**, TypeScript 7). `npm audit --omit=dev` on that lockfile: **0 vulnerabilities**. Same application source and same TURN/room model.

### Verdict on “does upstream fix it?”

Upstream `development` **fixes or reduces** S-06, much of S-07, and the worst part of S-10 (container-root listing). It **adds** a locale and Compose hardening. It **does not** fix guessable rooms, public TURN, unbounded signaling, or the `newRoom` race. Default **`main` still ships 1.9.0** — clone-from-GitHub users do not get the `development` security work until that branch is released.

---


## 1. What the product is

Screensy is a two-role screen share: the first client to join a room becomes the **broadcaster**; later clients become **viewers**. Media is meant to go peer-to-peer (WebRTC). The server is only for discovery and SDP/ICE signaling.

| Component | Path | Role |
| --- | --- | --- |
| Website | `screensy-website/` | Go static/i18n HTTP server + TypeScript client compiled to `screensy.js` |
| Rendezvous | `screensy-rendezvous/` | Node.js WebSocket signaling (`ws`) |
| Edge | `Caddyfile` + Compose `caddy:2.3.0-alpine` | TLS and reverse proxy; WebSocket upgrade to rendezvous |
| TURN/STUN | `turnserver.conf` + Compose `coturn/coturn:4.5.2` | NAT traversal / media relay (`network_mode: host`) |

There are **no tests, no CI config, no `go.sum`, and no linters beyond Prettier**. Docker is the supported production path.

---

## 2. Architecture and trust boundaries

```
Internet
  │  TCP 80/443          TCP/UDP 3478 + UDP 49152–65535
  ▼                      ▼
Caddy (TLS, optional Basic Auth — off by default)
  ├─ HTTP  → website:8080  (Go file server + Accept-Language i18n)
  └─ WS    → rendezvous:4000  (in-memory rooms Map)
Coturn on host network (static user screensy:screensy)
  ▼
Browsers: getDisplayMedia → RTCPeerConnection mesh (one encode/upload per viewer)
```

**Trust boundaries**

1. **Internet → Caddy.** Only application gate. Default `Caddyfile` has `basicauth` commented out.
2. **Internet → Coturn.** Not behind Caddy. Shared TURN password is compiled into client JS, so it is not a secret.
3. **Rendezvous → peers.** First `join` for a `roomId` is the broadcaster. The room name is the capability. Signaling forwards opaque SDP/ICE (`message: any`).
4. **Broadcaster browser → viewers.** Screen confidentiality is DTLS-SRTP **only if** untrusted viewers cannot join the room. There is no viewer admit/PIN.

Media is not stored on the server. Signaling still carries ICE candidates (IP addresses) and room membership.

---

## 3. Codebase map (what each file does)

### 3.1 Rendezvous (`screensy-rendezvous/server.ts`, ~445 lines)

- `ws.Server({ port: 4000 })` with no `maxPayload`, origin check, or `verifyClient`.
- First message must be `{ type: "join", roomId }`. `roomId` must be a non-empty string; **no max length, no charset, no entropy check**.
- `Server.rooms: Map<string, Room>`. New id → `newRoom` (broadcaster). Existing id → `addViewer`.
- Broadcaster messages: forward `webrtcbroadcaster` to a viewer id; `requestviewers` re-emits all viewer ids.
- Viewer messages: forward `webrtcviewer` to the broadcaster with that viewer’s id.
- JSON parse is try/caught (fixed in 1.3.1 after crash-on-invalid-JSON).
- `newRoom` **throws** if the id already exists. Two concurrent first-joins can both pass `rooms.has === false` and crash the handler.
- `handleViewerDisconnect` also throws if the id is missing.
- No max rooms, max viewers, rate limits, or backpressure.

`package.json` depends on `ws@^7.4.3` (lockfile **7.4.6**). Docker: `node:14.16-alpine3.13`, runs as `USER node`. `CMD ["npm", "start"]` relies on npm’s default `node server.js` (no `scripts.start`).

### 3.2 Client (`screensy-website/screensy.ts`, ~851 lines)

- If `location.hash` is empty, redirects to `#` + four TitleCase words from small lists (Jitsi-style generator).
- WebSocket URL is same origin (`location.host` + `pathname`).
- **Bug:** `window.location.protocol === "http"` is never true (`protocol` is `"http:"`). The client always uses `wss`, which breaks plain-HTTP setups that changelog 1.0.1 claimed to support.
- ICE servers: `stun:` / `turn:` + `location.hostname`, username/credential **`screensy` / `screensy`** (matches `turnserver.conf`).
- Broadcaster: `getDisplayMedia`, mesh of `RTCPeerConnection`s, 100 Mbps video / 960 kbps audio bitrate caps, 30 fps.
- Viewer: attach remote stream to `#stream`.
- Viewer counter uses `innerText` (not `innerHTML`) — good.
- Client `JSON.parse` on socket messages is **not** try/caught.
- Hash change forces a full reload.

### 3.3 Website Go server (`screensy-website/main.go`)

- `http.Server` on `:8080` with 5s read/write/idle timeouts (good bound).
- `/` and `/index.html`: pick a cached translation via `Accept-Language` and `golang.org/x/text/language`.
- All other paths: `http.FileServer(http.Dir("."))` — serves whatever is in the image working directory (`screensy.js`, `.js.map`, `.ts`, CSS, translations, **and the Go binary**).
- Process runs as **root** in `alpine:3.13`. No security headers.
- `go 1.15`, `golang.org/x/text v0.3.6`, **no `go.sum`**.
- `ioutil` is deprecated (cosmetic).

### 3.4 Docker / Caddy / Coturn

- Compose file version `3.3`; no healthchecks, resource limits, or image digests.
- Caddy **2.3.0** (2021). Repo `Caddyfile` uses `localhost` and `website:8080`. README Docker snippet still shows `reverse_proxy website:80` (wrong port).
- Coturn **4.5.2**, host network, `user=screensy:screensy`, `lt-cred-mech`, `no-tls` / `no-dtls`, `no-cli`. Relay port range is the documented 49152–65535 UDP.

### 3.5 Client UI

Nine translation HTML files (en, nl, de, fr, pt, ja, cs, he, zh-cmn-Hans-CN). Static markup + `screensy.js`. No CSP. No classic XSS sinks in TypeScript (`innerHTML` / `eval` / `document.write` not used).

---

## 4. Security review

Severity uses impact on a **public instance** (the documented Docker deploy). Private LAN use with Basic Auth and a firewalled TURN port is lower risk but still inherits guessable rooms and stale images.

### 4.1 Findings

| ID | Severity | Issue | Location |
| --- | --- | --- | --- |
| S-01 | **Critical** | Room name is the only authorization. Word-list IDs have on the order of **~2×10⁶** combinations (`37×48×40×33`), not cryptographic. Anyone who guesses or is sent the URL can **view the live screen with no admit step**. First joiner is always broadcaster (occupation / race). | `screensy.ts` `generateRoomName`; `server.ts` `onConnection` |
| S-02 | **Critical** | Static TURN password is public (JS + `turnserver.conf`). Coturn is on the host network with a large UDP relay range. This is a **world-reachable media relay** even if Caddy Basic Auth is enabled. | `screensy.ts` iceServers; `turnserver.conf`; `docker-compose.yaml` |
| S-03 | **High** | Unauthenticated, unbounded signaling: unlimited rooms, viewers, payload size, and connections. Mesh encode cost grows linearly with viewers. | `server.ts` |
| S-04 | **High** | Concurrent `join` on a new room can throw in `newRoom` (and disconnect path can throw). Uncaught exception can take down Node signaling. | `server.ts` ~128–152, ~324–329 |
| S-05 | **High** | `ws@7.4.6` — `npm audit`: GHSA-3h5v-q93c-6h6q (DoS via many HTTP headers), GHSA-96hv-2xvq-fx4p (memory exhaustion from fragments). Affects 7.0.0–7.5.10. | `package-lock.json` |
| S-06 | **High** | `golang.org/x/text@v0.3.6` is **reachable** on every `/` request: GO-2022-1059 (Accept-Language CPU DoS, fixed 0.3.8), GO-2021-0113 (OOB read, fixed 0.3.7). | `main.go` `ParseAcceptLanguage` |
| S-07 | **High** | EOL runtimes in Docker: Node **14.16**, Go **1.15**, Alpine **3.13**, Caddy **2.3.0**. Production website binary is linked against Go 1.15 `net/http` (HTTP/2 Rapid Reset class and later stdlib fixes never applied). Caddy terminates TLS, which reduces but does not erase the issue. | Dockerfiles, `go.mod`, compose |
| S-08 | **Medium** | Coturn `network_mode: host` — Coturn compromise is host-equivalent. | `docker-compose.yaml` |
| S-09 | **Medium** | Optional Basic Auth is off; when on, it does not cover TURN. | `Caddyfile`, README |
| S-10 | **Medium** | Open `FileServer` + source maps and TypeScript in the image; Go process as root. | `main.go`, website Dockerfile |
| S-11 | **Medium** | No CSP, HSTS, `X-Content-Type-Options`, `frame-ancestors`, or Permissions-Policy. | HTML, Caddy |
| S-12 | **Medium** | Signaling does not bind/validate SDP; `message` is `any`. Malicious room member can feed junk ICE/SDP into `RTCPeerConnection`. | `server.ts`, client handlers |
| S-13 | **Low** | Client uncaught `JSON.parse`; `location.protocol === "http"` bug. | `screensy.ts` |
| S-14 | **Low** | TURN `no-tls`/`no-dtls` exposes allocation control-plane on the wire (media still DTLS-SRTP if WebRTC is used). Comment in `turnserver.conf` understates this. | `turnserver.conf` |

### 4.2 Positive controls

- Signaling is not in the media path; timeouts on the Go server; invalid JSON on the server is discarded; viewer counter uses `innerText`; Coturn CLI disabled; `lt-cred-mech` (better than anonymous TURN, but the password is public); rendezvous container drops to `USER node`; HTTPS is assumed for WebRTC in browsers.

### 4.3 Sensitive-path notes (auth / crypto / input)

| Path | Status |
| --- | --- |
| Auth | Optional HTTP Basic Auth at Caddy only. No session, no room token, no viewer admit. |
| Crypto | Browser WebRTC DTLS-SRTP. TURN long-term creds are static and public. No server-side crypto. |
| Input | JSON signaling lightly typed (`kind` enum). `roomId` and SDP blobs are not size-limited. `Accept-Language` is a known DoS parser. File server has no allowlist. |
| SQL | None. |
| Secrets in git | Intentional public TURN user/password. No other credentials found. |

### 4.4 Compliance snapshot

There is no user database or payment flow. If operators share work screens, the stream can still contain credentials, PHI, or card data. There is **no access log, audit trail, retention policy, or MFA**. SOC2/HIPAA/PCI are not met for a regulated workload. Do not treat this as a compliance-ready product until S-01/S-02 and logging exist.

### 4.5 Tooling caveat

- `npm audit` (2026-09-20): 1 high (`ws`), two advisories as above.
- `govulncheck` on current toolchain reported **30** findings including stdlib traces from Go 1.22 in the *scan environment*. Docker **builds with Go 1.15**, which is worse. The two `x/text` findings are confirmed in application code.
- Image CVE inventories (Trivy/Grype) were not run; 2021 Alpine/Node/Caddy/Coturn tags will add a large OS CVE list.

---

## 5. Quality and operability (non-security)

- **No automated tests** for signaling roles, races, or client WebRTC setup.
- **README vs repo drift:** Docker Caddy example uses `website:80`; service listens on **8080**. `Caddyfile` is `localhost` while README uses `example.com`.
- **Scalability:** mesh (not SFU). One broadcaster × N viewers = N outbound encodings. Fine for a handful of viewers, not a classroom.
- **Observability:** `console.log` / `log.Printf` only. No metrics for rooms, disconnects, or TURN bytes.
- **i18n:** translations duplicated as full HTML documents; adding a popup requires nine file edits.
- **TypeScript:** `@ts-ignore` on `getDisplayMedia`, `maxFramerate`, audio constraints; `lib: ["DOM"]` on the **server** tsconfig is unnecessary.
- **Supply chain:** lockfile v1; no `go.sum`; images not pinned by digest; `npm install --only=development` is deprecated syntax.

---

## 6. Improvement scope

Prioritized by risk. No calendar estimates — each item is scoped by **where to change** and **how invasive** it is.

### P0 — stop silent joins and open relay (product security)

These are the only items that change the threat model for a public host.

1. **Room capability, not a guessable name**  
   Replace or supplement word names with a high-entropy secret in the URL (128-bit). Optionally keep a short display name.  
   *Touch:* `generateRoomName`, join payload, `server.ts` room map key. Low code volume, **behavior change** for existing URLs.

2. **Viewer authorization**  
   Broadcaster admit (prompt) and/or a viewer PIN. First-joiner-as-presenter should require a creation token so a racer cannot steal the slot.  
   *Touch:* signaling protocol (new message types), client UI, `Room` class. Moderate protocol change.

3. **TURN: time-limited credentials**  
   Coturn REST/HMAC (or equivalent) minted by the server per session. Remove `screensy:screensy` from the client. Restrict `denied-peer-ip` (loopback, RFC1918, link-local, metadata). Rate-limit allocations.  
   *Touch:* new small credential API or embed in signaling; `turnserver.conf`; client `rtcConfig`. Moderate; **ops-sensitive**.

4. **Document the auth gap**  
   README must state that Caddy Basic Auth does not protect TURN, and that room URLs are bearer tokens. Enable a commented, copy-paste-safe private-instance recipe (auth + firewall TURN to known clients, or REST creds).  
   *Touch:* README, `Caddyfile` comments. Small.

### P1 — crash-safety and abuse resistance (signaling)

5. Make `newRoom` / disconnect **idempotent**; never throw across the WebSocket event loop.  
6. Caps: `maxPayload` (e.g. 64–256 KiB), max rooms, max viewers/room, joins per IP, optional origin allowlist.  
7. Validate SDP/`kind` before forward; drop extra keys.  
8. Docker memory/CPU limits; healthchecks; consider not using host network for Coturn if UDP publish is enough.  
   *Touch:* `server.ts`, compose. Localized.

### P2 — dependency and image burn-down (CVE)

On **`development`**, items 10 and much of 11 are already done (see §0). Remaining on that branch: bump `ws` past 8.20.1 (8.21+ closes the remaining audit findings), pin image **digests**, Coturn 4.15+, website non-root and an allowlist so `.ts`/maps/binary are not served, CI scanners. **Merging `development` → `main`** is the first mechanical step so default clone is not stuck on 1.9.0.

9. `ws` → **≥ 8.21** (or current 8.x) so GHSA-58qx-3vcg-4xpx and GHSA-96hv-2xvq-fx4p are closed; keep lockfile in sync. (`main` is still 7.4.6.)  
10. `golang.org/x/text` → **≥ 0.3.8**; add **`go.sum`**. (Done on `development` at v0.17.0.)  
11. Rebuild: supported **Go**, **Node 20+**, current Alpine, **Caddy 2.8+**, **coturn 4.15+**. Pin images by digest. (`development` has Go 1.22.6 / Node 22.6 / Caddy 2.8.4 / Coturn 4.6.2.)  
12. Website: non-root `USER`; do not copy `.ts` / `.js.map` / the binary into the web root; allowlist files. (`development` only changed `WORKDIR`.)  
13. CI: `npm audit`, `govulncheck`, image scan (Trivy/Grype).  
    *Touch:* Dockerfiles, `go.mod`, `package.json`, new CI. Mechanical but needs smoke-test of WebRTC. Fork branch `deps-upgrade-latest` already experiments with current pins (`ws` 8.21.1, zero `npm audit` findings).

### P3 — browser, proxy, product hygiene

14. Caddy headers: CSP `default-src 'self'`, `frame-ancestors 'none'`, `nosniff`, HSTS, Permissions-Policy for `display-capture`.  
15. Fix `location.protocol === "http:"`; try/catch client JSON parse.  
16. Align README Caddy `website:8080` with Compose.  
17. Add `scripts.start` explicitly; structured logs (rooms created/closed, join failures).  
18. Tests: signaling unit tests (first joiner, second is viewer, disconnect notify, invalid JSON, concurrent join).  
19. Longer term: optional SFU if multi-viewer quality matters; OIDC instead of shared Basic Auth for private instances.

### Suggested sequence

Do **P0** before advertising a public URL. **P1** prevents easy outages. **P2** is the cheapest CVE reduction but **does not fix S-01/S-02**. **P3** is defense in depth.

---

## 7. Component inventory (for maintainers)

```
screensy-rendezvous/server.ts      signaling
screensy-rendezvous/package.json   ws 7.4.6
screensy-website/screensy.ts       browser client
screensy-website/main.go           static + i18n
screensy-website/translations/     9 HTML locales on main; 10 on development (pl)
screensy-website/styles.css
Caddyfile, docker-compose.yaml, turnserver.conf
Dockerfiles (main: Node 14.16, Go 1.15, Alpine 3.13)
```

No other application languages or data stores.
