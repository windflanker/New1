// Cloudflare Workers entry point.
// Pages in ./public are served directly by Cloudflare (see wrangler.jsonc); only
// /api/* requests reach this code.
import { handleApi } from './api.js';
import { MongoStore } from './stores/mongo.js';

export default {
  async fetch(request, env, ctx) {
    if (!env.MONGODB_URI || !env.ADMIN_PIN) {
      return new Response(JSON.stringify({ error: 'The booking service is not set up yet (MONGODB_URI / ADMIN_PIN missing).' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const store = MongoStore.connect(env.MONGODB_URI, env.MONGODB_DB || 'maratha_museum');
    try {
      return await handleApi(request, { store, adminPin: env.ADMIN_PIN });
    } finally {
      ctx.waitUntil(store.close());
    }
  },
};
