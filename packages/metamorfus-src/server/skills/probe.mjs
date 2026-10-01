// Environment probe — the organism looks at its own runtime to
// decide what to install. This is the first step of every morph:
// before writing any code, know what you have.
//
// Returns a report like:
//   {
//     python:     { ok: true,  version: "Python 3.12.4" },
//     pip:        { ok: true,  version: "pip 24.0" },
//     git:        { ok: true,  version: "git version 2.42.0" },
//     nmap:       { ok: false },
//     scapy:      { ok: false },
//     requests:   { ok: true,  version: "2.31.0" },
//     ...
//   }
//
// The planner uses this to decide which pip packages to install.

import { spawn } from "node:child_process";

async function probe(cmd, args, label) {
  return new Promise((resolve) => {
    try {
      const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      p.stdout?.on("data", (c) => { out += c.toString(); });
      p.on("error", () => resolve({ ok: false, label }));
      p.on("close", (code) => {
        const firstLine = out.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
        resolve({ ok: code === 0, label, version: code === 0 ? firstLine : null });
      });
    } catch {
      resolve({ ok: false, label });
    }
  });
}

const PYTHON_BIN = process.env.PYTHON_BIN ?? "python3";

const CHECKS = {
  python:        [PYTHON_BIN, ["--version"]],
  pip:           [PYTHON_BIN, ["-m", "pip", "--version"]],
  git:           ["git", ["--version"]],
  node:          ["node", ["--version"]],
  nmap:          ["nmap", ["--version"]],
  tshark:        ["tshark", ["--version"]],
  docker:        ["docker", ["--version"]],
  // Python packages — try to import them. Probes the actual install,
  // not just whether the package exists on PyPI.
  scapy:         [PYTHON_BIN, ["-c", "import scapy; print(getattr(scapy, '__version__', 'ok'))"]],
  requests:      [PYTHON_BIN, ["-c", "import requests; print(requests.__version__)"]],
  beautifulsoup4:[PYTHON_BIN, ["-c", "import bs4; print(bs4.__version__)"]],
  arxiv:         [PYTHON_BIN, ["-c", "import arxiv; print('ok')"]],
  ccxt:          [PYTHON_BIN, ["-c", "import ccxt; print('ok')"]],
  shodan:        [PYTHON_BIN, ["-c", "import shodan; print('ok')"]],
  cryptography:  [PYTHON_BIN, ["-c", "import cryptography; print('ok')"]],
  pypdf:         [PYTHON_BIN, ["-c", "import pypdf; print(pypdf.__version__)"]],
  pyyaml:        [PYTHON_BIN, ["-c", "import yaml; print(yaml.__version__)"]],
  aiohttp:       [PYTHON_BIN, ["-c", "import aiohttp; print(aiohttp.__version__)"]],
  numpy:         [PYTHON_BIN, ["-c", "import numpy; print(numpy.__version__)"]],
  pandas:        [PYTHON_BIN, ["-c", "import pandas; print(pandas.__version__)"]],
};

export async function probeEnvironment() {
  const entries = await Promise.all(
    Object.entries(CHECKS).map(async ([name, [cmd, args]]) => {
      const r = await probe(cmd, args, name);
      return [name, r];
    }),
  );
  return Object.fromEntries(entries);
}

export { PYTHON_BIN };
