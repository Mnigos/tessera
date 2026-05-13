# Git Service

Reserved for the Rust Git storage and gateway service.

The service owns Git process execution and durable bare-repository storage on a
filesystem path. In local development this is a host directory; in production it
should be a mounted persistent volume.

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
- `GIT_HTTP_HOST`: `::`
- `GIT_HTTP_PORT`: `50052`
- `GIT_STORAGE_ROOT`: OS temp directory scoped to the process
- `GIT_STORAGE_GIT_BINARY`: `git`
- `GIT_API_AUTHORIZATION_URL`: required for smart HTTP authorization
- `GIT_API_AUTHORIZATION_TOKEN`: optional bearer token for the API authorization endpoint

## Smart HTTP

The HTTP server exposes Git smart HTTP clone/fetch routes:

- `GET /{username}/{repoSlug}.git/info/refs?service=git-upload-pack`
- `POST /{username}/{repoSlug}.git/git-upload-pack`

`git-receive-pack` push routes are rejected. Before serving a repository, the
service calls `GIT_API_AUTHORIZATION_URL` for repository authorization and
metadata, validates the returned storage path, and then runs `git-http-backend`
against the bare repository under `GIT_STORAGE_ROOT`.
