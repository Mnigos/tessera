# Git Service

Reserved for the Rust Git storage and gateway service.

The first implementation should own bare repository paths, Git HTTP, Git SSH, repository maintenance, and internal authorization calls back to the NestJS API.

## gRPC Storage

The internal gRPC storage service starts from the repository root with:

```bash
cargo run -p tessera-git
```

It also participates in the normal Turbo dev stack:

```bash
bun run dev
```

Configuration defaults are local-only:

- `GIT_SERVICE_HOST`: `::`
- `GIT_SERVICE_PORT`: `50051`
- `GIT_STORAGE_ROOT`: `data/git`
