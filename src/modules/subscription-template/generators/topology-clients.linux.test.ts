import { dump, load } from 'js-yaml';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net, { type Socket } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { SocksProxyAgent } from 'socks-proxy-agent';

import { MihomoGeneratorService } from './mihomo.generator.service';
import { SingBoxGeneratorService } from './singbox.generator.service';
import { bound, id } from './topology-test-fixtures';

const enabled = process.platform === 'linux' && process.env.RW_TOPOLOGY_INTEGRATION === '1';

async function listen(server: net.Server): Promise<number> {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return (server.address() as net.AddressInfo).port;
}

async function readExactly(socket: Socket, length: number): Promise<Buffer> {
    while (true) {
        const data = socket.read(length) as Buffer | null;
        if (data) return data;
        if (socket.destroyed || socket.readableEnded) throw new Error('SOCKS socket closed');
        await new Promise<void>((resolve, reject) => {
            const cleanup = () => {
                socket.off('readable', readable);
                socket.off('error', error);
                socket.off('close', closed);
                socket.off('end', closed);
            };
            const readable = () => {
                cleanup();
                resolve();
            };
            const error = (err: Error) => {
                cleanup();
                reject(err);
            };
            const closed = () => error(new Error('SOCKS socket closed'));
            socket.once('readable', readable);
            socket.once('error', error);
            socket.once('close', closed);
            socket.once('end', closed);
        });
    }
}

// Real authenticated SOCKS fixtures, each with its own listener and credentials.
// They can reach only this test's explicitly allocated loopback ports.
async function socksFixture(number: number, allowedPorts: Set<number>) {
    const connections: number[] = [];
    const sockets = new Set<Socket>();
    const track = (socket: Socket) => {
        sockets.add(socket);
        socket.on('error', () => {});
        socket.once('close', () => sockets.delete(socket));
        socket.setTimeout(10_000, () => socket.destroy());
        return socket;
    };
    const server = net.createServer((client) => {
        track(client);
        void (async () => {
            const greeting = await readExactly(client, 2);
            assert.equal(greeting[0], 5);
            assert.ok((await readExactly(client, greeting[1])).includes(2));
            client.write(Buffer.from([5, 2]));
            const auth = await readExactly(client, 2);
            assert.equal(auth[0], 1);
            const username = (await readExactly(client, auth[1])).toString();
            const passwordLength = (await readExactly(client, 1))[0];
            const password = (await readExactly(client, passwordLength)).toString();
            if (username !== `user-${number}` || password !== `private-${number}`) {
                client.end(Buffer.from([1, 1]));
                return;
            }
            client.write(Buffer.from([1, 0]));
            const request = await readExactly(client, 4);
            assert.equal(request[0], 5);
            assert.equal(request[1], 1);
            let address: string;
            if (request[3] === 1) address = [...(await readExactly(client, 4))].join('.');
            else if (request[3] === 3) {
                address = (await readExactly(client, (await readExactly(client, 1))[0])).toString();
            } else throw new Error('Only IPv4/domain requests are allowed in this fixture');
            const port = (await readExactly(client, 2)).readUInt16BE();
            assert.equal(address, '127.0.0.1');
            assert.ok(allowedPorts.has(port));
            const upstream = track(net.connect({ host: '127.0.0.1', port }));
            await once(upstream, 'connect');
            connections.push(port);
            client.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
            client.pipe(upstream).pipe(client);
            client.once('close', () => upstream.destroy());
            upstream.once('close', () => client.destroy());
        })().catch(() => client.destroy());
    });
    const port = await listen(server);
    allowedPorts.add(port);
    return {
        port,
        connections,
        async close() {
            for (const socket of sockets) socket.destroy();
            await new Promise<void>((resolve) => server.close(() => resolve()));
        },
    };
}

async function stop(child: ChildProcess) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    if (!(await Promise.race([exited.then(() => true), delay(3_000).then(() => false)]))) {
        child.kill('SIGKILL');
        await exited;
    }
}

async function waitForPort(port: number, child: ChildProcess) {
    for (let attempt = 0; attempt < 100; attempt++) {
        if (child.exitCode !== null || child.signalCode !== null) throw new Error('Client exited');
        const ready = await new Promise<boolean>((resolve) => {
            const socket = net.connect({ host: '127.0.0.1', port });
            socket.once('connect', () => {
                socket.destroy();
                resolve(true);
            });
            socket.once('error', () => {
                socket.destroy();
                resolve(false);
            });
        });
        if (ready) return;
        await delay(100);
    }
    throw new Error('Client listener did not become ready');
}

async function requestThrough(port: number, target: number): Promise<string> {
    const agent = new SocksProxyAgent(`socks5://127.0.0.1:${port}`);
    try {
        return await new Promise<string>((resolve, reject) => {
            const request = http.get(
                `http://127.0.0.1:${target}/topology`,
                {
                    agent,
                    headers: { Connection: 'close' },
                },
                (response) => {
                    const chunks: Buffer[] = [];
                    response.on('data', (chunk: Buffer) => chunks.push(chunk));
                    response.once('error', reject);
                    response.once('end', () => {
                        if (response.statusCode !== 200)
                            reject(new Error(`HTTP ${response.statusCode}`));
                        else resolve(Buffer.concat(chunks).toString());
                    });
                },
            );
            request.setTimeout(10_000, () => request.destroy(new Error('HTTP timeout')));
            request.once('error', reject);
        });
    } finally {
        agent.destroy();
    }
}

for (const scenario of [
    { format: 'MIHOMO', balanced: false },
    { format: 'MIHOMO', balanced: true },
    { format: 'SINGBOX', balanced: false },
] as const) {
    test(
        `real ${scenario.format} subscription follows ${scenario.balanced ? 'two balanced entries into one exit' : 'A → B → destination'}`,
        {
            skip: !enabled,
            timeout: 90_000,
        },
        async () => {
            const binary =
                process.env[
                    scenario.format === 'MIHOMO' ? 'RW_MIHOMO_BINARY' : 'RW_SINGBOX_BINARY'
                ];
            assert.ok(binary, 'A checksum-verified official binary is required');
            const directory = await mkdtemp(path.join(os.tmpdir(), 'rw-topology-client-'));
            const allowedPorts = new Set<number>();
            const echo = http.createServer((_request, response) => response.end('topology-ok'));
            const targetPort = await listen(echo);
            allowedPorts.add(targetPort);
            const fixtures: Awaited<ReturnType<typeof socksFixture>>[] = [];
            let child: ChildProcess | undefined;
            let logs = '';
            try {
                for (let n = 1; n <= (scenario.balanced ? 3 : 2); n++)
                    fixtures.push(await socksFixture(n, allowedPorts));
                const item = bound(scenario.balanced);
                fixtures.forEach((fixture, index) => {
                    item.hosts.get(id(index + 1))!.port = fixture.port;
                });
                const placeholder = net.createServer();
                const clientPort = await listen(placeholder);
                await new Promise<void>((resolve) => placeholder.close(() => resolve()));
                const templates = {
                    async getCachedTemplateByType() {
                        return scenario.format === 'MIHOMO'
                            ? {
                                  'socks-port': clientPort,
                                  'bind-address': '127.0.0.1',
                                  'allow-lan': false,
                                  'log-level': 'info',
                                  proxies: [],
                                  'proxy-groups': [{ name: 'Main', type: 'select', proxies: [] }],
                                  rules: ['MATCH,Main'],
                              }
                            : {
                                  log: { level: 'info' },
                                  inbounds: [
                                      {
                                          type: 'socks',
                                          listen: '127.0.0.1',
                                          listen_port: clientPort,
                                      },
                                  ],
                                  outbounds: [{ tag: 'Main', type: 'selector' }],
                                  route: { final: 'Main' },
                              };
                    },
                };
                const hosts = [...item.hosts.values()];
                const text =
                    scenario.format === 'MIHOMO'
                        ? await new MihomoGeneratorService(templates as never).generateConfig(
                              hosts,
                              false,
                              false,
                              undefined,
                              [item],
                          )
                        : await new SingBoxGeneratorService(templates as never).generateConfig(
                              hosts,
                              undefined,
                              [item],
                          );
                const config: any = scenario.format === 'MIHOMO' ? load(text) : JSON.parse(text);
                // Selecting the published virtual node is a client action, not a server-side default change.
                const entry = `${item.topology.name} [${item.topology.uuid}]`;
                if (scenario.format === 'MIHOMO') config.rules = [`MATCH,${entry}`];
                else config.route.final = entry;
                const configPath = path.join(
                    directory,
                    scenario.format === 'MIHOMO' ? 'config.yaml' : 'config.json',
                );
                await writeFile(
                    configPath,
                    scenario.format === 'MIHOMO' ? dump(config) : JSON.stringify(config),
                    { mode: 0o600 },
                );
                const checkArgs =
                    scenario.format === 'MIHOMO'
                        ? ['-t', '-d', directory, '-f', configPath]
                        : ['check', '-c', configPath];
                const check = spawnSync(binary, checkArgs, { encoding: 'utf8', timeout: 20_000 });
                assert.equal(check.status, 0, check.stdout + check.stderr);
                child = spawn(
                    binary,
                    scenario.format === 'MIHOMO'
                        ? ['-d', directory, '-f', configPath]
                        : ['run', '-c', configPath],
                    { stdio: ['ignore', 'pipe', 'pipe'] },
                );
                child.stdout?.on('data', (chunk: Buffer) => {
                    logs += chunk.toString();
                });
                child.stderr?.on('data', (chunk: Buffer) => {
                    logs += chunk.toString();
                });
                await waitForPort(clientPort, child);
                for (let request = 0; request < 8; request++)
                    assert.equal(await requestThrough(clientPort, targetPort), 'topology-ok');
                if (scenario.balanced) {
                    assert.ok(fixtures[0].connections.length > 0, 'Entry A must carry traffic');
                    assert.ok(fixtures[1].connections.length > 0, 'Entry B must carry traffic');
                    assert.equal(
                        fixtures[0].connections.length + fixtures[1].connections.length,
                        8,
                    );
                    for (const port of [...fixtures[0].connections, ...fixtures[1].connections])
                        assert.equal(port, fixtures[2].port);
                    assert.deepEqual(fixtures[2].connections, Array(8).fill(targetPort));
                } else {
                    assert.deepEqual(fixtures[0].connections, Array(8).fill(fixtures[1].port));
                    assert.deepEqual(fixtures[1].connections, Array(8).fill(targetPort));
                }
            } catch (error) {
                throw new Error(`${String(error)}\nClient log:\n${logs}`, { cause: error });
            } finally {
                if (child) await stop(child);
                for (const fixture of fixtures) await fixture.close();
                echo.closeAllConnections();
                await new Promise<void>((resolve) => echo.close(() => resolve()));
                // Exact mkdtemp result, never a caller-provided directory or workspace.
                assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
                assert.ok(path.basename(directory).startsWith('rw-topology-client-'));
                await rm(directory, { recursive: true, force: true });
            }
        },
    );
}
