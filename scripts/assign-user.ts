import { loadEnvConfig } from '@next/env';
import { getUserByEmail } from '../src/lib/db';

async function main() {
  // Load environment variables from .env* files
  loadEnvConfig(process.cwd());

  const email = process.argv[2];

  if (!email) {
    console.error('Usage: npx tsx scripts/assign-user.ts <email>');
    process.exit(1);
  }

  try {
    // Dynamically import db after env vars are loaded to ensure connection config is ready
    const { assignOrphanedDataToUser, getUserByEmail } = await import('../src/lib/db');

    console.log(`Looking up user by email: ${email}...`);
    const user = await getUserByEmail(email);

    if (!user) {
      console.error(`Error: User with email '${email}' not found.`);
      process.exit(1);
    }

    console.log(`Found user: ${user.id}`);
    console.log('Assigning orphaned data...');

    const result = await assignOrphanedDataToUser(user.id);

    console.log('Migration complete:');
    console.log(`- Folders updated: ${result.folders}`);
    console.log(`- Conversations updated: ${result.conversations}`);
    console.log(`- Documents updated: ${result.documents}`);

  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

main();
