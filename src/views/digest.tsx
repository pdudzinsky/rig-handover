import type { Digest } from '../digest/types.js';

const dash = '—';

function marked(retries: number, lastStatus: string): boolean {
  return retries >= 3 || lastStatus === 'fail';
}

export function DigestPage({ digest }: { digest: Digest }) {
  return (
    <>
      <h1>{digest.night}</h1>
      {digest.rows.length === 0 ? (
        <p class="mute">nothing ran</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>job</th>
              <th>owner</th>
              <th>runs</th>
              <th>retries</th>
              <th>last status</th>
              <th>last error</th>
              <th>first</th>
              <th>last</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {digest.rows.map((r) => (
              <tr>
                <td>{r.job}</td>
                <td>{r.owner ?? dash}</td>
                <td>{r.runs}</td>
                <td>{r.retries}</td>
                <td>{r.lastStatus}</td>
                <td>{r.lastError ?? dash}</td>
                <td>{r.first}</td>
                <td>{r.last}</td>
                <td class="warn">{marked(r.retries, r.lastStatus) ? 'check' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {digest.badLines > 0 && (
        <p class="warn">
          {digest.badLines === 1 ? '1 line' : `${digest.badLines} lines`} could not be read
        </p>
      )}
    </>
  );
}

export function NoRunLog({ night }: { night: string }) {
  return (
    <>
      <h1>{night}</h1>
      <p class="warn">no run log for {night}</p>
    </>
  );
}
