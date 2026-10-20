# syntax=docker/dockerfile:1
#
# Metamorfus ODC — cognitive organism runtime
#
# This image runs the Metamorfus headless server WITHOUT Vite or a
# browser. The Python skills are executed as subprocesses, so the
# image needs python3 available.
#
# Build (from repo root):
#   docker build -t metamorfus-odc -f Dockerfile .
#
# Run:
#   docker run --rm -p 3457:3457 \
#     -e NVIDIA_API_KEY=nvapi-... \
#     -e OPENCODE_URL=http://opencode:4096 \
#     metamorfus-odc

# ---------- Stage 1: deps ----------
FROM node:22-slim AS deps

# python3 is REQUIRED — the runner spawns `python3 invoker.py <skill>.py`
# for every skill execution. Without it every skill returns
# `ok:false, error: "python3 not found"`.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app/packages/metamorfus-src

# Copy manifests first so the dependency layer caches independently
# of source changes.
COPY packages/metamorfus-src/package.json packages/metamorfus-src/package-lock.json* ./
RUN npm install --omit=optional --no-audit --no-fund

# tsx is a devDependency but the headless server is run with it, so we
# need dev deps too. Simpler and more robust than compiling separately.
RUN npm install --no-audit --no-fund


# ---------- Stage 2: runtime ----------
FROM node:22-slim AS runtime

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# python3 must be on PATH as `python3` because runner.mjs spawns exactly that.
RUN python3 --version && node --version

WORKDIR /app

# The bridge and several modules resolve paths relative to the repo root
# (e.g. path.join(workspaceRoot, "packages", "metamorfus-src", "dna_library")).
# Keeping the monorepo layout intact is required — flattening breaks forge.
COPY --from=deps /app/packages/metamorfus-src/node_modules ./packages/metamorfus-src/node_modules
COPY packages/metamorfus-src ./packages/metamorfus-src

ENV NODE_ENV=production \
    METAMORFUS_PORT=3457 \
    OPENCODE_URL=http://opencode:4096 \
    OPENCODE_AGENT=cortex \
    PYTHONUNBUFFERED=1

EXPOSE 3457

# Health check hits the headless server's real health route
# (app.get("/api/health") in server/headless-server.mjs).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.METAMORFUS_PORT||3457)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

WORKDIR /app/packages/metamorfus-src

CMD ["npx", "tsx", "server/headless-server.mjs"]