export type ErrorClass =
  | 'user_visible'
  | 'internal'
  | 'timeout_absolute'
  | 'timeout_idle'
  | 'crash'
  | 'unknown';

const CRASH_STDERR_MARKERS = [
  /JavaScript heap out of memory/i,
  /Killed/i,
  /Segmentation fault/i,
];

export function classifyExit(
  code: number | null,
  signal: NodeJS.Signals | null,
  stderr: string,
): ErrorClass {
  for (const re of CRASH_STDERR_MARKERS) {
    if (re.test(stderr)) return 'crash';
  }
  if (signal === 'SIGKILL' || signal === 'SIGTERM' || signal === 'SIGABRT') return 'crash';
  if (code === 0) return 'unknown';
  if (code != null && code > 0) return 'internal';
  return 'unknown';
}

export function classifyTimeout(kind: 'absolute' | 'idle'): ErrorClass {
  return kind === 'absolute' ? 'timeout_absolute' : 'timeout_idle';
}
