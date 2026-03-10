import { describe, it, expect } from 'bun:test';
import { Router } from '../../src/ws/router';

describe('Router', () => {
  it('routes messages to registered handlers', async () => {
    const router = new Router();
    let received: unknown = null;

    router.register('test:echo', async (payload) => {
      received = payload;
      return { echo: payload };
    });

    const result = await router.handle('test:echo', { msg: 'hello' });
    expect(received).toEqual({ msg: 'hello' });
    expect(result).toEqual({ echo: { msg: 'hello' } });
  });

  it('throws on unregistered message type', async () => {
    const router = new Router();
    expect(router.handle('unknown:type', {})).rejects.toThrow(
      'No handler for message type: unknown:type',
    );
  });
});
