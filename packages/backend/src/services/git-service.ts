import type { GitStatusResult, GitFileStatus, GitDiffResult, GitDiffFile } from '@taskflow/shared';
import { mkdir, rm } from 'fs/promises';
import { dirname, join } from 'path';

async function git(args: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      stderr.trim()
        || stdout.trim()
        || `git ${args.join(' ')} failed with exit code ${exitCode}`,
    );
  }
  return stdout.trim();
}

export class GitService {
  async status(repoPath: string): Promise<GitStatusResult> {
    const branchOutput = await git(['branch', '--show-current'], repoPath);
    // Use the NUL-delimited porcelain format so paths are machine-safe even when
    // rename targets contain spaces or other escaped characters.
    const statusOutput = await git(['status', '--porcelain=v1', '-z'], repoPath);

    const files: GitFileStatus[] = [];
    const entries = statusOutput.split('\0').filter((entry) => entry.length > 0);

    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const xy = entry.substring(0, 2);
      const path = entry.substring(3);
      let previousPath: string | undefined;

      if (xy.includes('R')) {
        previousPath = entries[index + 1];
        if (!previousPath) {
          throw new Error('Malformed git status output: rename entry missing previous path');
        }
        index += 1;
      }

      files.push({
        path,
        absolutePath: join(repoPath, path),
        previousPath,
        status: this.parseStatus(xy),
      });
    }

    return { branch: branchOutput || null, files };
  }

  private parseStatus(xy: string): GitFileStatus['status'] {
    if (xy === '??') return 'untracked';
    if (xy.includes('A')) return 'new';
    if (xy.includes('D')) return 'deleted';
    if (xy.includes('R')) return 'renamed';
    return 'modified';
  }

  async diff(repoPath: string): Promise<GitDiffResult> {
    const numstat = await git(['diff', '--numstat'], repoPath);
    const files: GitDiffFile[] = [];

    for (const line of numstat.split('\n')) {
      if (!line.trim()) continue;
      const [add, del, path] = line.split('\t');
      const fileDiff = await this.diffFile(repoPath, path);
      files.push({
        path,
        additions: parseInt(add) || 0,
        deletions: parseInt(del) || 0,
        diff: fileDiff,
      });
    }

    return { files };
  }

  async diffFile(repoPath: string, filePath: string): Promise<string> {
    return git(['diff', '--', filePath], repoPath);
  }

  async revertFile(
    repoPath: string,
    file: Pick<GitFileStatus, 'path' | 'status' | 'previousPath'>,
  ): Promise<void> {
    if (file.status === 'untracked') {
      await rm(join(repoPath, file.path), { recursive: true, force: true });
      return;
    }
    if (file.status === 'new') {
      await git(['rm', '-f', '--', file.path], repoPath);
      return;
    }

    const paths = file.status === 'renamed' && file.previousPath
      ? [file.previousPath, file.path]
      : [file.path];

    await git(['restore', '--source=HEAD', '--staged', '--worktree', '--', ...paths], repoPath);
  }

  async createWorktree(repoPath: string, branch: string, worktreePath: string): Promise<void> {
    await mkdir(dirname(worktreePath), { recursive: true });
    await git(['worktree', 'add', '-b', branch, worktreePath], repoPath);
  }
}
