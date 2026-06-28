// Shared helpers for node:test specs. ESM, no external deps.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function makeTmpDir(label: string): { path: string; cleanup: () => void } {
  const path = mkdtempSync(join(tmpdir(), `lark-test-${label}-`));
  return {
    path,
    cleanup: () => rmSync(path, { recursive: true, force: true }),
  };
}
