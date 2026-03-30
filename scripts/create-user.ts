
import { v4 as uuidv4 } from 'uuid';
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());

async function main() {
  const email = process.argv[2];
  const password = process.argv[3];

  if (!email || !password) {
    console.error('Usage: npx tsx scripts/create-user.ts <email> <password>');
    process.exit(1);
  }

  const { createUser, getUserByEmail } = await import('../src/lib/db');
  const { hashPassword } = await import('../src/lib/auth');

  try {
    const existing = await getUserByEmail(email);
    if (existing) {
      console.error(`User with email ${email} already exists. UserId: ${existing.id}`);
      process.exit(1);
    }

    const hashedPassword = await hashPassword(password);
    const userId = uuidv4();

    await createUser(userId, email, hashedPassword);

    console.log(`User created successfully!`);
    console.log(`Email: ${email}`);
    console.log(`UserId: ${userId}`);
    process.exit(0);
  } catch (error) {
    console.error('Error creating user:', error);
    process.exit(1);
  }
}

main();
