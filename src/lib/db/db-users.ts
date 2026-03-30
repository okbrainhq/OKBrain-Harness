import { DbWrapper, User } from './db-types';

export async function createUser(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  id: string,
  email: string,
  passwordHashed: string
): Promise<User> {
  await ensureInitialized();
  await dbWrapper.prepare(`
    INSERT INTO users (id, email, password) VALUES (?, ?, ?)
  `).run(id, email, passwordHashed);

  return (await getUserById(dbWrapper, ensureInitialized, id))!;
}

export async function getUserById(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  id: string
): Promise<User | null> {
  await ensureInitialized();
  const result = await dbWrapper.prepare("SELECT id, email, created_at, updated_at FROM users WHERE id = ?").get(id);
  return (result as User | undefined) || null;
}

export async function getUserByEmail(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  email: string
): Promise<(User & { password?: string }) | null> {
  await ensureInitialized();
  const result = await dbWrapper.prepare("SELECT * FROM users WHERE email = ?").get(email);
  return (result as (User & { password?: string }) | undefined) || null;
}
