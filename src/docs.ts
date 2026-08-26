/**
 * Self-describing documentation endpoints.
 *
 * `/v1/architecture` explains how the service works; `/v1/workflow` explains
 * how it was built. Both are served as JSON from the running service rather
 * than living only in a README, so they cannot drift from the deployment a
 * reviewer is actually looking at.
 */

export function architectureDocument() {
  return {
    title: 'LinkedIn Profile API — architecture',
    summary:
      'A LinkedIn profile URL is resolved into structured JSON by calling LinkedIn\'s ' +
      'internal Voyager endpoints with an authenticated session. Extraction runs as a ' +
      'chain of independent strategies whose outputs are merged, so a broken strategy ' +
      'costs coverage rather than availability.',

    request_flow: [
      { step: 1, name: 'parse', detail: 'Any LinkedIn profile URL form reduces to a public identifier. Company, school and job URLs are rejected with INVALID_URL rather than returning an empty profile.' },
      { step: 2, name: 'cache', detail: 'Keyed by identifier plus the options that change the result. A hit is a LinkedIn profile view that never happens — the scarce resource this service protects.' },
      { step: 3, name: 'rate limit', detail: 'Fixed window per API key, so one caller cannot burn the account\'s whole monthly view budget in a loop.' },
      { step: 4, name: 'strategy chain', detail: 'rest → embedded → graphql, each merged into one profile. The chain does not stop at first success: a later strategy may carry a section an earlier one missed.' },
      { step: 5, name: 'resolve', detail: 'Rest.li normalised envelopes are re-assembled from a flat entity pool into a tree.' },
      { step: 6, name: 'normalise', detail: 'Entities are mapped into a canonical Zod-validated schema, with per-field provenance recorded.' },
    ],

    strategies: [
      {
        name: 'rest',
        endpoint: '/voyager/api/identity/dash/profiles?q=memberIdentity&decorationId=…FullProfileWithEntities-101',
        role: 'primary',
        why: 'One call returns ~68 KB of clean normalised JSON: profile, positions, position groups, education, projects, skills, featured media, and the companies and schools they reference.',
        cost: '~1 request, ~68 KB',
        fails_when: 'The decorationId schema version drifts. Mitigated by trying a list of candidate versions rather than pinning one.',
      },
      {
        name: 'embedded',
        endpoint: '/in/<slug>/ and /in/<slug>/details/* — JSON embedded in the HTML',
        role: 'fallback',
        why: 'The server chooses the query, so there is no query hash to maintain and this cannot rot the way GraphQL does. It also harvests fresh GraphQL query hashes as a side effect, repairing the tier below it.',
        cost: '1–3 MB of HTML per page',
        fails_when: 'LinkedIn\'s flagship web app has moved to React Server Components with server-driven UI and no longer reliably pre-fetches this data.',
      },
      {
        name: 'graphql',
        endpoint: '/voyager/api/graphql?queryId=voyagerIdentityDashProfileCards.<hash>',
        role: 'opportunistic fast path',
        why: 'Fast and compact — tens of kilobytes.',
        cost: '~1 request, ~50 KB',
        fails_when: 'Returns 500 unless queryId is the exact current build hash, and those rotate every LinkedIn deploy. Reports "skipped" rather than failing the request.',
      },
      {
        name: 'dom',
        endpoint: 'reuses HTML already fetched by the embedded strategy',
        role: 'last resort',
        why: 'Covers pages that arrive with no embedded JSON at all. Costs no extra requests.',
        cost: '0 extra requests',
        fails_when: 'Accuracy is lower by construction; provenance marks anything it produced.',
      },
      {
        name: 'assisted',
        endpoint: 'https://api.interfaze.ai/v1 (optional, off unless INTERFAZE_API_KEY is set)',
        role: 'schema-drift rescue',
        why: 'If LinkedIn reshapes a payload and every hand-written mapper comes up empty, the raw envelope is handed to a model with the canonical schema enforced. Output is validated before it is served.',
        cost: 'runs approximately never',
        fails_when: 'Never used as a primary extractor — a model is the wrong tool for reading JSON that is already structured.',
      },
    ],

    session_management: {
      summary:
        'The session is treated as mutable runtime state, not configuration. A cookie ' +
        'header in an environment variable is a photograph of a session at one instant; ' +
        'the session itself keeps moving.',
      rotation: {
        mechanism: 'Every Voyager response carries Set-Cookie. lidc rotates on almost every call, li_at periodically, and Cloudflare\'s __cf_bm every half hour. Those are merged back into the cookie jar and persisted.',
        consequence: 'A session stays alive indefinitely without anyone re-entering a password. The credential held is always the one LinkedIn most recently issued.',
      },
      minting: {
        mechanism: 'npm run mint opens a headful Playwright browser on a trusted machine. A human completes login and 2FA; the resulting cookie header is POSTed to /v1/admin/session.',
        why_not_on_the_server: [
          'LinkedIn fingerprints datacenter IP ranges. A first login from EC2, on a fresh browser profile, from an unfamiliar country is close to a maximum-suspicion signal — it triggers the exact checkpoint the automation was meant to avoid.',
          'It would put the account password on the server. This way the server only ever holds a cookie.',
          'It is not needed. Cookie rotation keeps the session current; minting is for when a session is genuinely dead, realistically once or twice a year.',
        ],
      },
      persistence: 'The jar is written to the shared cache, so a rotated cookie survives a redeploy or instance recycle instead of falling back to a stale environment value on every cold start.',
      observability: '/v1/health reports the session source, cookie names held, rotation count and whether LinkedIn has rejected it — so a monitor alerts before callers see failures.',
    },

    honest_limits: [
      'Parsing is not the limiting factor; visibility is. Profiles outside the session\'s network return LinkedIn\'s "LinkedIn Member" placeholder with no name or positions. This is reported as PROFILE_NOT_VISIBLE rather than disguised as an empty profile.',
      'LinkedIn\'s commercial use limit caps distinct profile views per account per month. Past it, every profile returns a paywall until the limit resets.',
      'profileView, the single-call endpoint most write-ups recommend, returns 410 Gone.',
      'Automated access is contrary to LinkedIn\'s User Agreement §8.2 and carries a real risk of account restriction at volume.',
      'Voyager is on borrowed time: the frontend has moved to server-driven UI and these endpoints are being retired section by section.',
    ],
  };
}

export function workflowDocument() {
  return {
    title: 'How this was built',
    note:
      'An accurate account of the development session, not a reconstruction. ' +
      'Everything here is verifiable against the git history.',

    process: 'Single linear Claude Code session, no subagents and no parallel orchestration. The work was sequential because each step\'s output changed the next step\'s design — in particular, live recon falsified two core architectural assumptions mid-build.',

    phases: [
      {
        phase: 'Framing',
        detail:
          'Read the brief as an API reverse-engineering problem rather than a scraping ' +
          'problem. That distinction drove everything downstream: the deliverable is a ' +
          'client for an undocumented API, so the design question is how to survive that ' +
          'API changing, not how to parse a page.',
      },
      {
        phase: 'Architecture before code',
        detail:
          'Designed the tiered strategy chain, canonical schema, provenance tracking and ' +
          'error taxonomy up front. The premise: any single extraction path against ' +
          'LinkedIn will break, so the architecture has to degrade rather than fail.',
      },
      {
        phase: 'Recon, cross-validated',
        detail:
          'Three independent artifacts were compared: a prior Playwright/BeautifulSoup ' +
          'attempt, a set of hand-written notes from a live authenticated session, and two ' +
          'reference client implementations. Where they agreed, the finding was trusted; ' +
          'where they disagreed, the live notes won.',
      },
      {
        phase: 'Assumptions falsified',
        detail:
          'Two load-bearing assumptions were wrong and were corrected mid-build. This is ' +
          'the part of the process worth reading.',
        corrections: [
          {
            assumed: 'Embedded page JSON should be the primary strategy, because it needs no query hash.',
            reality: 'LinkedIn\'s flagship app is now RSC/SDUI and issues no data API calls on profile load. The embedded blocks are no longer reliable.',
            change: 'Demoted to fallback; the dash REST collection was promoted to primary.',
          },
          {
            assumed: 'profileView is the one-call endpoint to target.',
            reality: '410 Gone.',
            change: 'Removed entirely, along with its normaliser.',
          },
          {
            assumed: 'Entities can be selected by their fsd_* URN type.',
            reality: 'The dash REST payload tags entities by $type — com.linkedin.voyager.dash.identity.profile.Position — not by URN type.',
            change: 'Selection now matches on both and unions the result. This was a silent-failure bug: a clean 200, a valid schema, and every section empty.',
          },
        ],
      },
      {
        phase: 'Offline-first testing',
        detail:
          'The normalisers are tested against committed fixtures rather than live calls. ' +
          'Two reasons: every live test is a profile view against a capped monthly budget, ' +
          'and a reviewer opening this repo after the session expires can still run the ' +
          'full suite. 45 tests, no network.',
      },
      {
        phase: 'Operational hardening',
        detail:
          'Cookie rotation, session persistence and reseed, cache, rate limiting, typed ' +
          'errors, OpenAPI, health checks. The parts that decide whether this survives a ' +
          'week rather than a demo.',
      },
    ],

    design_decisions: [
      { decision: 'Chain strategies instead of picking one', because: 'Every path into LinkedIn is temporary. Merging several means a breakage costs one section, not the whole response.' },
      { decision: 'Record per-field provenance', because: 'A consumer can tell which extraction path produced a value, and a maintainer can see which tier is degrading before it fails.' },
      { decision: 'Every scalar nullable, every collection defaulted', because: 'LinkedIn profiles are genuinely sparse and visibility is viewer-dependent. Absence is a normal outcome, not an error.' },
      { decision: 'Typed error codes over HTTP status alone', because: 'out-of-network, auth-walled, rate-limited and session-expired all need different responses from a caller, and all of them would otherwise be a bare 502.' },
      { decision: 'Contact info behind an explicit opt-in', because: 'It is personal data. Defaulting it on is the kind of thing that reads badly in review.' },
      { decision: 'Structured dates, not ISO strings', because: 'LinkedIn stores no day for a position. Inventing one would be a lie in the data.' },
    ],
  };
}
