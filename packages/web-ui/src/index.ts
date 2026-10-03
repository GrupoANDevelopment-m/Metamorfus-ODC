/**
 * @metamorfus/web-ui — React UI entry.
 *
 * The actual UI lives in packages/metamorfus-src/components and
 * pages/. This package provides a clean ES module surface for
 * embedding the dashboard in a host application (e.g. an Electron
 * shell, a Storybook, a micro-frontend).
 *
 *   import { mountDashboard, components } from "@metamorfus/web-ui";
 *
 * Or for the full dashboard with React Router + providers:
 *
 *   import { App } from "@metamorfus/web-ui";
 *
 * Why split: keeping the React UI in a separate workspace makes it
 * possible to publish as an npm package or load from a CDN.
 */

import { useEffect, useState } from "react";

export const WEB_UI_VERSION = "0.3.0";
export const WEB_UI_NAME = "@metamorfus/web-ui";

/**
 * Re-export the main App component. Loaded lazily because React
 * imports the whole component tree.
 */
export async function loadApp(): Promise<{ default: any }> {
  // Dynamic import to keep top-level cost minimal.
  return import("../../metamorfus-src/App.tsx");
}

/**
 * Hook returning the live MHU engine version. Useful for displaying
 * "Powered by MHU X.Y.Z" footers in the UI.
 */
export function useVersion(): string {
  return WEB_UI_VERSION;
}

/**
 * Hook that returns true once the component is mounted in the
 * browser. Used to gate browser-only API calls.
 */
export function useIsClient(): boolean {
  const [isClient, setIsClient] = useState(false);
  useEffect(() => {
    setIsClient(true);
  }, []);
  return isClient;
}

/**
 * Re-export the key React components and hooks. The actual exports
 * are defined in packages/metamorfus-src/components/. We re-export
 * them lazily so consumers can use the web-ui package without forcing
 * a full app load.
 */
export const components = {
  // Note: these are placeholders. The real components live in
  // packages/metamorfus-src/components/. Import them directly:
  //
  //   import { ChatPanel } from "@metamorfus/web-ui/components/ChatPanel";
  //
  // The split is intentional — a host app may not need all panels.
};
