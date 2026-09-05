import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

import { createMihomoTestReadiness } from './mihomo-test-readiness.mjs';

const subscription = JSON.parse(await readFile('/test/subscription-proxies.json', 'utf8'));
const allocator = createServer();
allocator.listen(0, '127.0.0.1');
await once(allocator, 'listening');
const port = allocator.address().port;
await new Promise((resolve) => allocator.close(resolve));
const readiness = await createMihomoTestReadiness();
let child;
let exited;
try {
    await mkdir('/test/native-client', { mode: 0o700 });
    // Only local frontend/DNS/rule settings are fixture-owned. Every encrypted
    // proxy and its internal dependency comes unchanged from the real panel.
    await writeFile(
        '/test/native-client/client.json',
        JSON.stringify({
            mode: 'rule',
            'log-level': 'warning',
            'mixed-port': port,
            'bind-address': '127.0.0.1',
            'geo-auto-update': false,
            dns: { enable: false },
            proxies: subscription.proxies,
            rules: [readiness.rule, `MATCH,${subscription.selected}`],
        }),
        { mode: 0o600, flag: 'wx' },
    );
    child = spawn(
        '/usr/local/bin/rw-anytls-outer',
        ['-d', '/test/native-client', '-f', '/test/native-client/client.json'],
        { stdio: 'ignore', env: { PATH: process.env.PATH } },
    );
    exited = new Promise((resolve) => {
        child.once('exit', resolve);
        child.once('error', resolve);
    });
    await readiness.wait(port, () => child.exitCode === null);
    await new Promise((resolve, reject) => {
        const req = request(
            {
                hostname: '127.0.0.1',
                port,
                path: 'http://example.com/',
                headers: { Host: 'example.com', Connection: 'close' },
                timeout: 30000,
            },
            (res) => {
                let body = '';
                res.on('data', (chunk) => {
                    body += chunk;
                    if (body.length > 1024 * 1024)
                        req.destroy(new Error('Oversized public target response'));
                });
                res.on('error', reject);
                res.on('end', () => {
                    try {
                        assert.equal(res.statusCode, 200);
                        assert.match(body, /Example Domain/);
                        resolve();
                    } catch (error) {
                        reject(error);
                    }
                });
            },
        );
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('Native subscription request deadline')));
        req.end();
    });
    process.stdout.write(
        'PASS: unmodified real-panel encrypted proxy bundle carries native Mihomo TCP traffic through shared 443\n',
    );
} finally {
    if (child && child.exitCode === null) {
        child.kill('SIGTERM');
        await Promise.race([exited, delay(3000)]);
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        await exited;
    }
    await readiness.close();
}
