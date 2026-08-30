# syntax=docker/dockerfile:1

# ---- Base image with build tooling for native modules (better-sqlite3) ----
FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# ---- Install dependencies (compiles better-sqlite3 for this OS/Node ABI) ----
# npm ci, not npm install: it installs exactly what package-lock.json pins, so
# the image is reproducible instead of picking up whatever satisfies the ranges
# on the day it is built.
FROM base AS deps
COPY package.json package-lock.json .npmrc ./
RUN npm ci

# ---- Build the Next.js app ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- Runtime image ----
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATA_DIR=/app/data
# "Today" is a local calendar day; without this the container runs in UTC and is
# a day behind between midnight and 02:00 German time.
ENV TZ=Europe/Berlin
ENV PORT=3210

# Claude Code CLI for the in-app Sonnet features (CSV-Import-Prüfung, Analyse):
# the app spawns `claude -p`. Auth comes from the host's ~/.claude and
# ~/.claude.json, mounted in by docker-compose — no API key in the image.
RUN npm install -g @anthropic-ai/claude-code

# node_modules already contains the compiled native module from the deps stage
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.mjs ./next.config.mjs

RUN mkdir -p /app/data && chown -R node:node /app
USER node

EXPOSE 3210
CMD ["npm", "start"]
