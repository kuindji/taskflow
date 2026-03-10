import { randomUUID } from 'crypto';
import type { Subprocess } from 'bun';

interface SpawnOptions {
  command: string;
  args: string[];
  cwd: string;
  onData: (data: string) => void;
  onExit: (exitCode: number) => void;
  cols?: number;
  rows?: number;
  env?: Record<string, string>;
}

interface Session {
  proc: Subprocess;
  abortReader: AbortController;
}

// Note: node-pty is incompatible with Bun (posix_spawnp fails).
// This implementation uses Bun.spawn with piped stdin/stdout as a fallback.
// Terminal features like resize and color support are limited.
export class PtyManager {
  private sessions = new Map<string, Session>();

  spawn(options: SpawnOptions): string {
    const id = randomUUID();
    const proc = Bun.spawn([options.command, ...options.args], {
      cwd: options.cwd,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, ...options.env },
    });

    const abortReader = new AbortController();

    const readStream = async (
      stream: ReadableStream<Uint8Array> | null,
    ) => {
      if (!stream) return;
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      try {
        while (!abortReader.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          options.onData(decoder.decode(value, { stream: true }));
        }
      } catch {
        // Stream closed or aborted
      } finally {
        reader.releaseLock();
      }
    };

    void readStream(proc.stdout as ReadableStream<Uint8Array> | null);
    void readStream(proc.stderr as ReadableStream<Uint8Array> | null);

    void proc.exited.then((exitCode) => {
      this.sessions.delete(id);
      options.onExit(exitCode);
    });

    this.sessions.set(id, { proc, abortReader });
    return id;
  }

  write(id: string, data: string): void {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Session not found: ${id}`);
    session.proc.stdin?.write(data);
  }

  resize(_id: string, _cols: number, _rows: number): void {
    // Resize is not supported with Bun.spawn (no PTY).
    // This is a no-op until node-pty compatibility is resolved.
  }

  close(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.abortReader.abort();
      session.proc.kill();
      this.sessions.delete(id);
    }
  }

  closeAll(): void {
    for (const [id] of this.sessions) {
      this.close(id);
    }
  }

  list(): string[] {
    return Array.from(this.sessions.keys());
  }

  has(id: string): boolean {
    return this.sessions.has(id);
  }
}
