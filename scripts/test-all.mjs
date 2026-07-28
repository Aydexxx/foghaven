#!/usr/bin/env node
/**
 * Runs every workspace's test suite and reports ONE combined total.
 *
 * This is the script `npm test` runs, and it is the only test command anyone
 * should run at the repo root. Running `vitest` from inside a single workspace
 * silently checks only that workspace — which has twice let a commit be
 * "verified" against a tiny fraction of the real suite. This runner always
 * covers all of shared + server + client, keeps going after a workspace fails
 * (so one red suite never hides another), and sums the counts so the total is
 * impossible to misread.
 *
 * Usage:  npm test        (from the repo root)
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

// Order matters only for readability; each runs independently. Sequential (not
// parallel) so server tests that touch ports/fixtures never race each other.
const WORKSPACES = ['shared', 'server', 'client'];

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function hasTestScript(ws) {
  const pkgPath = path.join(REPO_ROOT, ws, 'package.json');
  if (!existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return Boolean(pkg.scripts && pkg.scripts.test);
  } catch {
    return false;
  }
}

function runWorkspace(ws) {
  const outFile = path.join(os.tmpdir(), `foghaven-test-${ws}-${process.pid}.json`);
  if (existsSync(outFile)) rmSync(outFile);

  console.log(`\n${'='.repeat(60)}\n  ${ws}\n${'='.repeat(60)}`);

  // `npm test -w <ws> -- <args>` appends the args to the workspace's own
  // `vitest run`, so we get its normal console output live (inherited stdio)
  // plus a machine-readable JSON file to sum from.
  const result = spawnSync(
    npmCmd,
    ['test', '-w', ws, '--', '--reporter=default', '--reporter=json', `--outputFile=${outFile}`],
    { cwd: REPO_ROOT, stdio: 'inherit', shell: process.platform === 'win32' },
  );

  let counts = { total: 0, passed: 0, failed: 0, pending: 0, todo: 0, parsed: false };
  if (existsSync(outFile)) {
    try {
      const json = JSON.parse(readFileSync(outFile, 'utf-8'));
      counts = {
        total: json.numTotalTests ?? 0,
        passed: json.numPassedTests ?? 0,
        failed: json.numFailedTests ?? 0,
        pending: json.numPendingTests ?? 0,
        todo: json.numTodoTests ?? 0,
        parsed: true,
      };
    } catch {
      /* fall through to the exit-code check below */
    } finally {
      rmSync(outFile, { force: true });
    }
  }

  // A workspace fails if vitest exited non-zero OR reported failures OR we
  // could not read its report at all (never silently treat unknown as pass).
  const exitCode = result.status ?? 1;
  const ok = exitCode === 0 && counts.failed === 0 && counts.parsed;
  return { ws, ...counts, exitCode, ok };
}

const workspaces = WORKSPACES.filter(hasTestScript);
const skipped = WORKSPACES.filter((ws) => !hasTestScript(ws));

const results = workspaces.map(runWorkspace);

// ---------------------------------------------------------------------------
// Combined summary
// ---------------------------------------------------------------------------

const sum = (key) => results.reduce((acc, r) => acc + r[key], 0);
const totalTests = sum('total');
const totalPassed = sum('passed');
const totalFailed = sum('failed');
const totalPending = sum('pending');
const totalTodo = sum('todo');
const anyFailed = results.some((r) => !r.ok);

console.log(`\n${'='.repeat(60)}\n  COMBINED TOTAL\n${'='.repeat(60)}`);
for (const r of results) {
  const status = r.ok ? 'ok  ' : 'FAIL';
  const detail = r.parsed
    ? `${r.passed}/${r.total} passed${r.failed ? `, ${r.failed} failed` : ''}${r.pending ? `, ${r.pending} skipped` : ''}`
    : `could not read report (exit ${r.exitCode})`;
  console.log(`  [${status}] ${r.ws.padEnd(8)} ${detail}`);
}
for (const ws of skipped) {
  console.log(`  [skip] ${ws.padEnd(8)} no test script`);
}

console.log(`${'-'.repeat(60)}`);
console.log(
  `  ${totalPassed}/${totalTests} tests passed` +
    (totalFailed ? `, ${totalFailed} FAILED` : '') +
    (totalPending ? `, ${totalPending} skipped` : '') +
    (totalTodo ? `, ${totalTodo} todo` : '') +
    ` across ${results.length} workspace(s)`,
);
console.log('');

process.exit(anyFailed ? 1 : 0);
