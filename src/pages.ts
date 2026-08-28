import { readFileSync } from 'node:fs';
import { DESIGN_TOKENS, navBar } from './ui-tokens.js';

/**
 * Human-readable documentation pages.
 *
 * `/v1/architecture` and `/v1/workflow` return JSON for machines; these are the
 * same material rendered for a person, at `/architecture` and `/workflow`.
 * Serving both from the running service rather than only from a README means
 * they cannot drift away from the deployment a reader is actually looking at.
 */

/**
 * The architecture diagram, read once at boot.
 *
 * Read from disk rather than inlined as a string: it is 12 KB of markup that a
 * person needs to edit in Excalidraw, and a copy pasted into a TypeScript
 * template literal is a copy that goes stale the first time the real one
 * changes. Missing file degrades to a link rather than breaking the page.
 */
const DIAGRAM_SVG = loadDiagram();

function loadDiagram(): string | null {
  try {
    const path = new URL('../docs/architecture.svg', import.meta.url);
    return readFileSync(path, 'utf8').replace('width="1180" height="780" ', '');
  } catch {
    return null;
  }
}

const PAGE_CSS = String.raw`
  h1 { font: 400 34px/1.15 var(--serif); letter-spacing: -0.02em; margin: 0 0 12px; }
  h2 {
    font: 400 24px/1.2 var(--serif); letter-spacing: -0.01em;
    margin: 44px 0 14px; padding-top: 22px; border-top: 1px solid var(--rule);
  }
  h3 { font: 600 15px var(--sans); margin: 26px 0 8px; }
  p  { color: var(--ink-soft); margin: 0 0 14px; max-width: 68ch; }
  .lede { font: 18px/1.6 var(--serif); color: var(--ink); max-width: 62ch; margin-bottom: 6px; }
  code { font: 13px var(--mono); color: var(--accent); word-break: break-word; }
  strong { color: var(--ink); font-weight: 600; }

  figure { margin: 26px 0 34px; }
  figure .frame {
    background: #fff; border: 1px solid var(--rule); border-radius: 12px;
    padding: 14px; overflow-x: auto;
  }
  figure svg { display: block; width: 100%; height: auto; min-width: 900px; }
  figcaption { font-size: 13px; color: var(--ink-faint); margin-top: 10px; }
  figcaption a { color: var(--accent); }

  table { width: 100%; border-collapse: collapse; font-size: 14.5px; margin: 10px 0 20px; }
  th, td { text-align: left; padding: 11px 12px; border-bottom: 1px solid var(--rule); vertical-align: top; }
  th { font: 600 11.5px var(--sans); letter-spacing: .06em; text-transform: uppercase; color: var(--ink-faint); }
  td:first-child { white-space: nowrap; }
  td { color: var(--ink-soft); }

  ul { margin: 0 0 16px; padding-left: 20px; color: var(--ink-soft); max-width: 68ch; }
  li { margin-bottom: 8px; }

  .card {
    background: var(--card); border: 1px solid var(--rule);
    border-radius: 12px; padding: 20px 24px; margin-bottom: 16px;
  }
  .card h3 { margin-top: 0; }
  .card p:last-child { margin-bottom: 0; }
  .flag { border-left: 3px solid var(--warn); }
  .flag h3 { color: var(--warn); }

  .step { display: flex; gap: 16px; padding: 16px 0; border-top: 1px solid var(--rule-soft); }
  .step:first-of-type { border-top: 0; }
  .step .n {
    flex: 0 0 auto; width: 26px; height: 26px; border-radius: 50%;
    border: 1px solid var(--rule); display: flex; align-items: center; justify-content: center;
    font: 600 12px var(--mono); color: var(--ink-faint);
  }
  .step .body { min-width: 0; }
  .step h3 { margin: 2px 0 4px; }
  .step p { margin: 0; font-size: 14.5px; }

  .wrong-right { display: grid; grid-template-columns: 1fr 1fr; gap: 0; }
  .wrong-right > div { padding: 14px 16px; }
  .wrong-right .assumed { border-right: 1px solid var(--rule); }
  .wrong-right .label {
    font: 600 10.5px var(--sans); letter-spacing: .08em; text-transform: uppercase;
    margin-bottom: 6px;
  }
  .assumed .label { color: var(--bad); }
  .reality .label { color: var(--good); }
  .wrong-right p { font-size: 14px; margin: 0; }
  @media (max-width: 640px) {
    .wrong-right { grid-template-columns: 1fr; }
    .wrong-right .assumed { border-right: 0; border-bottom: 1px solid var(--rule); }
    figure svg { min-width: 700px; }
  }
`;

function shell(title: string, current: Parameters<typeof navBar>[0], body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>${DESIGN_TOKENS}${PAGE_CSS}</style>
</head>
<body><div class="wrap">${navBar(current)}${body}</div></body>
</html>`;
}

export function architecturePage(): string {
  const figure = DIAGRAM_SVG
    ? `<figure>
        <div class="frame">${DIAGRAM_SVG}</div>
        <figcaption>
          Source: <a href="https://github.com/rohhann12/linkedin-rev-eng/blob/main/docs/architecture.excalidraw">docs/architecture.excalidraw</a>
          — open it at <a href="https://excalidraw.com" target="_blank" rel="noreferrer">excalidraw.com</a> to edit.
        </figcaption>
      </figure>`
    : `<p><a href="https://github.com/rohhann12/linkedin-rev-eng/blob/main/docs/architecture.svg">View the architecture diagram on GitHub.</a></p>`;

  return shell(
    'Architecture — LinkedIn Profile API',
    'architecture',
    `<h1>Architecture</h1>
    <p class="lede">A profile URL in, structured JSON out. Extraction runs as a chain of
      independent strategies whose outputs are merged, so a strategy breaking costs
      coverage rather than availability.</p>

    ${figure}

    <h2>Why not scrape the page</h2>
    <p>LinkedIn's flagship web app is now React Server Components with server-driven UI.
      Loading a profile issues <strong>no data API calls at all</strong> — it posts to
      <code>/flagship-web/rsc-action/…</code> and receives RSC flight payloads wrapping SDUI
      component trees, with hashed class names and no stable field names. Parsing that means
      walking a serialised UI tree that changes shape on every deploy.</p>
    <p>The legacy Voyager REST surface, meanwhile, is still live and still returns clean JSON.
      It is the least fashionable target and by a distance the best one. This is not a
      hypothesis — the <code>embedded</code> tier reports
      <code>"Profile page contained no embedded data blocks"</code> against live profiles today.</p>

    <h2>The strategy chain</h2>
    <table>
      <tr><th>Tier</th><th>Surface</th><th>Role</th></tr>
      <tr>
        <td><code>rest</code></td>
        <td><code>/voyager/api/identity/dash/profiles</code><br />
            <code>decorationId=…FullProfileWithEntities-101</code></td>
        <td><strong>Primary.</strong> One call, ~68&nbsp;KB, ~550&nbsp;ms: profile, positions,
            position groups, education, projects, skills, featured media, and the companies
            and schools they reference.</td>
      </tr>
      <tr>
        <td><code>embedded</code></td>
        <td>JSON inside the profile HTML, plus <code>/details/*</code> and
            <code>/overlay/contact-info/</code></td>
        <td>Fallback. Needs no query hash so it cannot rot the way GraphQL does — and it
            harvests fresh GraphQL hashes, repairing the tier below it.</td>
      </tr>
      <tr>
        <td><code>graphql</code></td>
        <td><code>/voyager/api/graphql?queryId=…</code></td>
        <td>Fast path. Returns 500 unless the hash matches the current build, so it reports
            <code>skipped</code> rather than failing the request.</td>
      </tr>
      <tr>
        <td><code>dom</code></td>
        <td>cheerio over HTML already fetched</td>
        <td>Last resort. Zero extra requests, lower accuracy by design.</td>
      </tr>
      <tr>
        <td><code>assisted</code></td>
        <td>Optional model call, off unless a key is set</td>
        <td>Schema-drift rescue. Output re-validated against the same schema.</td>
      </tr>
    </table>
    <p>The chain <strong>does not stop at the first success</strong> — a later tier may carry a
      section an earlier one missed. It stops when identity plus career history are present,
      because most sections are legitimately empty on most profiles.</p>

    <h2>The part that is actually hard</h2>
    <p>Voyager answers in Rest.li's normalised envelope: a flat, de-duplicated
      <code>included[]</code> entity pool, plus a <code>data</code> skeleton whose
      <code>*</code>-prefixed keys are URN pointers into it. Nothing is nested — a position's
      company, its logo, and the logo's image artifacts are four separate entries linked by URN.</p>
    <div class="card"><p style="margin:0"><code>{ "data": { "*elements": ["urn:li:fsd_profile:ACoAAA"] },
      "included": [ { "entityUrn": "urn:li:fsd_profilePosition:1", "title": "Analyst",
      "*company": "urn:li:fsd_company:99" },
      { "entityUrn": "urn:li:fsd_company:99", "name": "Analytical Engines" } ] }</code></p></div>
    <p><code>restli.ts</code> is the graph resolver that rebuilds this into a tree. Because it
      follows pointers recursively, nested chains resolve without special-casing — engagement
      counts on a post sit two hops deep
      (<code>UpdateV2 → *socialDetail → *totalSocialActivityCounts</code>) and need no bespoke
      code. Every strategy produces this same envelope, which is why there is one resolver and
      one set of mappers rather than three.</p>

    <h2>Session management</h2>
    <p>The session is treated as <strong>mutable runtime state, not configuration</strong>. A
      cookie header in an environment variable is a photograph of a session at one instant; the
      session itself keeps moving.</p>
    <div class="card">
      <h3>Rotation</h3>
      <p>Every response carries <code>Set-Cookie</code> — <code>lidc</code> on almost every call,
        <code>li_at</code> periodically, <code>__cf_bm</code> every half hour. Those are merged
        back into the jar and persisted to disk (0600, write-then-rename), so the credential held
        is always the one LinkedIn most recently issued.</p>
    </div>
    <div class="card">
      <h3>Keepalive</h3>
      <p>Rotation is driven by traffic, and an idle deployment generates none. So every four
        hours the service calls <code>/voyager/api/me</code>. That refreshes the jar, and
        surfaces a dead session on <code>/v1/health</code> hours before a caller would hit it.
        It returns the authenticated member's own identity — <strong>not a profile view</strong>
        — so it costs nothing against the commercial use limit.</p>
    </div>
    <div class="card">
      <h3>Minting, on a trusted machine only</h3>
      <p>LinkedIn fingerprints datacenter IP ranges. A first login from EC2, on a fresh browser
        profile, from an unfamiliar country is close to a maximum-suspicion signal — it triggers
        the exact checkpoint the automation was meant to avoid. So <code>npm run mint</code> runs
        a headful browser on a laptop and POSTs the resulting cookie to
        <code>/v1/admin/session</code>. The server never runs a browser and never sees a password.</p>
    </div>

    <h2>What limits this — and it is not the parser</h2>
    <div class="card flag">
      <h3>Visibility</h3>
      <p>Profiles outside the session's network return LinkedIn's <code>LinkedIn Member</code>
        placeholder with no name or positions. No amount of parsing recovers what LinkedIn
        declined to send. Reported as <code>PROFILE_NOT_VISIBLE</code> rather than disguised as
        an empty profile.</p>
    </div>
    <div class="card flag">
      <h3>Commercial Use Limit</h3>
      <p>A fixed number of distinct profile views per account per month. Past it, every profile
        returns a paywall until it resets. This is the real ceiling on throughput, and the reason
        the cache and rate limiter exist.</p>
    </div>
    <div class="card flag">
      <h3>Impermanence</h3>
      <p>Voyager is being retired section by section — <code>profileView</code>, the single-call
        endpoint most write-ups still recommend, already returns <strong>410 Gone</strong>. Any
        single path will break. The chain assumes it.</p>
    </div>
    <div class="card flag">
      <h3>Terms of service</h3>
      <p>Automated access is contrary to LinkedIn's User Agreement §8.2 and carries a real risk
        of account restriction at volume. <em>hiQ v. LinkedIn</em> established that scraping
        public data is not a CFAA crime, but that is a criminal-liability ruling — it does not
        make it contractually permitted, and these endpoints require an authenticated session,
        so "public data" does not cleanly apply.</p>
    </div>`,
  );
}

export function workflowPage(): string {
  return shell(
    'Approach — LinkedIn Profile API',
    'workflow',
    `<h1>How this was built</h1>
    <p class="lede">An accurate account of the development session, not a reconstruction.
      Everything here is verifiable against the git history.</p>
    <p>A single linear Claude Code session — no subagents, no parallel orchestration. The work
      was sequential because each step's output changed the next step's design: live
      reconnaissance falsified two load-bearing architectural assumptions mid-build.</p>

    <h2>The sequence</h2>
    <div class="card">
      <div class="step"><div class="n">1</div><div class="body">
        <h3>Framing</h3>
        <p>Read the brief as an API reverse-engineering problem rather than a scraping problem.
          That distinction drove everything downstream: the deliverable is a client for an
          undocumented API, so the design question is how to survive that API changing, not how
          to parse a page.</p>
      </div></div>
      <div class="step"><div class="n">2</div><div class="body">
        <h3>Architecture before code</h3>
        <p>Designed the tiered strategy chain, canonical schema, provenance tracking and error
          taxonomy up front, on the premise that any single extraction path against LinkedIn
          will break — so the architecture has to degrade rather than fail.</p>
      </div></div>
      <div class="step"><div class="n">3</div><div class="body">
        <h3>Reconnaissance, cross-validated</h3>
        <p>Three independent artifacts compared: a prior Playwright/BeautifulSoup attempt,
          hand-written notes from a live authenticated session, and two reference client
          implementations. Where they agreed, the finding was trusted; where they disagreed,
          the live notes won.</p>
      </div></div>
      <div class="step"><div class="n">4</div><div class="body">
        <h3>Assumptions falsified</h3>
        <p>Two load-bearing assumptions were wrong and were corrected mid-build. This is the
          part worth reading — see below.</p>
      </div></div>
      <div class="step"><div class="n">5</div><div class="body">
        <h3>Offline-first testing</h3>
        <p>The normalisers are tested against committed fixtures rather than live calls. Two
          reasons: every live test is a profile view against a capped monthly budget, and a
          reviewer opening the repo after the session expires can still run the whole suite.
          53 tests, no network.</p>
      </div></div>
      <div class="step"><div class="n">6</div><div class="body">
        <h3>Operational hardening</h3>
        <p>Cookie rotation, session persistence and reseed, keepalive, cache, rate limiting,
          typed errors, OpenAPI, health checks — the parts that decide whether this survives a
          week rather than a demo.</p>
      </div></div>
    </div>

    <h2>Where I was wrong</h2>
    <div class="card"><div class="wrong-right">
      <div class="assumed"><div class="label">Assumed</div>
        <p>Embedded page JSON should be the primary strategy, because it needs no query hash.</p></div>
      <div class="reality"><div class="label">Reality</div>
        <p>The flagship app is RSC/SDUI and issues no data API calls on profile load. The
          embedded blocks are gone. <strong>Demoted to fallback; the dash REST collection was
          promoted to primary.</strong></p></div>
    </div></div>
    <div class="card"><div class="wrong-right">
      <div class="assumed"><div class="label">Assumed</div>
        <p><code>profileView</code> is the one-call endpoint to target — it is what most
          write-ups still recommend.</p></div>
      <div class="reality"><div class="label">Reality</div>
        <p><strong>410 Gone.</strong> Removed entirely, along with its normaliser.</p></div>
    </div></div>
    <div class="card"><div class="wrong-right">
      <div class="assumed"><div class="label">Assumed</div>
        <p>Entities can be selected by their <code>fsd_*</code> URN type.</p></div>
      <div class="reality"><div class="label">Reality</div>
        <p>The dash payload tags entities by <code>$type</code>
          (<code>com.linkedin.voyager.dash.identity.profile.Position</code>). Matching one form
          only produced <strong>a clean 200, a valid schema, and every section silently
          empty</strong> — the worst possible failure. Selection now matches both and unions.</p></div>
    </div></div>
    <div class="card"><div class="wrong-right">
      <div class="assumed"><div class="label">Assumed</div>
        <p>Requiring identity plus experience <em>and</em> education was a reasonable bar for
          "complete enough to stop".</p></div>
      <div class="reality"><div class="label">Reality</div>
        <p>Most profiles legitimately lack a section. Against a live profile,
          <code>rest</code> answered in 544&nbsp;ms and the chain then spent
          <strong>2,364&nbsp;ms</strong> on a tier with nothing to add — 81% of the response
          time. Caught by reading the timings in <code>meta.strategies</code>.</p></div>
    </div></div>

    <h2>Design decisions</h2>
    <table>
      <tr><th>Decision</th><th>Because</th></tr>
      <tr><td>Chain strategies instead of picking one</td>
          <td>Every path into LinkedIn is temporary. Merging several means a breakage costs one
              section, not the whole response.</td></tr>
      <tr><td>Record per-field provenance</td>
          <td>A consumer can tell which path produced a value; a maintainer can see which tier
              is degrading before it fails.</td></tr>
      <tr><td>Every scalar nullable, every collection defaulted</td>
          <td>Profiles are genuinely sparse and visibility is viewer-dependent. Absence is a
              normal outcome, not an error.</td></tr>
      <tr><td>Typed error codes over HTTP status alone</td>
          <td>Out-of-network, auth-walled, rate-limited and session-expired need different
              responses from a caller, and would otherwise all be a bare 502.</td></tr>
      <tr><td>Contact info behind an explicit opt-in</td>
          <td>It is personal data. Defaulting it on reads badly in review.</td></tr>
      <tr><td>Structured dates, not ISO strings</td>
          <td>LinkedIn stores no day for a position. Inventing one would be a lie in the data.</td></tr>
      <tr><td>Fixtures over live calls in tests</td>
          <td>Live tests spend a capped resource and stop working the moment the session dies.</td></tr>
    </table>

    <h2>On contact enrichment</h2>
    <p>Contact hydration was traced to <code>profileContactInfo</code>, the endpoint behind the
      profile page's "Contact info" overlay — also reachable as a plain page at
      <code>/in/&lt;slug&gt;/overlay/contact-info/</code>, so no browser interaction is needed
      to open it.</p>
    <p>Worth being precise about its reach, because it is routinely overstated:
      <code>emailAddress</code> is returned only when the member chose to share it
      <em>and</em> the session is a 1st-degree connection. Enrichment vendors are not getting
      broad email coverage from this endpoint. They take the employer and full name it provides,
      infer <code>first.last@company.com</code>, and verify the guess over SMTP.</p>`,
  );
}
