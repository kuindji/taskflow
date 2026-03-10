import { describe, it, expect, afterEach } from 'bun:test';
import { FileWatcher } from '../../src/services/file-watcher';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('FileWatcher', () => {
  let watcher: FileWatcher;
  let tempDir: string;

  afterEach(async () => {
    watcher?.stopAll();
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  it('builds a file tree', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'taskflow-fw-test-'));
    await writeFile(join(tempDir, 'file1.ts'), 'content');
    await mkdir(join(tempDir, 'src'));
    await writeFile(join(tempDir, 'src', 'file2.ts'), 'content');

    watcher = new FileWatcher();
    const tree = await watcher.buildTree(tempDir);

    expect(tree.type).toBe('directory');
    expect(tree.children!.length).toBeGreaterThanOrEqual(2);

    const srcDir = tree.children!.find((c) => c.name === 'src');
    expect(srcDir).toBeTruthy();
    expect(srcDir!.children!).toHaveLength(1);
  });

  it('excludes node_modules and .git', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'taskflow-fw-test-'));
    await mkdir(join(tempDir, 'node_modules'));
    await writeFile(join(tempDir, 'node_modules', 'pkg.js'), 'x');
    await mkdir(join(tempDir, '.git'));
    await writeFile(join(tempDir, '.git', 'config'), 'x');
    await writeFile(join(tempDir, '.gitignore'), 'dist\n');
    await writeFile(join(tempDir, 'real.ts'), 'x');

    watcher = new FileWatcher();
    const tree = await watcher.buildTree(tempDir);

    const names = tree.children!.map((c) => c.name);
    expect(names).not.toContain('node_modules');
    expect(names).not.toContain('.git');
    expect(names).toContain('.gitignore');
    expect(names).toContain('real.ts');
  });

  it('watches for file changes', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'taskflow-fw-test-'));
    watcher = new FileWatcher();

    const changes: string[] = [];
    await watcher.watch(tempDir, (event) => { changes.push(event.path); });
    await writeFile(join(tempDir, 'new-file.ts'), 'hello');

    const started = Date.now();
    while (changes.length === 0 && Date.now() - started < 2000) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    expect(changes.length).toBeGreaterThanOrEqual(1);
  });
});
