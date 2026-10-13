import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { createPinnedDispatcher, TargetValidationError, validateTargetUrl } from '../src/security/target-url.js';

const publicAnswers = async () => [{ address: '93.184.216.34', family: 4 }];

describe('target URL safety', () => {
  it('accepts a hostname only when every resolved address is public', async () => {
    const result = await validateTargetUrl('https://api.example.com/status', publicAnswers);

    expect(result.url.href).toBe('https://api.example.com/status');
    expect(result.addresses).toEqual([{ address: '93.184.216.34', family: 4 }]);
  });

  it('rejects local hostnames before DNS lookup', async () => {
    let lookedUp = false;

    await expect(validateTargetUrl('http://localhost:8080/health', async () => {
      lookedUp = true;
      return publicAnswers();
    })).rejects.toMatchObject({ code: 'UNSAFE_TARGET' });

    expect(lookedUp).toBe(false);
  });

  it.each([
    'http://127.0.0.1/',
    'http://2130706433/',
    'http://0x7f000001/',
    'http://100.64.0.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::ffff:127.0.0.1]/',
    'http://[fd00::1]/'
  ])('rejects non-public IP literal %s', async (url) => {
    await expect(validateTargetUrl(url)).rejects.toMatchObject({ code: 'UNSAFE_TARGET' });
  });

  it('rejects a mixed public and private DNS answer set', async () => {
    await expect(validateTargetUrl('https://api.example.com', async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '10.20.30.40', family: 4 }
    ])).rejects.toBeInstanceOf(TargetValidationError);
  });

  it('pins the Node fetch connection to the supplied address list', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { connection: 'close' });
      response.end('local fixture');
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });

    const { port } = server.address();
    const dispatcher = createPinnedDispatcher('pulsecheck.fixture.invalid', [
      { address: '127.0.0.1', family: 4 }
    ]);

    try {
      const response = await fetch(`http://pulsecheck.fixture.invalid:${port}/`, {
        dispatcher,
        signal: AbortSignal.timeout(1000)
      });
      expect(response.status).toBe(200);
      await response.body.cancel();
    } finally {
      await dispatcher.close();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
