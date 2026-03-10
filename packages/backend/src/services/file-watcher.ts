import type { FileNode, FileChangeEvent } from '@taskflow/shared';
import { readdir } from 'fs/promises';
import { join, basename } from 'path';
import { watch } from 'chokidar';
import type { FSWatcher } from 'chokidar';

const IGNORED = new Set([
  'node_modules', '.git', '.worktrees', 'dist', '.next', '.superpowers',
]);

export class FileWatcher {
  private watchers = new Map<string, FSWatcher>();

  async buildTree(dirPath: string, depth = 0): Promise<FileNode> {
    const name = basename(dirPath);
    const node: FileNode = { name, path: dirPath, type: 'directory', children: [] };
    if (depth > 10) return node;

    try {
      const entries = await readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (IGNORED.has(entry.name)) continue;

        const fullPath = join(dirPath, entry.name);
        if (entry.isDirectory()) {
          node.children!.push(await this.buildTree(fullPath, depth + 1));
        } else {
          node.children!.push({ name: entry.name, path: fullPath, type: 'file' });
        }
      }
      node.children!.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    } catch { /* permission denied */ }

    return node;
  }

  watch(dirPath: string, onChange: (event: FileChangeEvent) => void): void {
    this.stop(dirPath);
    const watcher = watch(dirPath, {
      ignored: [...IGNORED].map((i) => `**/${i}/**`),
      ignoreInitial: true,
      persistent: true,
    });
    watcher.on('add', (path) => onChange({ type: 'create', path }));
    watcher.on('change', (path) => onChange({ type: 'modify', path }));
    watcher.on('unlink', (path) => onChange({ type: 'delete', path }));
    this.watchers.set(dirPath, watcher);
  }

  stop(dirPath: string): void {
    const w = this.watchers.get(dirPath);
    if (w) { w.close(); this.watchers.delete(dirPath); }
  }

  stopAll(): void {
    for (const [path] of this.watchers) this.stop(path);
  }
}
