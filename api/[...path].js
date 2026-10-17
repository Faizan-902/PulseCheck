import app from '../server/src/runtime.js';

// Vercel serves this catch-all Node.js Function for /api/*.
// Exporting the existing Express app preserves its route paths and middleware.
export default app;
