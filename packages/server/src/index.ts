/**
 * @metamorfus/server — Production headless server entry.
 *
 * Wraps the headless-server.mjs from the dashboard package, exposing a
 * clean ES module surface. The dashboard package owns the runtime
 * (Express + Socket.IO + all routes); this package provides:
 *
 *   • A typed re-export of the headless server factory
 *   • The server version constant
 *   • A configuration validator
 *
 * Why split: the dashboard package mixes UI + server (vite + express).
 * Server-only deployments (e.g. swarm gateways, headless bots) shouldn't
 * have to pull in the React stack.
 */

export const SERVER_VERSION = "0.3.0";
export const SERVER_NAME = "@metamorfus/server";

/**
 * Start the headless server with the given options. Imports the runtime
 * lazily so consumers that only need the version constant don't pay the
 * express / cors import cost.
 *
 * @param opts Optional configuration overrides
 *   - port: HTTP port (default from env or 8444)
 *   - workspaceRoot: where DNA libraries are kept
 *   - dnaDir: subdirectory under workspaceRoot
 *
 * @returns Promise<{ url, close }>
 */
export async function startServer(opts: {
  port?: number;
  workspaceRoot?: string;
  dnaDir?: string;
} = {}): Promise<{ url: string; close: () => Promise<void> }> {
  // Dynamic import to keep top-level load cost low.
  const mod = await import("../../metamorfus-src/server/headless-server.mjs");
  // The headless server exports a start() function. We intentionally
  // do not import it eagerly so consumers like CI tools or the test
  // runner can load the version constant without booting express.
  const url = `http://127.0.0.1:${opts.port ?? Number(process.env.PORT ?? 8444)}`;
  await mod.start?.({ ...opts, port: opts.port ?? Number(process.env.PORT ?? 8444) });
  return {
    url,
    close: async () => {
      await mod.close?.();
    },
  };
}

/**
 * Validate a server configuration object. Throws on invalid input.
 * Used by deployment tooling to catch typos before booting.
 */
export function validateConfig(cfg: {
  port?: number;
  workspaceRoot?: string;
  dnaDir?: string;
}): void {
  if (cfg.port !== undefined) {
    if (!Number.isInteger(cfg.port) || cfg.port < 1 || cfg.port > 65535) {
      throw new Error(`@metamorfus/server: invalid port ${cfg.port}`);
    }
  }
  if (cfg.workspaceRoot !== undefined && typeof cfg.workspaceRoot !== "string") {
    throw new Error("@metamorfus/server: workspaceRoot must be a string");
  }
  if (cfg.dnaDir !== undefined && typeof cfg.dnaDir !== "string") {
    throw new Error("@metamorfus/server: dnaDir must be a string");
  }
}
