#!/usr/bin/env bash
# Build the app, install the systemd --user unit and the Omarchy web app launcher.
# Safe to run again after every update: it rebuilds and restarts.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
UNIT_DIR="$HOME/.config/systemd/user"
PORT=3210

cd "$REPO"
npm ci
# The service serves from .next, which the build overwrites. It starts again below.
systemctl --user stop financial-planner 2>/dev/null || true
npm run build

mkdir -p "$UNIT_DIR"
sed "s|@REPO@|$REPO|g" systemd/financial-planner.service > "$UNIT_DIR/financial-planner.service"
systemctl --user daemon-reload
systemctl --user enable financial-planner
systemctl --user restart financial-planner

if command -v omarchy >/dev/null && [[ ! -f "$HOME/.local/share/applications/Financial Planner.desktop" ]]; then
  # The launcher wants a raster icon; the app only ships an SVG. The file name
  # becomes the icon's name in the theme, hence a fixed name in a temp folder.
  ICON_TMP="$(mktemp -d)"
  trap 'rm -rf "$ICON_TMP"' EXIT
  ICON="$ICON_TMP/financial-planner.png"
  rsvg-convert -w 256 -h 256 app/icon.svg -o "$ICON"
  omarchy webapp install "Financial Planner" "http://127.0.0.1:$PORT" "$ICON"
fi

systemctl --user --no-pager --lines=0 status financial-planner
echo "Financial Planner runs on http://127.0.0.1:$PORT"
