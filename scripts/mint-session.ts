/**
 * Mint a LinkedIn session interactively, then hand it to a deployment.
 *
 *   npm run mint                                    # print the cookie header
 *   npm run mint -- --push https://api.example.com  # POST it to /v1/admin/session
 *
 * Run this on a machine with a real browser and an IP LinkedIn already trusts —
 * i.e. your laptop, not the server.
 *
 * Why not run it on the server? Three reasons, in order of how much they hurt:
 *
 *  1. LinkedIn fingerprints datacenter IP ranges. A first login from EC2, on a
 *     fresh browser profile, from a different country to every previous session
 *     is close to a maximum-suspicion signal — so it reliably triggers the
 *     email checkpoint or CAPTCHA you were trying to automate away.
 *  2. It would put the account password on the server. This way the server only
 *     ever holds a cookie, and the password never leaves the laptop.
 *  3. It is not needed. Once a session exists, `absorbSetCookies` keeps it
 *     alive from LinkedIn's own `Set-Cookie` rotation, indefinitely. This
 *     script runs when a session is genuinely dead — realistically once or
 *     twice a year — not on a schedule.
 *
 * The browser profile persists to `.playwright-session/`, so a re-run usually
 * finds you still logged in and skips straight to the cookie dump.
 */
import { chromium } from 'playwright';

const PROFILE_DIR = '.playwright-session';

/** Cookies worth carrying. Analytics cookies only bloat the header. */
const WANTED = new Set([
  'li_at',
  'JSESSIONID',
  'lidc',
  'bcookie',
  'bscookie',
  'liap',
  'lang',
  'li_theme',
  'li_theme_set',
  'timezone',
  'dfpfpt',
  'fid',
  '__cf_bm',
  'li_sugr',
  '_guid',
  'sdui_ver',
]);

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const pushIndex = args.indexOf('--push');
  const target = pushIndex === -1 ? null : args[pushIndex + 1];

  if (pushIndex !== -1 && !target) {
    console.error('error: --push needs a base URL, e.g. --push https://api.example.com');
    return 2;
  }

  const adminToken = process.env.ADMIN_TOKEN?.trim();
  if (target && !adminToken) {
    console.error('error: ADMIN_TOKEN must be set to push a session to a deployment');
    return 2;
  }

  console.log('opening a browser — log in to LinkedIn, then come back here\n');

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });

    // Wait for a logged-in session rather than for a particular page: the
    // journey varies (password, 2FA, checkpoint, "remember this device"), but
    // it always ends with a li_at cookie being set.
    console.log('waiting for login to complete (10 minute timeout)…');
    const cookies = await waitForAuth(context, 10 * 60_000);

    if (!cookies) {
      console.error('\nerror: timed out before a li_at cookie appeared');
      return 1;
    }

    const header = cookies
      .filter((cookie) => WANTED.has(cookie.name))
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join('; ');

    const expiry = cookies.find((cookie) => cookie.name === 'li_at')?.expires;
    console.log('\nsession minted');
    console.log(`  cookies : ${header.split('; ').length}`);
    if (expiry && expiry > 0) {
      console.log(`  li_at expires : ${new Date(expiry * 1000).toISOString()}`);
    }

    if (!target) {
      console.log('\nAdd this to .env as a single-quoted value:\n');
      console.log(`LINKEDIN_COOKIE='${header}'`);
      return 0;
    }

    const response = await fetch(`${target.replace(/\/$/, '')}/v1/admin/session`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ cookie: header }),
    });

    const body = await response.text();
    if (!response.ok) {
      console.error(`\nerror: ${target} returned ${response.status}\n${body.slice(0, 400)}`);
      return 1;
    }

    console.log(`\npushed to ${target}`);
    console.log(body);
    return 0;
  } finally {
    await context.close();
  }
}

async function waitForAuth(
  context: Awaited<ReturnType<typeof chromium.launchPersistentContext>>,
  timeoutMs: number,
) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const cookies = await context.cookies('https://www.linkedin.com');
    const liAt = cookies.find((cookie) => cookie.name === 'li_at');
    const jsession = cookies.find((cookie) => cookie.name === 'JSESSIONID');

    if (liAt?.value && jsession?.value) return cookies;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  return null;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
