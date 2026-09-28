// The online desk's API: sign-in, then the same routes the dashboard uses locally, scoped to the signed-in user.
import { currentUser, signIn, sessionCookie, clearCookie, setPassword } from '../lib/auth.mjs';
import * as cloud from '../lib/cloud.mjs';
import { zip } from '../lib/zip.mjs';

function send(res, status, body, cookie) {
  res.status(status);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (cookie) res.setHeader('Set-Cookie', cookie);
  res.send(JSON.stringify(body));
}

// Blocks cross-site form posts: JSON bodies force a CORS preflight, and the Origin must be this site.
function sameOriginJson(req) {
  const host = req.headers['x-forwarded-host'] ?? req.headers.host;
  const origin = req.headers.origin;
  const json = String(req.headers['content-type'] ?? '').startsWith('application/json');
  return json && (!origin || origin === `https://${host}` || origin === `http://${host}`);
}

const POST_ROUTES = {
  save: (u, b) => cloud.save(u.id, b),
  check: (u, b) => cloud.check(b.html),
  build: (u, b) => cloud.build(u.id, b),
  create: (u, b) => cloud.create(u.id, b),
  details: (u, b) => cloud.details(u.id, b),
  folder: (u, b) => cloud.folder(u.id, b),
  'company-rename': (u, b) => cloud.renameCompany(u.id, b),
  rename: (u, b) => cloud.rename(u.id, b),
  archive: (u, b) => cloud.archive(u.id, b),
};

export default async function handler(req, res) {
  const route = String(req.query.route ?? '').replace(/^\/+|\/+$/g, '');
  const post = req.method === 'POST';
  const body = post && req.body && typeof req.body === 'object' ? req.body : {};

  try {
    if (post && !sameOriginJson(req)) return send(res, 403, { error: 'Requests must come from the desk itself.' });

    if (route === 'login' && post) {
      const user = await signIn(body.email, body.password);
      return send(res, 200, { ok: true, mustChangePassword: Boolean(user.mustChangePassword) }, sessionCookie(user));
    }
    if (route === 'logout' && post) return send(res, 200, { ok: true }, clearCookie());

    const user = await currentUser(req.headers.cookie);
    if (!user) return send(res, 401, { error: 'Sign in to continue.', signIn: true });
    const account = { email: user.email, name: user.name, mustChangePassword: Boolean(user.mustChangePassword) };

    if (route === 'me') return send(res, 200, account);
    if (route === 'password' && post) {
      await signIn(user.email, body.current);
      const updated = await setPassword(user.id, body.next);
      return send(res, 200, { ok: true }, sessionCookie(updated));
    }
    if (user.mustChangePassword) return send(res, 403, { error: 'Choose a new password first.', mustChangePassword: true });

    if (post && POST_ROUTES[route]) return send(res, 200, await POST_ROUTES[route](user, body));

    if (req.method === 'GET') {
      switch (route) {
        case 'state':
          return send(res, 200, { ...cloud.snapshot(await cloud.loadState(user.id)), account });
        case 'html': {
          const html = await cloud.readHtml(user.id, req.query.file);
          if (html == null) return send(res, 404, { error: 'Not found.' });
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          // Opened directly, a resume renders in a sandbox with no access to this site.
          res.setHeader('Content-Security-Policy', 'sandbox');
          return res.status(200).send(html);
        }
        case 'pdf': {
          const name = String(req.query.name ?? '');
          const pdf = await cloud.readPdf(user.id, name);
          if (!pdf) return send(res, 404, { error: 'Not found.' });
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', `inline; filename="${name.replace(/[^\w.-]/g, '_')}"`);
          res.setHeader('Cache-Control', 'private, no-store');
          return res.status(200).send(pdf);
        }
        case 'ats':
          return send(res, 200, await cloud.ats(user.id, req.query.file));
        case 'history':
          return send(res, 200, await cloud.history(user.id, req.query.file, user.name));
        case 'version':
          return send(res, 200, await cloud.version(user.id, req.query.file, String(req.query.commit ?? '')));
        case 'export': {
          const archive = zip(await cloud.exportFiles(user.id));
          res.setHeader('Content-Type', 'application/zip');
          res.setHeader('Content-Disposition', `attachment; filename="resumes-${new Date().toISOString().slice(0, 10)}.zip"`);
          res.setHeader('Cache-Control', 'no-store');
          return res.status(200).send(archive);
        }
      }
    }
    return send(res, 404, { error: 'Unknown endpoint.' });
  } catch (err) {
    return send(res, 400, { error: String(err?.message ?? err).split('\n')[0] });
  }
}
