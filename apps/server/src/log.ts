// Plain line logging to stdout (Docker collects it).
export function log(area: string, msg: string): void {
  process.stdout.write(`${new Date().toISOString()} [${area}] ${msg}\n`);
}
