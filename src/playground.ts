/**
 * The playground page, inlined as a module rather than served from disk.
 *
 * Serverless bundlers only ship files they can see imported. A `public/`
 * directory read at runtime is exactly the thing that works locally and 404s in
 * production, so the page lives in the module graph where the bundler cannot
 * miss it.
 */
export const PLAYGROUND_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>LinkedIn Profile API</title>
<style>
  :root {
    --bg: #fbfbfa; --panel: #ffffff; --ink: #1a1a18; --muted: #6b6b66;
    --line: #e4e4e0; --accent: #0a66c2; --ok: #1a7f47; --warn: #9a6700;
    --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #16161a; --panel: #1d1d22; --ink: #ececee; --muted: #9a9aa2;
      --line: #2c2c33; --accent: #5aa9f0; --ok: #4ec27f; --warn: #d8a838;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--ink);
    font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .wrap { max-width: 940px; margin: 0 auto; padding: 40px 24px 80px; }
  header { border-bottom: 1px solid var(--line); padding-bottom: 24px; margin-bottom: 28px; }
  h1 { font-size: 26px; margin: 0 0 6px; letter-spacing: -0.02em; }
  .sub { color: var(--muted); margin: 0; }
  .card {
    background: var(--panel); border: 1px solid var(--line);
    border-radius: 10px; padding: 20px; margin-bottom: 20px;
  }
  label { display: block; font-size: 12px; font-weight: 600; letter-spacing: .04em;
          text-transform: uppercase; color: var(--muted); margin-bottom: 6px; }
  input[type=text], input[type=password] {
    width: 100%; padding: 10px 12px; border: 1px solid var(--line); border-radius: 7px;
    background: var(--bg); color: var(--ink); font: 14px var(--mono);
  }
  input:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
  .row { display: flex; gap: 14px; flex-wrap: wrap; align-items: center; margin-top: 14px; }
  .check { display: flex; align-items: center; gap: 7px; font-size: 14px; color: var(--ink); }
  .check input { accent-color: var(--accent); }
  button {
    background: var(--accent); color: #fff; border: 0; border-radius: 7px;
    padding: 10px 20px; font-size: 14px; font-weight: 600; cursor: pointer;
  }
  button:disabled { opacity: .55; cursor: progress; }
  pre {
    background: var(--bg); border: 1px solid var(--line); border-radius: 8px;
    padding: 16px; overflow-x: auto; font: 12.5px/1.5 var(--mono); margin: 0;
    max-height: 560px;
  }
  .meta { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
  .chip {
    font: 11px var(--mono); padding: 4px 9px; border-radius: 20px;
    border: 1px solid var(--line); color: var(--muted);
  }
  .chip.ok { color: var(--ok); border-color: currentColor; }
  .chip.warn { color: var(--warn); border-color: currentColor; }
  h2 { font-size: 14px; text-transform: uppercase; letter-spacing: .05em;
       color: var(--muted); margin: 0 0 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--line);
           vertical-align: top; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
  td code { font: 12px var(--mono); color: var(--accent); }
  .note { font-size: 13.5px; color: var(--muted); }
  .note a { color: var(--accent); }
  footer { margin-top: 36px; padding-top: 20px; border-top: 1px solid var(--line);
           font-size: 13px; color: var(--muted); }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>LinkedIn Profile API</h1>
    <p class="sub">A LinkedIn profile URL in, structured JSON out.</p>
  </header>

  <div class="card">
    <label for="url">Profile URL</label>
    <input id="url" type="text" value="https://www.linkedin.com/in/williamhgates/"
           placeholder="https://www.linkedin.com/in/…" />
    <div class="row">
      <label class="check"><input type="checkbox" id="deep" /> deep — full section lists</label>
      <label class="check"><input type="checkbox" id="contact" /> include contact info</label>
      <label class="check"><input type="checkbox" id="activity" /> include activity</label>
      <label class="check"><input type="checkbox" id="refresh" /> bypass cache</label>
    </div>
    <div class="row">
      <input id="key" type="password" placeholder="x-api-key (only if the deployment sets API_KEYS)" />
    </div>
    <div class="row">
      <button id="go">Resolve</button>
      <span class="note" id="timing"></span>
    </div>
  </div>

  <div class="card" id="out-card" hidden>
    <div class="meta" id="meta"></div>
    <pre id="out"></pre>
  </div>

  <div class="card">
    <h2>How it works</h2>
    <p class="note">
      Extraction runs as a chain. Each tier is tried in trust order and its output merged, so a
      tier that breaks costs coverage rather than the whole response. Every field is attributed
      back to the tier that produced it in <code>meta.field_provenance</code>.
    </p>
    <table>
      <tr><th>Tier</th><th>Surface</th><th>Why it sits here</th></tr>
      <tr>
        <td><code>rest</code></td>
        <td>Voyager dash collection<br /><code>/identity/dash/profiles</code></td>
        <td>One call, ~68&nbsp;KB, clean normalised JSON. The least fashionable target and by
            some distance the best one.</td>
      </tr>
      <tr>
        <td><code>embedded</code></td>
        <td>JSON inside the profile HTML<br />plus <code>/details/*</code> pages</td>
        <td>Needs no query hash, so it cannot rot the way GraphQL does — but the flagship app
            has moved to RSC/SDUI and no longer reliably pre-fetches it.</td>
      </tr>
      <tr>
        <td><code>graphql</code></td>
        <td><code>/voyager/api/graphql</code></td>
        <td>Fast and compact, but 500s unless <code>queryId</code> is the exact current build
            hash. Self-heals: the tier above harvests fresh hashes from pages it fetched.</td>
      </tr>
    </table>
  </div>

  <div class="card">
    <h2>What it can't do</h2>
    <p class="note">
      The parser is not the limit — visibility is. Profiles outside the session's network come
      back as the <code>LinkedIn Member</code> placeholder with no name or positions, and no
      amount of parsing recovers what LinkedIn declined to send. Volume is capped separately by
      the commercial use limit: a fixed number of distinct profile views per account per month,
      after which everything returns a paywall until it resets. Both are reported as typed
      errors rather than disguised as empty results.
    </p>
  </div>

  <div class="card">
    <h2>Research notes</h2>
    <p class="note">
      Endpoint behaviour was verified against a live authenticated session on 2026-08-26.
      <code>profileView</code>, the single-call endpoint most write-ups still recommend, now
      returns <strong>410 Gone</strong>. Contact hydration was traced to
      <code>profileContactInfo</code> — the endpoint behind the profile page's "Contact info"
      overlay, and the LinkedIn-native piece of what enrichment vendors like RocketReach sell.
      It only yields an email for 1st-degree connections who chose to share one, which is why
      those vendors infer addresses from the employer domain and verify over SMTP rather than
      reading them here.
    </p>
    <p class="note">
      <a href="https://interfaze.ai" target="_blank" rel="noreferrer noopener">Interfaze</a>
      (YC&nbsp;P26) turned up while researching this — an AI model aimed at deterministic
      developer tasks like OCR, scraping and classification, with enforced JSON-schema output.
      It is wired in here as an optional last-resort tier only: if LinkedIn reshapes a payload
      and the hand-written mappers come up empty, the raw envelope is handed to a model to fill
      the canonical schema, and the result is validated before it is served. Deterministic
      parsing stays the default — a model is a reasonable backstop for schema drift, and the
      wrong tool for reading JSON that is already structured.
    </p>
  </div>

  <footer>
    Built for a hiring challenge. Uses an authenticated session against LinkedIn's internal
    endpoints, which is contrary to LinkedIn's User Agreement §8.2 — see the README for the
    full limitations and legal notes.
  </footer>
</div>

<script>
  const $ = (id) => document.getElementById(id);

  async function run() {
    const button = $('go');
    button.disabled = true;
    $('timing').textContent = 'resolving…';

    const params = new URLSearchParams({ url: $('url').value.trim() });
    if ($('deep').checked) params.set('deep', 'true');
    if ($('refresh').checked) params.set('refresh', 'true');
    const includes = [];
    if ($('contact').checked) includes.push('contact');
    if ($('activity').checked) includes.push('activity');
    if (includes.length) params.set('include', includes.join(','));

    const headers = {};
    const key = $('key').value.trim();
    if (key) headers['x-api-key'] = key;

    const startedAt = performance.now();
    try {
      const response = await fetch('/v1/profile?' + params.toString(), { headers });
      const body = await response.json();
      const elapsed = Math.round(performance.now() - startedAt);

      $('out-card').hidden = false;
      $('out').textContent = JSON.stringify(body, null, 2);
      $('timing').textContent = elapsed + ' ms';
      renderMeta(body, response.status);
    } catch (err) {
      $('out-card').hidden = false;
      $('out').textContent = String(err);
      $('meta').innerHTML = '';
      $('timing').textContent = '';
    } finally {
      button.disabled = false;
    }
  }

  function renderMeta(body, status) {
    const chips = [];
    const ok = status === 200;
    chips.push(chip('HTTP ' + status, ok ? 'ok' : 'warn'));

    if (body && body.meta) {
      chips.push(chip('cache: ' + body.meta.cache));
      if (body.meta.partial) chips.push(chip('partial', 'warn'));
      for (const strategy of body.meta.strategies || []) {
        const tone = strategy.status === 'ok' ? 'ok' : strategy.status === 'error' ? 'warn' : '';
        chips.push(chip(strategy.name + ': ' + strategy.status + ' ' + strategy.duration_ms + 'ms', tone));
      }
    }
    if (body && body.error) chips.push(chip(body.error.code, 'warn'));

    $('meta').innerHTML = chips.join('');
  }

  function chip(text, tone) {
    const cls = tone ? 'chip ' + tone : 'chip';
    const escaped = String(text).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
    return '<span class="' + cls + '">' + escaped + '</span>';
  }

  $('go').addEventListener('click', run);
  $('url').addEventListener('keydown', (event) => { if (event.key === 'Enter') run(); });
</script>
</body>
</html>`;
