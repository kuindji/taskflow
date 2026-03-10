import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('backend startup', () => {
  it('exits non-zero when startup fails after the server starts', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'taskflow-home-'));

    try {
      const proc = Bun.spawn({
        cmd: [process.execPath, 'run', 'src/index.ts'],
        cwd: join(import.meta.dir, '..'),
        env: {
          ...process.env,
          HOME: homeDir,
          TASKFLOW_PORT_FILE: '/',
        },
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const exitCode = await Promise.race([
        proc.exited,
        new Promise<number>((resolve) => {
          setTimeout(() => resolve(-1), 3000);
        }),
      ]);

      if (exitCode === -1) {
        proc.kill();
        throw new Error('backend process did not exit after startup failure');
      }

      expect(exitCode).toBe(1);
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });
});
