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
  // A clean exit (code 0, no signal) is authoritative: stderr may contain
  // benign noise matching a crash marker (e.g. the word "killed" in a log
  // line), and misclassifying a successful run as crash makes the fallback
  // overwrite a reply that was already delivered.
  if (code === 0 && signal == null) return 'unknown';
  for (const re of CRASH_STDERR_MARKERS) {
    if (re.test(stderr)) return 'crash';
  }
  if (signal === 'SIGKILL' || signal === 'SIGTERM' || signal === 'SIGABRT') return 'crash';
  if (code != null && code > 0) return 'internal';
  return 'unknown';
}

export function classifyTimeout(kind: 'absolute' | 'idle'): ErrorClass {
  return kind === 'absolute' ? 'timeout_absolute' : 'timeout_idle';
}
