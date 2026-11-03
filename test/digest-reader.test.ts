import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read-night.js';

const line = (o: Record<string, unknown>) => JSON.stringify(o);

describe('readNight on the real nights (read-only)', () => {
  it('2026-10-28: 5 jobs, 1 bad line', () => {
    const d = readNight('runs', '2026-10-28');
    expect(d).not.toBeNull();
    if (!d) return;
    expect(d.night).toBe('2026-10-28');
    expect(d.badLines).toBe(1);
    expect(d.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
    expect(d.counts).toEqual({ ok: 10, retry: 4, fail: 1 });

    const byJob = Object.fromEntries(d.rows.map((r) => [r.job, r]));
    expect(byJob['fixtures/refresh']).toEqual({
      job: 'fixtures/refresh',
      owner: 'rook',
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: 'upstream 503',
      first: '2026-10-29T01:30:00+01:00',
      last: '2026-10-29T01:37:00+01:00',
    });
    expect(byJob['digest/render']?.owner).toBeNull();
    expect(byJob['notes/backup']?.lastStatus).toBe('fail');
    expect(byJob['notes/backup']?.lastError).toBe('quota exceeded');
    expect(byJob['lane/sync']).toMatchObject({ runs: 8, retries: 1, lastStatus: 'ok', lastError: 'lock held' });
  });

  it('2026-10-27: 4 jobs, no bad lines', () => {
    const d = readNight('runs', '2026-10-27');
    expect(d?.badLines).toBe(0);
    expect(d?.counts).toEqual({ ok: 7, retry: 0, fail: 0 });
    expect(d?.rows.map((r) => [r.job, r.runs])).toEqual([
      ['fixtures/refresh', 1],
      ['lane/sync', 4],
      ['notes/backup', 1],
      ['rig/rotate-logs', 1],
    ]);
    expect(d?.rows.every((r) => r.lastError === null)).toBe(true);
  });
});

describe('readNight edge cases (temp dir)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const night = (text: string, name = '2026-11-01') => {
    writeFileSync(join(dir, `${name}.jsonl`), text);
    return readNight(dir, name);
  };

  it('returns null when the night has no file', () => {
    expect(readNight(dir, '2026-11-01')).toBeNull();
  });

  it('returns null for a night that is not YYYY-MM-DD, without reading', () => {
    writeFileSync(join(dir, 'x.jsonl'), line({ at: '2026-11-01T01:00:00+01:00', job: 'a', status: 'ok' }));
    for (const bad of ['../x', '2026-1-1', '', 'x', '2026-11-01/../x', '2026-11-01\n']) {
      expect(readNight(dir, bad)).toBeNull();
    }
  });

  it('an empty file is an empty night, not null', () => {
    expect(night('')).toEqual({ night: '2026-11-01', rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });
  });

  it('skips blank lines without counting them', () => {
    const d = night(`\n  \n${line({ at: '2026-11-01T01:00:00+01:00', job: 'a', status: 'ok' })}\n\n`);
    expect(d?.badLines).toBe(0);
    expect(d?.rows).toHaveLength(1);
  });

  it('keeps a row whose owner is null or missing', () => {
    const d = night(
      [
        line({ at: '2026-11-01T01:00:00+01:00', job: 'a', status: 'ok', owner: null }),
        line({ at: '2026-11-01T01:00:00+01:00', job: 'b', status: 'ok' }),
      ].join('\n'),
    );
    expect(d?.rows.map((r) => [r.job, r.owner])).toEqual([
      ['a', null],
      ['b', null],
    ]);
  });

  it('orders a job by time, not by file order, and keeps the offset as written', () => {
    const d = night(
      [
        line({ at: '2026-11-01T03:00:00+01:00', job: 'a', status: 'fail', owner: 'late', error: 'boom' }),
        line({ at: '2026-11-01T00:30:00Z', job: 'a', status: 'retry', owner: 'early', error: 'first' }),
        line({ at: '2026-11-01T02:00:00+01:00', job: 'a', status: 'ok', owner: 'middle' }),
      ].join('\n'),
    );
    expect(d?.rows[0]).toEqual({
      job: 'a',
      owner: 'late',
      runs: 3,
      retries: 1,
      lastStatus: 'fail',
      lastError: 'boom',
      first: '2026-11-01T00:30:00Z',
      last: '2026-11-01T03:00:00+01:00',
    });
  });

  it('compares instants across offsets but returns the original string', () => {
    // 00:30Z is 01:30+01:00, later than 01:00+01:00.
    const d = night(
      [
        line({ at: '2026-11-01T00:30:00Z', job: 'a', status: 'ok' }),
        line({ at: '2026-11-01T01:00:00+01:00', job: 'a', status: 'retry', error: 'x' }),
      ].join('\n'),
    );
    expect(d?.rows[0]).toMatchObject({
      first: '2026-11-01T01:00:00+01:00',
      last: '2026-11-01T00:30:00Z',
      lastStatus: 'ok',
      lastError: 'x',
    });
  });

  it('on equal instants the later line in the file is newer', () => {
    const at = '2026-11-01T01:00:00+01:00';
    const d = night(
      [line({ at, job: 'a', status: 'retry', owner: 'one' }), line({ at, job: 'a', status: 'ok', owner: 'two' })].join('\n'),
    );
    expect(d?.rows[0]).toMatchObject({ owner: 'two', lastStatus: 'ok' });
  });

  it('sorts rows by plain string order', () => {
    const at = '2026-11-01T01:00:00+01:00';
    const d = night(['b', 'a', 'B', 'a/z', 'A'].map((job) => line({ at, job, status: 'ok' })).join('\n'));
    expect(d?.rows.map((r) => r.job)).toEqual(['A', 'B', 'a', 'a/z', 'b']);
  });

  it('counts each kind of bad line and never throws', () => {
    const at = '2026-11-01T01:00:00+01:00';
    const bad = [
      '{"at":"2026-11-01T01:00:00+01:00","job":"cut', // not JSON
      '[1,2]', // not an object
      'null',
      '"ok"',
      line({ at, status: 'ok' }), // no job
      line({ at, job: 7, status: 'ok' }), // job not a string
      line({ job: 'a', status: 'ok' }), // no at
      line({ at: 'yesterday', job: 'a', status: 'ok' }), // at Date.parse rejects
      line({ at: 1761696000000, job: 'a', status: 'ok' }), // at not a string
      line({ at, job: 'a' }), // no status
      line({ at, job: 'a', status: 'skipped' }), // unknown status
      line({ at, job: 'a', status: 'ok', owner: 42 }), // owner not string/null
      line({ at, job: 'a', status: 'ok', error: null }), // error present, not a string
      line({ at, job: 'a', status: 'fail', error: { code: 1 } }),
    ];
    const good = line({ at, job: 'a', status: 'ok' });
    const d = night([...bad, good].join('\n'));
    expect(d?.badLines).toBe(bad.length);
    expect(d?.counts).toEqual({ ok: 1, retry: 0, fail: 0 });
    expect(d?.rows).toHaveLength(1);
  });

  it('a file with only bad lines gives no rows and zero counts', () => {
    expect(night('nope\n{"job":\n')).toEqual({
      night: '2026-11-01',
      rows: [],
      badLines: 2,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('does not swallow read errors other than a missing file', () => {
    // A directory named like the night file: reading it fails with EISDIR.
    mkdirSync(join(dir, '2026-11-01.jsonl'));
    expect(() => readNight(dir, '2026-11-01')).toThrow();
  });
});
