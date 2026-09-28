// Vercel Routing Middleware: every request to the deployed site needs the password in SITE_PASSWORD.
// The browser shows its own sign-in prompt (HTTP Basic auth); any username works.
export const config = { matcher: '/:path*' };

function sameText(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default function middleware(request) {
  const password = process.env.SITE_PASSWORD;
  if (!password) {
    return new Response('This site is locked until SITE_PASSWORD is set in the Vercel project.', { status: 503 });
  }

  const header = request.headers.get('authorization') ?? '';
  if (header.startsWith('Basic ')) {
    try {
      const decoded = atob(header.slice(6));
      const given = decoded.slice(decoded.indexOf(':') + 1);
      if (sameText(given, password)) return;
    } catch {}
  }

  return new Response('Password required.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Resume Desk", charset="UTF-8"', 'Cache-Control': 'no-store' },
  });
}
