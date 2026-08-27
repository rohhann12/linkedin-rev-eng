/**
 * Push the session already in `.env` to a deployment.
 *
 *   npm run push-session -- http://1.2.3.4
 *
 * The no-browser complement to `npm run mint`. When you already hold a working
 * cookie header — copied from DevTools, or left over from local development —
 * there is nothing to log in to, so opening Chromium just to re-derive what you
 * have is wasted effort.
 *
 * Same destination and same guarantee either way: the cookie travels to the
 * server through the authenticated admin endpoint, and the server never sees a
 * password.
 */
try {
  process.loadEnvFile('.env');
} catch {
  // Already-populated environments are fine.
}

async function main(): Promise<number> {
  const target = process.argv[2];
  if (!target) {
    console.error('usage: npm run push-session -- <base-url>');
    return 2;
  }

  const cookie = process.env.LINKEDIN_COOKIE?.trim();
  const adminToken = process.env.ADMIN_TOKEN?.trim();

  if (!cookie) {
    console.error('error: LINKEDIN_COOKIE is not set in .env');
    return 2;
  }
  if (!adminToken) {
    console.error('error: ADMIN_TOKEN is not set — it must match the deployment');
    return 2;
  }
  if (!/li_at=/.test(cookie) || !/JSESSIONID=/.test(cookie)) {
    console.error('error: cookie header must contain both li_at and JSESSIONID');
    return 2;
  }

  const base = target.replace(/\/$/, '');
  console.log(`pushing session to ${base} …`);

  const response = await fetch(`${base}/v1/admin/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ cookie }),
  });

  const body = await response.text();
  if (!response.ok) {
    console.error(`error: ${response.status}\n${body.slice(0, 500)}`);
    return 1;
  }

  console.log(body);

  const health = await fetch(`${base}/v1/health`);
  console.log(`\nhealth: ${health.status}`);
  console.log((await health.text()).slice(0, 400));
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
