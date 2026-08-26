/** Local development entrypoint. Vercel uses `api/index.ts` instead. */
import { createApp } from './app.js';

// Node's built-in .env loader — no dotenv dependency needed on 20.12+.
try {
  process.loadEnvFile('.env');
} catch {
  // No .env file is fine; the environment may already be populated.
}

const port = Number.parseInt(process.env.PORT ?? '3000', 10);

createApp().listen(port, () => {
  console.log(`linkedin-profile-api listening on http://localhost:${port}`);
  console.log(`  playground  http://localhost:${port}/`);
  console.log(`  health      http://localhost:${port}/v1/health`);
});
