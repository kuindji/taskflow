import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { GitService } from '../../src/services/git-service';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

async function run(args: string[], cwd: string): Promise<void> {
  const proc = Bun.spawn(args, { cwd, stdout: 'pipe', stderr: 'pipe' });
  await proc.exited;
}

describe('GitService', () => {
  let git: GitService;
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await mkdtemp(join(tmpdir(), 'taskflow-git-test-'));
    await run(['git', 'init'], repoDir);
    await run(['git', 'config', 'user.email', 'test@test.com'], repoDir);
    await run(['git', 'config', 'user.name', 'Test'], repoDir);
    await writeFile(join(repoDir, 'initial.txt'), 'initial content');
    await run(['git', 'add', '.'], repoDir);
    await run(['git', 'commit', '-m', 'initial'], repoDir);
    git = new GitService();
  });

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true });
  });

  it('gets status of clean repo', async () => {
    const status = await git.status(repoDir);
    expect(status.branch).toBeTruthy();
    expect(status.files).toHaveLength(0);
  });

  it('detects modified files', async () => {
    await writeFile(join(repoDir, 'initial.txt'), 'modified');
    const status = await git.status(repoDir);
    expect(status.files).toHaveLength(1);
    expect(status.files[0].status).toBe('modified');
  });

  it('detects new untracked files', async () => {
    await writeFile(join(repoDir, 'new.txt'), 'new file');
    const status = await git.status(repoDir);
    expect(status.files).toHaveLength(1);
    expect(status.files[0].status).toBe('untracked');
  });

  it('gets diff', async () => {
    await writeFile(join(repoDir, 'initial.txt'), 'modified content');
    const diff = await git.diff(repoDir);
    expect(diff.files).toHaveLength(1);
    expect(diff.files[0].diff).toContain('modified content');
  });

  it('throws when the path is not a git repository', async () => {
    const nonRepoDir = await mkdtemp(join(tmpdir(), 'taskflow-git-nonrepo-'));
    await expect(git.status(nonRepoDir)).rejects.toThrow();
    await rm(nonRepoDir, { recursive: true, force: true });
  });

  it('reverts a modified file', async () => {
    await writeFile(join(repoDir, 'initial.txt'), 'modified');
    await git.revertFile(repoDir, { path: 'initial.txt', status: 'modified' });
    const status = await git.status(repoDir);
    expect(status.files).toHaveLength(0);
  });

  it('parses renamed files with spaces using porcelain -z metadata', async () => {
    await run(['git', 'mv', 'initial.txt', 'renamed file.txt'], repoDir);
    const status = await git.status(repoDir);
    expect(status.files).toHaveLength(1);
    expect(status.files[0]).toMatchObject({
      status: 'renamed',
      path: 'renamed file.txt',
      previousPath: 'initial.txt',
    });
  });

  it('reverts an untracked file by removing it', async () => {
    await writeFile(join(repoDir, 'scratch.txt'), 'temporary');
    await git.revertFile(repoDir, { path: 'scratch.txt', status: 'untracked' });
    const status = await git.status(repoDir);
    expect(status.files).toHaveLength(0);
  });

  it('reverts a renamed file', async () => {
    await run(['git', 'mv', 'initial.txt', 'renamed file.txt'], repoDir);
    await git.revertFile(repoDir, {
      path: 'renamed file.txt',
      previousPath: 'initial.txt',
      status: 'renamed',
    });
    const status = await git.status(repoDir);
    expect(status.files).toHaveLength(0);
  });

  it('reverts a staged new file', async () => {
    await writeFile(join(repoDir, 'staged.txt'), 'new content');
    await run(['git', 'add', 'staged.txt'], repoDir);
    await git.revertFile(repoDir, { path: 'staged.txt', status: 'new' });
    const status = await git.status(repoDir);
    expect(status.files).toHaveLength(0);
  });

  it('creates a worktree', async () => {
    const wtPath = join(repoDir, '.worktrees', 'test-branch');
    await git.createWorktree(repoDir, 'test-branch', wtPath);
    const status = await git.status(wtPath);
    expect(status.branch).toBe('test-branch');
    // Cleanup
    await run(['git', 'worktree', 'remove', wtPath], repoDir);
  });
});
