# syntax=docker/dockerfile:1
#
# OpenCode — LLM agent framework
#
# The upstream Dockerfile (packages/opencode/Dockerfile) copies a
# PREBUILT binary out of dist/, which does not exist in a source
# checkout. This file builds from source instead, so `docker compose up`
# works on a fresh clone.
#
# Bun is required — OpenCode is a Bun/TypeScript project (`bun run dev`
# is its dev entrypoint, `bun test` its test runner).

# ---------- Stage 1: build ----------
FROM oven/bun:1.2-alpine AS build

RUN apk add --no-cache libgcc libstdc++ ripgrep python3 build-base

WORKDIR /src

# Root workspace manifests first for layer caching
COPY package.json bun.lock* ./
COPY packages/opencode/package.json ./packages/opencode/

# Install dependencies for the opencode package workspace
RUN bun install --frozen-lockfile || bun install

# Source
COPY . .

# Build the CLI binary (script/build.ts produces dist/opencode-<os>-<arch>-*)
RUN bun run --cwd packages/opencode build


# ---------- Stage 2: runtime ----------
FROM oven/bun:1.2-alpine AS runtime

RUN apk add --no-cache libgcc libstdc++ ripgrep git python3 \
 && adduser -D -u 1000 opencode

COPY --from=build /src /src

WORKDIR /src

ENV NODE_ENV=production \
    OPENCODE_SERVER_HOST=0.0.0.0 \
    OPENCODE_SERVER_PORT=4096 \
    BUN_RUNTIME_TRANSPILER_CACHE_PATH=0

EXPOSE 4096

USER opencode

# `opencode serve` starts the HTTP server the ODC bridge talks to.
CMD ["bun", "run", "--cwd", "packages/opencode", "dev", "--", "serve", "--hostname", "0.0.0.0", "--port", "4096"]