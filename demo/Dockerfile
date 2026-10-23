# syntax=docker/dockerfile:1
#
# The static demo on its own: build with the repository root as context,
#   docker build -f demo/Dockerfile -t financialplanner-demo .
# and it serves demo/out on port 8080. See demo/README.md.

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
# The demo uses no native module: skipping install scripts skips compiling
# better-sqlite3, so the build needs no compiler toolchain.
RUN npm ci --ignore-scripts
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build:demo

FROM nginxinc/nginx-unprivileged:stable-alpine
# One worker is plenty for a handful of static files and keeps the footprint
# at a few MB; "auto" would start one per host core.
RUN sed -i 's/^worker_processes.*/worker_processes 1;/' /etc/nginx/nginx.conf
# The only origin allowed to frame the demo. Space-separated for several.
ENV FRAME_ANCESTORS="https://marvin.ruhr"
COPY demo/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/demo/out /usr/share/nginx/html
EXPOSE 8080
