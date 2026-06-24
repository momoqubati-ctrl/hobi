# Welcome to Serene Panda (Dyad app)

Small single-repo project housing a web frontend (Vite/React), an optional Next.js `apps/web` app, and a NestJS `apps/api` service alongside a server folder used by Nitro when building a full-stack bundle.

Quick notes:

- This repository uses pnpm (see `pnpm-lock.yaml`) and TypeScript across the codebase.
- Environment secrets are present in the `env` file in the repo root; do NOT commit real secrets. Replace `env` with a `.env` file in deployment and add a sanitized `.env.example` for developers.

See `package.json` and `apps/*/package.json` for scripts and entry points.
