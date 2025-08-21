// No-op middleware. Security headers are set via vercel.json now.
export function middleware(req) { return new Response(null, { status: 200 }); }
export const config = { matcher: [] };
