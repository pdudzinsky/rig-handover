import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Digest } from '../src/digest/types.js';

const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: 'runs' };

const JOBS = ['digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs'];

const line = (o: Record<string, unknown>) => JSON.stringify(o);

const page = (app: ReturnType<typeof createApp>, night: string) => app.request(`/digest/${night}`);
const api = (app: ReturnType<typeof createApp>, night: string) => app.request(`/api/digest/${night}`);

describe('digest routes on the real night (read-only)', () => {
  const app = createApp(config);

  it('page: 200, lists the 5 jobs, reports the bad line', async () => {
    const res = await page(app, '2026-10-28');
    const html = await res.text();
    expect(res.status).toBe(200);
    for (const job of JOBS) expect(html).toContain(job);
    expect(html).toContain('1 line could not be read');
  });

  it('json: 200, badLines 1, the same 5 jobs in order', async () => {
    const res = await api(app, '2026-10-28');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const digest = (await res.json()) as Digest;
    expect(digest.badLines).toBe(1);
    expect(digest.rows.map((r) => r.job)).toEqual(JOBS);
  });

  it('page and json list the jobs in the same order', async () => {
    const html = await (await page(app, '2026-10-28')).text();
    const digest = (await (await api(app, '2026-10-28')).json()) as Digest;
    const jsonOrder = digest.rows.map((r) => r.job);
    const htmlOrder = jsonOrder
      .map((job) => ({ job, at: html.indexOf(job) }))
      .sort((a, b) => a.at - b.at)
      .map((x) => x.job);
    expect(html.indexOf(jsonOrder[0] ?? '')).toBeGreaterThanOrEqual(0);
    expect(htmlOrder).toEqual(jsonOrder);
  });
});

describe.each(['2026-01-01', 'not-a-night'])('no run log for %s', (night) => {
  const app = createApp(config);

  it('page: 404', async () => {
    const res = await page(app, night);
    expect(res.status).toBe(404);
  });

  it('json: 404 with an error string', async () => {
    const res = await api(app, night);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = (await res.json()) as { error?: unknown };
    expect(typeof body.error).toBe('string');
  });
});

describe('digest routes on temp runs dirs', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('empty night: page says nothing ran, json has no rows', async () => {
    writeFileSync(join(dir, '2026-11-01.jsonl'), '');
    const app = createApp({ ...config, runsDir: dir });
    const res = await page(app, '2026-11-01');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('nothing ran');
    const json = await api(app, '2026-11-01');
    expect(json.status).toBe(200);
    expect(((await json.json()) as Digest).rows).toEqual([]);
  });

  it('night with a bad line: still 200, rows present, bad line counted', async () => {
    const good1 = line({ at: '2026-11-02T01:00:00+01:00', job: 'a/one', status: 'ok', owner: 'rook' });
    const good2 = line({ at: '2026-11-02T02:00:00+01:00', job: 'b/two', status: 'ok', owner: 'rook' });
    const cut = line({ at: '2026-11-02T03:00:00+01:00', job: 'c/three', status: 'ok' }).slice(0, 30);
    writeFileSync(join(dir, '2026-11-02.jsonl'), [good1, good2, cut].join('\n') + '\n');
    const app = createApp({ ...config, runsDir: dir });
    const res = await page(app, '2026-11-02');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('a/one');
    expect(html).toContain('b/two');
    expect(html).toContain('1 line could not be read');
    const json = await api(app, '2026-11-02');
    expect(json.status).toBe(200);
    expect(((await json.json()) as Digest).badLines).toBe(1);
  });
});
