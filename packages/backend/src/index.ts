import { ensureDirectories } from './config';

async function main() {
  await ensureDirectories();
  console.log('Taskflow backend starting...');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
