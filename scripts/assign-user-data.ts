
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());

async function main() {
  const userId = process.argv[2];

  if (!userId) {
    console.error('Usage: npx tsx scripts/assign-user-data.ts <userId>');
    process.exit(1);
  }

  const { default: dbWrapper } = await import('../src/lib/db');

  try {
    console.log(`Assigning all NULL user_id records to user: ${userId}`);

    // Update conversations
    const convResult = await dbWrapper.prepare(
      'UPDATE conversations SET user_id = ? WHERE user_id IS NULL'
    ).run(userId);
    console.log(`Updated conversations: ${convResult.changes} rows`);

    // Update folders
    const folderResult = await dbWrapper.prepare(
      'UPDATE folders SET user_id = ? WHERE user_id IS NULL'
    ).run(userId);
    console.log(`Updated folders: ${folderResult.changes} rows`);

    // Update documents
    const docResult = await dbWrapper.prepare(
      'UPDATE documents SET user_id = ? WHERE user_id IS NULL'
    ).run(userId);
    console.log(`Updated documents: ${docResult.changes} rows`);

    console.log('Migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Migration error:', error);
    process.exit(1);
  }
}

main();
