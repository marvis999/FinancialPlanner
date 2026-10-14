# Financial Planner

A self-hosted personal finance planner. Import a bank statement, sort the
spending into categories, and see where the balance is heading. Recurring
items, one-off payments and budgets all booked on the day they are actually
due.

![The Now view: monthly figures above a balance chart that splits imported
history from the forecast](docs/screenshot.png)


## Stack

- **Next.js 15** (App Router) and **React 19**
- **TypeScript** and **Tailwind CSS**
- **shadcn/ui** on **Radix UI** primitives, with **lucide-react** icons
- **Recharts** for the balance chart
- **TanStack Table** for the bookings table
- **next-intl** for translations and locale-aware formatting
- **better-sqlite3** for storage
- **Vitest** for tests
- **Docker** for deployment
- **Claude Code CLI**, for the import review and analysis tab

> [!CAUTION]
> Using the Claude CLI feature with real data means you are exposing that data
> to a third party. Do not connect your subscription if you do not want this.

## Features

- Light/dark mode
- Multiple languages supported
- Balance forecast as a chart, with a warning and a day-by-day audit trail
  when the balance is heading below zero
- Optional Claude CLI support to review imported data and categorization
- Recurring items at monthly, quarterly, half-yearly or yearly intervals
- One-off items on a given date, for income as well as spending
- Loans with a remaining balance, a projected payoff date, and extra payments
  that pay them down
- CSV import of bank statements, de-duplicated so re-importing is safe
- Automatic spending categories from keyword matching, overridable by hand
- Monthly budgets per category, with a projection of where the current pace
  lands by the end of the period
- Budget periods that can run salary-to-salary rather than by calendar month
- Free-text tags on bookings, and search and filtering across the ledger
- Everything stored locally in SQLite; nothing leaves your device unless you
  turn on the optional Claude features

## Known limitations

- The forecast and budget maths are covered by an automated test suite, but
  have not been reconciled by hand against real bank statements
- The interface is built for desktop. It fits phone widths, but some rows are
  cramped there: budget names are cut off
- There is no hosted demo; it runs locally or in Docker
- Tested on Windows with Docker Desktop and on Linux. Not tested on macOS
- No support for multiple bank accounts
- Currently only supports one CSV format: the German Sparkassen "Umsatz"
  export (semicolon-separated, Windows-1252, with `Buchungstag` and `Betrag`
  columns)
- Only English and German languages are currently available
- Amounts are assumed to be in euros; there is no currency conversion
- Loan payoff dates are calculated without interest
- No authentication

## Quick start with Docker

```bash
docker compose up --build
```

Then open **http://localhost:3210**.

The port is published on `127.0.0.1` only. The app has no authentication, so
reaching it from another machine would mean handing your account history to
anyone on the network. To serve other machines anyway, drop the `127.0.0.1:`
prefix in `docker-compose.yml` and put a reverse proxy with a login in front.

The database is stored at `./data/financial-planner.db`.

Stop it with:

```bash
docker compose down
```

### Optional: the Claude features in Docker

The import review and the analysis tab shell out to the Claude Code CLI, which
needs the host's login. That is **not** part of the default compose file, so
`docker compose up` never wires your credentials into a container on its own.

To turn it on, copy `.env.example` to `.env` and point `CLAUDE_HOME` at the
directory holding your `.claude` folder and `.claude.json`:

```bash
CLAUDE_HOME=/home/you
```

Then start it with the overlay:

```bash
docker compose -f docker-compose.yml -f docker-compose.claude.yml up --build
```

This shares the host's Claude Code login with the container. Without it the app
runs normally and only those two features are unavailable.

The Analysis tab also has a sign-in button: it runs `claude auth login` on the
server, shows the sign-in link, and takes the code from that page. With the
overlay the sign-in lands in the mounted `.claude` folder and the host CLI
shares it; without the overlay it lives inside the container and is gone once
the container is recreated.

## Running as a desktop app on Linux

Instead of Docker, the app can run as a systemd user service with a launcher
in your app menu:

```bash
npm run app:install
```

This installs the dependencies, builds the app, installs and starts the
`financial-planner` user service on http://127.0.0.1:3210, and, where the
desktop offers web app launchers, adds a "Financial Planner" entry to the app
menu. Run it again after every update; it rebuilds and restarts. It uses the same `./data` folder as the dev server.

Stop the dev server and the Docker container first: all three use port 3210,
and the build overwrites the `.next` folder the dev server reads. The Claude
features use the `claude` CLI from your mise shims and its existing login.

```bash
systemctl --user status financial-planner     # is it running?
journalctl --user -u financial-planner -f     # logs
rm ~/.local/share/applications/"Financial Planner.desktop"   # remove the launcher
```

## Development

Needs Node.js 22 and build tools for native modules (better-sqlite3).

```bash
npm install
npm run dev        # dev server on 3210
npm test           # vitest, no watch
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
npm run build      # production build
```

### Demo data

The data-source switch in the bottom left toggles between two separate SQLite
files:

| Source    | File                       | Contents                      |
| --------- | -------------------------- | ----------------------------- |
| Real data | `financial-planner.db`      | Your imported bookings.       |
| Demo data | `financial-planner-demo.db` | A generated sample household. |

The demo is created the first time you switch to it: roughly 15 months of
invented bookings up to today, plus recurring items, planned one-off payments,
budgets and a loan with a remaining balance. Every name and amount in it is
made up.

Useful for demos and development.

## License

[MIT](LICENSE) © Marvin Lorenz

## Discord
https://discord.gg/MKsu8WYne