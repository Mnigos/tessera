# Tessera

Open source Git collaboration platform scaffold.

## Stack

- Bun workspaces
- Turbo
- NestJS API with oRPC contracts and Scalar docs
- React + Vite web app
- Drizzle + Postgres schema package
- Better Auth with GitHub social login
- Redis/BullMQ queue foundation
- Rust Git service with filesystem-backed repository storage
- Shared domain primitives and UI package

## Getting Started

```bash
bun install
bun run typecheck
bun run dev
```

The API defaults to `http://localhost:4000`.
The web app defaults to `http://localhost:3000`.

API docs are available at `http://localhost:4000/docs` when the API is running.
