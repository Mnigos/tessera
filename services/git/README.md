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
- `GIT_API_GRPC_URL`: required API gRPC endpoint for smart HTTP authorization, for example `http://localhost:50053`
- `GIT_API_GRPC_AUTHORIZATION_TOKEN`: required bearer token for the API authorization service

## Smart HTTP

The HTTP server exposes Git smart HTTP clone/fetch and authenticated push routes:

- `GET /{username}/{repoSlug}.git/info/refs?service=git-upload-pack`
- `POST /{username}/{repoSlug}.git/git-upload-pack`
- `GET /{username}/{repoSlug}.git/info/refs?service=git-receive-pack`
- `POST /{username}/{repoSlug}.git/git-receive-pack`

Before serving a repository, the service calls `GitAuthorizationService` at
`GIT_API_GRPC_URL` for repository authorization and metadata, validates
the returned storage path, and then runs `git-http-backend` against the bare
repository under `GIT_STORAGE_ROOT`. Push routes require HTTP Basic auth and are
served only after `AuthorizeWrite` succeeds.
