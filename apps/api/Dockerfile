FROM oven/bun:1.3.12 AS base
WORKDIR /app

FROM base AS development
COPY package.json bun.lock turbo.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages packages
COPY tooling tooling
RUN bun install
COPY . .
CMD ["bun", "run", "--filter", "@repo/api", "dev"]

FROM base AS production
COPY package.json bun.lock turbo.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages packages
COPY tooling tooling
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build:api
CMD ["bun", "run", "start:api"]
