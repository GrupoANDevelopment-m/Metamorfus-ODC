// Ambient module declaration for the Pyodide CDN ESM import used by
// components/pyodide.worker.ts. The runtime fetches from the CDN at
// startup; the type stub keeps `tsc --noEmit` happy without altering the
// import path (browsers resolve the URL natively).
declare module "https://cdn.jsdelivr.net/pyodide/v0.25.0/full/pyodide.mjs" {
  export interface PyodideInterface {
    FS: {
      mkdir(path: string): void;
      writeFile(path: string, data: string | Uint8Array): void;
      readFile(path: string, options?: { encoding?: string }): string | Uint8Array;
      readdir(path: string): string[];
    };
    globals: { get(name: string): unknown };
    loadPackage(packages: string[]): Promise<void>;
    runPython(code: string): unknown;
    runPythonAsync(code: string): Promise<unknown>;
    setStdout(opts: { batched?: (text: string) => void }): void;
    setStderr(opts: { batched?: (text: string) => void }): void;
  }
  export interface PyodideConfig {
    indexURL: string;
    stdout?: (text: string) => void;
    stderr?: (text: string) => void;
  }
  export function loadPyodide(config: PyodideConfig): Promise<PyodideInterface>;
}
