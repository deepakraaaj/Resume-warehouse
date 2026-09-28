// npm run add-user -- someone@example.com "Their Name"
// Creates an account and prints a temporary password; they must choose their own on first sign-in.
import crypto from 'node:crypto';
import { createUser, loadUsers } from '../lib/auth.mjs';

const [email, ...nameParts] = process.argv.slice(2);
if (!email) {
  const users = await loadUsers();
  console.log(users.length ? users.map(u => `${u.email}  (${u.name}, since ${u.createdAt.slice(0, 10)})`).join('\n') : 'No accounts yet.');
  console.log('\nUsage: npm run add-user -- someone@example.com "Their Name"');
  process.exit(0);
}
const password = crypto.randomBytes(12).toString('base64url');
const user = await createUser({ email, name: nameParts.join(' '), password });
console.log(`Created ${user.email} (${user.id}).`);
console.log(`Temporary password: ${password}`);
console.log('They will be asked to choose a new password when they first sign in.');
