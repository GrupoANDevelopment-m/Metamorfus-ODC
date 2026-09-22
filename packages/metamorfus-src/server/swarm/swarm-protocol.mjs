// Swarm protocol helpers — line-delimited JSON over stdio.
// Kept in its own module so both swarm-manager.mjs and swarm-node.mjs
// share the same read/write semantics.

export function writeStdoutLine(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

/**
 * Async generator that yields each newline-terminated line from
 * process.stdin. Buffers partial lines internally.
 */
export async function* readStdinLines() {
  let buf = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line.length > 0) yield line;
    }
  }
  if (buf.trim().length > 0) yield buf.trim();
}
