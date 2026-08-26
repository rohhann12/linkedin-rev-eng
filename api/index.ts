/**
 * Vercel entrypoint.
 *
 * An Express app is a `(req, res)` handler, which is exactly what a Vercel
 * Function expects — so the same app object serves both local development and
 * production with no adapter in between. `vercel.json` rewrites every path here
 * and Express does the routing.
 */
import { createApp } from '../src/app.js';

export default createApp();
