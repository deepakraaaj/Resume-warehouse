// Accounts, passwords and sessions. Users are created with the add-user script; there is no public sign-up.
import crypto from 'node:crypto';
import { readJson, writeJson } from './store.mjs';

const USERS = 'auth/users.json';
const ATTEMPTS = 'auth/attempts.json';
const COOKIE = 'desk_session';
const SESSION_DAYS = 30;
const MAX_FAILS = 8;
const LOCK_MINUTES = 15;

const secret = () => {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET is missing or too short.');
  return s;
};

export const normaliseEmail = email => String(email ?? '').trim().toLowerCase();

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return { salt, hash };
}

function passwordMatches(user, password) {
  const { hash } = hashPassword(password, user.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.hash, 'hex'));
}

export function checkNewPassword(password) {
  const p = String(password ?? '');
  if (p.length < 10) throw new Error('Use at least 10 characters for your password.');
  if (p.length > 200) throw new Error('That password is too long.');
  return p;
}

export async function loadUsers() {
  const data = await readJson(USERS, { users: [] });
  return Array.isArray(data.users) ? data.users : [];
}

export const saveUsers = users => writeJson(USERS, { users });

export async function findUser(id) {
  return (await loadUsers()).find(u => u.id === id) ?? null;
}

export async function createUser({ email, name, password }) {
  const users = await loadUsers();
  const clean = normaliseEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) throw new Error('That is not an email address.');
  if (users.some(u => u.email === clean)) throw new Error(`${clean} already has an account.`);
  const user = {
    id: `u_${crypto.randomBytes(9).toString('base64url')}`,
    email: clean,
    name: String(name ?? '').trim() || clean.split('@')[0],
    ...hashPassword(checkNewPassword(password)),
    passwordVersion: 1,
    mustChangePassword: true,
    createdAt: new Date().toISOString(),
  };
  await saveUsers([...users, user]);
  return user;
}

export async function setPassword(userId, newPassword) {
  const users = await loadUsers();
  const user = users.find(u => u.id === userId);
  if (!user) throw new Error('Account not found.');
  Object.assign(user, hashPassword(checkNewPassword(newPassword)), {
    passwordVersion: (user.passwordVersion ?? 1) + 1,
    mustChangePassword: false,
    updatedAt: new Date().toISOString(),
  });
  await saveUsers(users);
  return user;
}

// Returns the user, or throws a message safe to show on the sign-in form.
export async function signIn(email, password) {
  const clean = normaliseEmail(email);
  const attempts = await readJson(ATTEMPTS, {});
  const record = attempts[clean];
  const now = Date.now();
  if (record && record.count >= MAX_FAILS && now - record.since < LOCK_MINUTES * 60_000) {
    throw new Error(`Too many wrong passwords. Try again in ${LOCK_MINUTES} minutes.`);
  }
  const user = (await loadUsers()).find(u => u.email === clean);
  if (!user || !passwordMatches(user, password)) {
    const fresh = !record || now - record.since >= LOCK_MINUTES * 60_000;
    attempts[clean] = { count: fresh ? 1 : record.count + 1, since: fresh ? now : record.since };
    await writeJson(ATTEMPTS, attempts);
    await new Promise(r => setTimeout(r, 400));
    throw new Error('Wrong email or password.');
  }
  if (record) {
    delete attempts[clean];
    await writeJson(ATTEMPTS, attempts);
  }
  return user;
}

const sign = payload => crypto.createHmac('sha256', secret()).update(payload).digest('base64url');

export function sessionCookie(user) {
  const payload = Buffer.from(JSON.stringify({
    uid: user.id,
    pv: user.passwordVersion ?? 1,
    exp: Date.now() + SESSION_DAYS * 86_400_000,
  })).toString('base64url');
  return `${COOKIE}=${payload}.${sign(payload)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86_400}`;
}

export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

// Reads the session cookie and returns the signed-in user, or null.
export async function currentUser(cookieHeader) {
  const raw = String(cookieHeader ?? '').split(/;\s*/).find(c => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!raw) return null;
  const [payload, sig] = raw.split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!data.exp || data.exp < Date.now()) return null;
  const user = await findUser(data.uid);
  if (!user || (user.passwordVersion ?? 1) !== data.pv) return null;
  return user;
}
