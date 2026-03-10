import type { Server, ServerWebSocket } from 'bun';
import type { WsRequest, WsResponse, WsEvent } from '@taskflow/shared';
import type { ApiRouter } from '../api/router';
import { Router } from './router';

export function createServer(
  router: Router,
  port: number = 0,
  apiRouter?: ApiRouter,
): {
  start(): Promise<{ port: number; stop(): void }>;
  broadcast(event: WsEvent): void;
} {
  let server: Server;
  const clients = new Set<ServerWebSocket<unknown>>();

  function broadcast(event: WsEvent): void {
    const data = JSON.stringify(event);
    for (const ws of clients) {
      ws.send(data);
    }
  }

  async function start() {
    server = Bun.serve({
      port,
      async fetch(req, server) {
        if (server.upgrade(req)) return;
        if (apiRouter) {
          const response = await apiRouter.handle(req);
          if (response) return response;
        }
        return new Response('Taskflow backend', { status: 200 });
      },
      websocket: {
        open(ws) {
          clients.add(ws);
        },
        close(ws) {
          clients.delete(ws);
        },
        async message(ws, message) {
          const raw =
            typeof message === 'string'
              ? message
              : new TextDecoder().decode(message);
          let request: WsRequest;
          try {
            request = JSON.parse(raw);
          } catch {
            ws.send(JSON.stringify({ error: 'Invalid JSON' }));
            return;
          }

          try {
            const result = await router.handle(request.type, request.payload);
            if (!request.correlationId) return;
            const response: WsResponse = {
              correlationId: request.correlationId,
              type: request.type,
              payload: result,
            };
            ws.send(JSON.stringify(response));
          } catch (err) {
            if (!request.correlationId) return;
            const response: WsResponse = {
              correlationId: request.correlationId,
              type: request.type,
              payload: null,
              error: err instanceof Error ? err.message : 'Unknown error',
            };
            ws.send(JSON.stringify(response));
          }
        },
      },
    });

    return {
      port: server.port,
      stop() {
        server.stop();
      },
    };
  }

  return { start, broadcast };
}
