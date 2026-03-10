import { ensureDirectories } from './config';

async function main() {
  await ensureDirectories();
  console.log('Taskflow backend starting...');
}

main().catch(console.error);
