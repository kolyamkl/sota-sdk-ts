/** Shared helpers for CLI output: pretty tables, JSON mode, status tags.
 *  Parity contract with Python Plan 2's sota_sdk.cli_output. */

import chalk from 'chalk';

const STATUS_COLORS: Record<string, (s: string) => string> = {
  active: chalk.green,
  sandbox: chalk.yellow,
  testing_passed: chalk.cyan,
  pending_review: chalk.blue,
  suspended: chalk.red,
  deleted: chalk.gray,
  rejected: chalk.red,
  completed: chalk.green,
  failed: chalk.red,
  pending: chalk.yellow,
  won: chalk.green,
  lost: chalk.gray,
};

export function statusTag(status: string): string {
  const paint = STATUS_COLORS[status] ?? chalk.white;
  return process.stdout.isTTY ? paint(status) : status;
}

export function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

export function printTable(
  columns: string[],
  rows: Array<Array<string | number | null | undefined>>,
): void {
  const norm = rows.map((r) => r.map((c) => (c === null || c === undefined ? '—' : String(c))));
  if (!process.stdout.isTTY) {
    console.log(columns.join('\t'));
    for (const r of norm) console.log(r.join('\t'));
    return;
  }
  const widths = columns.map((c, i) =>
    Math.max(c.length, ...norm.map((r) => (r[i] ?? '').length)),
  );
  const pad = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - s.length));
  console.log(chalk.bold(columns.map((c, i) => pad(c, widths[i])).join('  ')));
  for (const r of norm) {
    console.log(r.map((c, i) => pad(c, widths[i])).join('  '));
  }
}

export interface EmitOptions<T> {
  jsonMode: boolean;
  data: T;
  render?: (data: T) => string;
}

export function emit<T>(opts: EmitOptions<T>): void {
  if (opts.jsonMode) {
    printJson(opts.data);
    return;
  }
  if (opts.render) {
    console.log(opts.render(opts.data));
  } else {
    console.log(String(opts.data));
  }
}
