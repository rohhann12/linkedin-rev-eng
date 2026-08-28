/**
 * Design tokens and base styles, shared by every page the service serves.
 *
 * Kept in one place so the playground and the documentation pages cannot drift
 * apart — a palette defined twice is a palette that disagrees with itself after
 * the second edit.
 */
export const DESIGN_TOKENS = String.raw`
  :root {
    --paper:      #faf8f5;
    --card:       #ffffff;
    --ink:        #1c1a17;
    --ink-soft:   #57534e;
    --ink-faint:  #8b8580;
    --rule:       #e7e2da;
    --rule-soft:  #f0ece5;
    --accent:     #1a5c99;
    --accent-bg:  #eef4fa;
    --good:       #2f6f4f;
    --warn:       #9a5b12;
    --bad:        #a8402c;
    --serif: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif;
    --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif;
    --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --paper:      #16151a;
      --card:       #1d1c22;
      --ink:        #ece9e4;
      --ink-soft:   #a8a29a;
      --ink-faint:  #75706a;
      --rule:       #2f2d35;
      --rule-soft:  #26242b;
      --accent:     #6fa8dc;
      --accent-bg:  #1c2733;
      --good:       #63b58a;
      --warn:       #d9a441;
      --bad:        #d9705c;
    }
  }

  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    margin: 0;
    background: var(--paper);
    color: var(--ink);
    font: 16px/1.6 var(--sans);
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 960px; margin: 0 auto; padding: 40px 24px 96px; }

  /* Shared masthead + navigation across playground and docs pages. */
  nav.top {
    display: flex; gap: 22px; align-items: baseline;
    padding-bottom: 18px; margin-bottom: 26px; border-bottom: 1px solid var(--rule);
    flex-wrap: wrap;
  }
  nav.top a {
    font: 600 12.5px var(--sans); letter-spacing: .06em; text-transform: uppercase;
    color: var(--ink-faint); text-decoration: none;
  }
  nav.top a:hover { color: var(--accent); }
  nav.top a[aria-current] { color: var(--ink); }
  nav.top .brand {
    font: 400 17px var(--serif); letter-spacing: -0.01em; color: var(--ink);
    margin-right: auto; text-transform: none;
  }
`;

/** The nav bar, with the current page marked. */
export function navBar(current: 'playground' | 'architecture' | 'workflow'): string {
  const link = (href: string, label: string, key: string) =>
    `<a href="${href}"${current === key ? ' aria-current="page"' : ''}>${label}</a>`;

  return `<nav class="top">
    <a class="brand" href="/">LinkedIn Profile API</a>
    ${link('/', 'Playground', 'playground')}
    ${link('/architecture', 'Architecture', 'architecture')}
    ${link('/workflow', 'Approach', 'workflow')}
    <a href="/openapi.json">OpenAPI</a>
    <a href="https://github.com/rohhann12/linkedin-rev-eng" target="_blank" rel="noreferrer">GitHub</a>
  </nav>`;
}
