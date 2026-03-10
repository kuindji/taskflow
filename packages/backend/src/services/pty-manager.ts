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

interface BunTerminal {
  write(data: string): void;
}

interface Session {
  proc: Subprocess;
  terminal: BunTerminal;
}

function buildShellPath(): string {
  const home = process.env.HOME ?? '';
  const extraPaths = [
    `${home}/.local/bin`,
    `${home}/.bun/bin`,
    `${home}/.cargo/bin`,
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
  ];
  const currentPath = process.env.PATH ?? '';
  const parts = currentPath.split(':');
  const seen = new Set(parts);
  for (const p of extraPaths) {
    if (!seen.has(p)) {
      parts.push(p);
      seen.add(p);
    }
  }
  return parts.join(':');
}

export class PtyManager {
  private sessions = new Map<string, Session>();

  spawn(options: SpawnOptions): string {
    const id = randomUUID();
    const {
      CLAUDECODE: _a,
      CLAUDE_CODE_ENTRYPOINT: _b,
      ...cleanEnv
    } = process.env;
    const cols = options.cols ?? 120;
    const rows = options.rows ?? 40;

    const decoder = new TextDecoder();
    let terminal: BunTerminal | null = null;

    // @ts-expect-error — Bun's terminal option is not yet in the TypeScript types
    const proc = Bun.spawn([options.command, ...options.args], {
      cwd: options.cwd,
      env: {
        ...cleanEnv,
        PATH: buildShellPath(),
        TERM: 'xterm-256color',
        ...options.env,
      },
      terminal: {
        rows,
        columns: cols,
        data: (term: BunTerminal, data: Uint8Array) => {
          terminal = term;
          options.onData(decoder.decode(data));
        },
      },
    }) as Subprocess;

    void proc.exited.then((exitCode) => {
      this.sessions.delete(id);
      options.onExit(exitCode);
    });

    // Store a lazy terminal reference — it's set on first data callback
    const sessionEntry: Session = {
      proc,
      get terminal() {
        return terminal!;
      },
    };

    this.sessions.set(id, sessionEntry);
    return id;
  }

  write(id: string, data: string): void {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Session not found: ${id}`);
    session.terminal?.write(data);
  }

  resize(_id: string, _cols: number, _rows: number): void {
    // Bun's terminal option does not yet support dynamic resize.
  }

  close(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
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
