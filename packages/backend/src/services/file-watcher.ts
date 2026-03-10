import type { FileNode, FileChangeEvent } from '@taskflow/shared';
import { readdir, stat } from 'fs/promises';
import { join, basename } from 'path';

const IGNORED = new Set([
  'node_modules', '.git', '.worktrees', 'dist', '.next', '.superpowers',
]);

interface SnapshotEntry {
  type: FileNode['type'];
  mtimeMs: number;
  size: number;
}

interface PollingWatcher {
  interval: ReturnType<typeof setInterval>;
  snapshot: Map<string, SnapshotEntry>;
  scanning: boolean;
}

export class FileWatcher {
  private watchers = new Map<string, PollingWatcher>();

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

  private async snapshotPath(
    targetPath: string,
    entries = new Map<string, SnapshotEntry>(),
    depth = 0,
  ): Promise<Map<string, SnapshotEntry>> {
    try {
      const info = await stat(targetPath);
      if (info.isDirectory()) {
        entries.set(targetPath, {
          type: 'directory',
          mtimeMs: info.mtimeMs,
          size: info.size,
        });
        if (depth > 10) {
          return entries;
        }

        for (const entry of await readdir(targetPath, { withFileTypes: true })) {
          if (IGNORED.has(entry.name)) continue;
          await this.snapshotPath(join(targetPath, entry.name), entries, depth + 1);
        }
        return entries;
      }

      entries.set(targetPath, {
        type: 'file',
        mtimeMs: info.mtimeMs,
        size: info.size,
      });
    } catch {
      // Ignore paths that disappear between scans.
    }

    return entries;
  }

  private emitDiff(
    previous: Map<string, SnapshotEntry>,
    next: Map<string, SnapshotEntry>,
    onChange: (event: FileChangeEvent) => void,
  ): void {
    for (const [path, entry] of next) {
      const prior = previous.get(path);
      if (!prior) {
        onChange({ type: 'create', path });
        continue;
      }

      if (
        entry.type === 'file'
        && prior.type === 'file'
        && (entry.mtimeMs !== prior.mtimeMs || entry.size !== prior.size)
      ) {
        onChange({ type: 'modify', path });
      }
    }

    for (const [path] of previous) {
      if (!next.has(path)) {
        onChange({ type: 'delete', path });
      }
    }
  }

  async watch(dirPath: string, onChange: (event: FileChangeEvent) => void): Promise<void> {
    this.stop(dirPath);
    const initialSnapshot = await this.snapshotPath(dirPath);
    const watcher: PollingWatcher = {
      interval: setInterval(async () => {
        if (watcher.scanning) {
          return;
        }

        watcher.scanning = true;
        try {
          const nextSnapshot = await this.snapshotPath(dirPath);
          this.emitDiff(watcher.snapshot, nextSnapshot, onChange);
          watcher.snapshot = nextSnapshot;
        } finally {
          watcher.scanning = false;
        }
      }, 250),
      snapshot: initialSnapshot,
      scanning: false,
    };

    this.watchers.set(dirPath, watcher);
  }

  stop(dirPath: string): void {
    const w = this.watchers.get(dirPath);
    if (w) {
      clearInterval(w.interval);
      this.watchers.delete(dirPath);
    }
  }

  stopAll(): void {
    for (const [path] of this.watchers) this.stop(path);
  }
}
