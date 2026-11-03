// Plan morning-digest, § 1. The shape every part of § 2 builds against.

export type RunStatus = 'ok' | 'retry' | 'fail';

export type DigestRow = {
  job: string;
  // Owner on the job's newest line; null when that line has none (views show `—`).
  owner: string | null;
  // Number of good lines for this job in the night.
  runs: number;
  // How many of those lines have status `retry`.
  retries: number;
  // Status of the job's newest line.
  lastStatus: RunStatus;
  // `error` of the job's newest line that has one; null if no line had one.
  lastError: string | null;
  // Earliest and latest `at` for the job, exactly as written in the log (offset kept, never UTC).
  first: string;
  last: string;
};

export type Digest = {
  // The night asked for, `YYYY-MM-DD` (the file name without `.jsonl`).
  night: string;
  // One row per job, sorted by `job` in plain string order.
  rows: DigestRow[];
  // Non-blank lines that could not be read as a run (counted, never thrown).
  badLines: number;
  // Good lines per status over the whole night.
  counts: Record<RunStatus, number>;
};

// Reads `<runsDir>/<night>.jsonl`. null means the night has no file (or `night` is not `YYYY-MM-DD`).
export type ReadNight = (runsDir: string, night: string) => Digest | null;
