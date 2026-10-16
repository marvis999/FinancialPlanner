# Static demo

A build of the app that runs entirely in the browser: plain HTML, JavaScript
and CSS, with no Node server, no SQLite and no network requests. It shows the
real dashboard with the generated demo household, so it can be embedded on a
website.

## How it works

This directory is a second Next.js project. It renders the components from the
repository root and exports them as static files.

- `demo/app/` holds the demo's layout and page. The page generates the
  household in the browser on load, so its dates always end today. Edits stay
  in memory until the page reloads.
- `demo/store.ts` is `lib/db.ts` over plain arrays. `tests/demo-store.test.ts`
  checks it against the SQLite version: same seed, same edits, same answers.
- `demo/actions.ts` stands in for `app/actions.ts`. `demo/tsconfig.json` maps
  `@/app/actions` to it, so the components need no changes.
- The root `app/`, `middleware.ts` and `lib/db.ts` are not part of this build.

## Build and run locally

```bash
npm run build:demo
```

The export lands in `demo/out`. Any static file server can serve it, for
example:

```bash
python3 -m http.server -d demo/out 8080
```

For development with hot reload, on port 3211:

```bash
npm run dev:demo
```

## Container

`demo/Dockerfile` builds the export and serves it with nginx (unprivileged,
one worker, a few MB of memory) on port 8080. Build it from the repository
root:

```bash
docker build -f demo/Dockerfile -t financialplanner-demo .
```

```bash
docker run --rm -p 127.0.0.1:8080:8080 financialplanner-demo
```

In Coolify, use the Dockerfile build pack with base directory `/`, Dockerfile
location `/demo/Dockerfile` and port 8080. TLS and HSTS are left to Coolify's
proxy.

### Headers

`demo/nginx.conf.template` sets these on every response:

- `Content-Security-Policy` with `frame-ancestors` set to the
  `FRAME_ANCESTORS` environment variable (default `https://marvin.ruhr`), so
  only that site can embed the demo. The policy also allows requests to the
  demo's own origin only.
- `X-Content-Type-Options: nosniff`
- `X-Robots-Tag: noindex, nofollow`, keeping the demo out of search engines
- `Referrer-Policy: no-referrer`
- `Permissions-Policy` turning off camera, microphone, geolocation, payment
  and USB.

To allow another embedding origin, for example a local copy of the website,
pass several origins separated by spaces:

```bash
docker run --rm -p 127.0.0.1:8080:8080 -e FRAME_ANCESTORS="https://marvin.ruhr http://localhost:3000" financialplanner-demo
```

## What the demo leaves out

These need a server or a third party. They stay visible and answer with "In
der Demo nicht verfügbar":

- CSV import
- Claude sign-in, the import review, category suggestions and the free
  analysis

The data-source switcher is not shown. The language switcher stores the choice
in `localStorage` and reloads, which also resets the demo's edits. If the
browser blocks storage, for example in some cross-site iframes, the demo stays
German.
