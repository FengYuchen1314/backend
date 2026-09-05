import 'reflect-metadata';
import { dump, load } from 'js-yaml';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net, { type Socket } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import tls from 'node:tls';
import { SocksProxyAgent } from 'socks-proxy-agent';

import { anyTlsClientIdentity, issueAnyTlsMaterial } from '@modules/anytls/anytls-identity';

import { createMihomoTestReadiness } from '../../../../scripts/mihomo-test-readiness.mjs';
import { anyTlsHost, anyTlsTemplate, resolveAnyTlsFixture } from './anytls-subscription-fixtures';
import { MihomoGeneratorService } from './mihomo.generator.service';
import { bound, id, proxy } from './topology-test-fixtures';

const enabled = process.platform === 'linux' && process.env.RW_TOPOLOGY_INTEGRATION === '1';
const base = {
    mode: 'rule',
    'log-level': 'warning',
    ipv6: false,
    'geo-auto-update': false,
    profile: { 'store-selected': false, 'store-fake-ip': false },
    dns: { enable: false },
    sniffer: { enable: false },
    rules: ['MATCH,REJECT'],
};

test(
    'generated encrypted AnyTLS subscription with distinct CAs and real Mihomo/sing-box clients',
    { skip: !enabled, timeout: 240000 },
    async (t) => {
        const mihomo = process.env.RW_MIHOMO_BINARY;
        const singbox = process.env.RW_SINGBOX_BINARY;
        assert.ok(mihomo && singbox, 'Use checksum-verified Actions clients');
        const directory = await mkdtemp(path.join(os.tmpdir(), 'rw-anytls-subscription-'));
        const readiness = await createMihomoTestReadiness();
        const sockets = new Set<Socket>();
        const servers = new Set<net.Server>();
        const children = new Set<ChildProcess>();
        const track = (socket: Socket) => {
            sockets.add(socket);
            socket.on('error', () => {});
            socket.once('close', () => sockets.delete(socket));
            return socket;
        };
        const listen = async (server: net.Server) => {
            servers.add(server);
            server.on('connection', track);
            server.listen(0, '127.0.0.1');
            await once(server, 'listening');
            return (server.address() as net.AddressInfo).port;
        };
        const reserve = async () => {
            const server = net.createServer();
            const port = await listen(server);
            await new Promise<void>((resolve) => server.close(() => resolve()));
            servers.delete(server);
            return port;
        };
        const stop = async (child: ChildProcess) => {
            if (!children.has(child)) return;
            const exited = once(child, 'exit');
            child.kill('SIGTERM');
            const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
            try {
                await exited;
            } finally {
                clearTimeout(timer);
                children.delete(child);
            }
        };
        const start = async (
            name: string,
            config: unknown,
            ports: number[],
            inner = false,
            env: NodeJS.ProcessEnv = {},
        ) => {
            const dir = path.join(directory, name);
            await mkdir(dir, { mode: 0o700 });
            const file = path.join(dir, 'config.json');
            await writeFile(file, JSON.stringify(config), { mode: 0o600 });
            const options = {
                env: { ...process.env, ...env },
                encoding: 'utf8' as const,
                timeout: 15000,
            };
            const checked = spawnSync(
                inner ? singbox : mihomo,
                inner ? ['check', '-D', dir, '-c', file] : ['-t', '-d', dir, '-f', file],
                options,
            );
            assert.equal(
                checked.status,
                0,
                `${name} native check failed: ${checked.stderr}${checked.stdout}`,
            );
            const child = spawn(
                inner ? singbox : mihomo,
                inner ? ['run', '-D', dir, '-c', file] : ['-d', dir, '-f', file],
                { env: options.env, stdio: ['ignore', 'pipe', 'pipe'] },
            );
            children.add(child);
            child.once('exit', () => children.delete(child));
            child.on('error', () => {});
            let logs = '';
            for (const stream of [child.stdout, child.stderr])
                stream!.on('data', (chunk) => {
                    logs = (logs + chunk).slice(-10000);
                });
            const deadline = Date.now() + 12000;
            for (const port of ports) {
                while (true) {
                    assert.ok(children.has(child), `${name} exited: ${logs}`);
                    const socket = track(net.connect(port, '127.0.0.1'));
                    try {
                        await once(socket, 'connect');
                        socket.destroy();
                        break;
                    } catch {
                        socket.destroy();
                        assert.ok(Date.now() < deadline, `${name} not ready: ${logs}`);
                        await delay(20);
                    }
                }
            }
            return child;
        };
        const tap = async (target: number) => {
            const packets: { up: Buffer[]; down: Buffer[] }[] = [];
            let bytes = 0;
            const port = await listen(
                net.createServer({ allowHalfOpen: true }, (downstream) => {
                    const upstream = track(
                        net.connect({ host: '127.0.0.1', port: target, allowHalfOpen: true }),
                    );
                    const connection = { up: [] as Buffer[], down: [] as Buffer[] };
                    packets.push(connection);
                    const collect = (direction: 'up' | 'down', chunk: Buffer) => {
                        bytes += chunk.length;
                        if (bytes > 16 * 1024 * 1024) {
                            downstream.destroy();
                            upstream.destroy();
                            return;
                        }
                        connection[direction].push(Buffer.from(chunk));
                    };
                    downstream.on('data', (chunk) => collect('up', chunk));
                    upstream.on('data', (chunk) => collect('down', chunk));
                    downstream.on('error', () => upstream.destroy());
                    upstream.on('error', () => downstream.destroy());
                    downstream.pipe(upstream).pipe(downstream);
                }),
            );
            return { port, packets };
        };
        let requestCount = 0;
        const upload = randomBytes(24).toString('hex');
        const download = randomBytes(24).toString('hex');
        try {
            const target = await listen(
                http.createServer((request, response) => {
                    let body = '';
                    request.on('data', (chunk) => {
                        body += chunk;
                        if (body.length > 100000) request.destroy();
                    });
                    request.once('end', () => {
                        requestCount++;
                        assert.equal(body, upload.repeat(128));
                        response.end(download.repeat(128));
                    });
                }),
            );
            // Deliberately distinct PKI. Only the camouflage CA enters this test process's
            // trust store. The actual private inner CA is supplied by the generated pin.
            const [material, cover] = await Promise.all([
                issueAnyTlsMaterial(id(301)),
                issueAnyTlsMaterial(id(999)),
            ]);
            assert.notEqual(material.tls.caCertificate, cover.tls.caCertificate);
            const coverCA = path.join(directory, 'cover-ca.pem');
            await writeFile(coverCA, cover.tls.caCertificate, { mode: 0o600 });
            const trust = {
                SSL_CERT_FILE: coverCA,
                SSL_CERT_DIR: path.join(directory, 'no-system-certs'),
                DISABLE_EMBED_CA: 'true',
            };
            const coverPort = await listen(
                tls.createServer(
                    {
                        cert: `${cover.tls.certificate}\n${cover.tls.caCertificate}`,
                        key: cover.tls.privateKey,
                        minVersion: 'TLSv1.3',
                    },
                    (socket) => {
                        socket.on('data', () =>
                            socket.end(
                                'HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n',
                            ),
                        );
                    },
                ),
            );
            const innerPort = await reserve(),
                outerPort = await reserve();
            const ingressPorts = [await reserve(), await reserve()];
            const outerTap = await tap(outerPort);
            const ingressTaps = [await tap(ingressPorts[0]), await tap(ingressPorts[1])];
            const input = anyTlsHost();
            input.port = outerTap.port;
            (input.rawInbound as any).settings = {
                tag: input.inboundTag,
                wrapperPort: outerPort,
                innerPort,
                camouflage: {
                    serverName: cover.tls.serverName,
                    address: '127.0.0.1',
                    port: coverPort,
                },
            };
            const host = await resolveAnyTlsFixture(material, input);
            const innerConfig = (certificate: string, key: string) => ({
                log: { level: 'warn' },
                inbounds: [
                    {
                        type: 'anytls',
                        tag: 'inner',
                        listen: '127.0.0.1',
                        listen_port: innerPort,
                        users: [{ name: '42', password: host.protocolOptions.password }],
                        tls: {
                            enabled: true,
                            certificate: `${certificate}\n${material.tls.caCertificate}`,
                            key,
                            min_version: '1.3',
                        },
                    },
                ],
                outbounds: [{ type: 'direct', tag: 'egress' }],
                route: {
                    rules: [
                        {
                            inbound: ['inner'],
                            network: ['tcp'],
                            ip_cidr: ['127.0.0.1/32'],
                            port: [target, ...ingressTaps.map((value) => value.port)],
                            action: 'route',
                            outbound: 'egress',
                        },
                        { action: 'reject' },
                    ],
                },
            });
            let inner = await start(
                'inner',
                innerConfig(material.tls.certificate, material.tls.privateKey),
                [innerPort],
                true,
            );
            const exact = (port: number) =>
                `AND,((NETWORK,TCP),(IP-CIDR,127.0.0.1/32),(DST-PORT,${port})),DIRECT`;
            const outerReady = await reserve();
            const outer = await start(
                'outer',
                {
                    ...base,
                    'socks-port': outerReady,
                    rules: [readiness.rule, 'MATCH,REJECT'],
                    listeners: [
                        {
                            name: 'outer',
                            type: 'anytls',
                            listen: '127.0.0.1',
                            port: outerPort,
                            rule: 'only-inner',
                            users: { wrapper: material.wrapperPassword },
                            'shadow-tls': {
                                enable: true,
                                version: 3,
                                'strict-mode': true,
                                users: [{ name: 'wrapper', password: material.shadowPassword }],
                                handshake: { dest: `127.0.0.1:${coverPort}`, proxy: 'DIRECT' },
                            },
                        },
                    ],
                    'sub-rules': { 'only-inner': [exact(innerPort), 'MATCH,REJECT'] },
                },
                [outerReady, outerPort],
            );
            await readiness.wait(outerReady, () => children.has(outer));
            const ingressReady = await reserve();
            const ingress = await start(
                'ingress',
                {
                    ...base,
                    'socks-port': ingressReady,
                    rules: [readiness.rule, 'MATCH,REJECT'],
                    listeners: ingressPorts.map((port, index) => ({
                        name: `ingress-${index + 1}`,
                        type: 'socks',
                        listen: '127.0.0.1',
                        port,
                        users: [
                            { username: `user-${index + 1}`, password: `private-${index + 1}` },
                        ],
                        rule: 'only-fixture',
                    })),
                    'sub-rules': {
                        'only-fixture': [exact(target), exact(outerTap.port), 'MATCH,REJECT'],
                    },
                },
                [ingressReady, ...ingressPorts],
            );
            await readiness.wait(ingressReady, () => children.has(ingress));

            const requestThrough = async (port: number) => {
                const agent = new SocksProxyAgent(`socks5://127.0.0.1:${port}`, { timeout: 6000 });
                try {
                    return await new Promise<string>((resolve, reject) => {
                        const req = http.request(
                            `http://127.0.0.1:${target}/generated-anytls`,
                            {
                                method: 'POST',
                                agent,
                                headers: {
                                    Connection: 'close',
                                    'Content-Length': Buffer.byteLength(upload.repeat(128)),
                                },
                            },
                            (response) => {
                                let body = '';
                                response.on('data', (chunk) => {
                                    body += chunk;
                                });
                                response.once('error', reject);
                                response.once('end', () =>
                                    response.statusCode === 200
                                        ? resolve(body)
                                        : reject(new Error('Fixture HTTP rejected')),
                                );
                            },
                        );
                        const timer = setTimeout(
                            () => req.destroy(new Error('Fixture deadline')),
                            6500,
                        );
                        req.once('close', () => clearTimeout(timer));
                        req.once('error', reject);
                        req.end(upload.repeat(128));
                    });
                } finally {
                    agent.destroy();
                }
            };
            const makeConfig = async (
                scenario: 'ordinary' | 'forward' | 'reverse' | 'balanced' | 'provider',
            ) => {
                const port = await reserve(),
                    api = await reserve();
                const template: any = {
                    ...base,
                    ...anyTlsTemplate(),
                    'socks-port': port,
                    'external-controller': `127.0.0.1:${api}`,
                    rules: [readiness.rule, 'MATCH,Main'],
                };
                let hosts = [host] as Parameters<MihomoGeneratorService['generateConfig']>[0];
                const graphs: ReturnType<typeof bound>[] = [];
                if (scenario === 'provider') {
                    template['proxy-providers'] = {
                        managed: { type: 'inline', remnawave: { 'include-proxies': true } },
                    };
                    template['proxy-groups'][0] = {
                        name: 'Main',
                        type: 'select',
                        use: ['managed'],
                        remnawave: { 'include-proxies': false },
                    };
                } else if (scenario !== 'ordinary') {
                    hosts = [];
                    const graph = bound(scenario === 'balanced');
                    const a = { ...proxy(1), port: ingressTaps[0].port };
                    const b = { ...proxy(2), port: ingressTaps[1].port };
                    if (scenario === 'reverse') {
                        graph.hosts.set(id(1), host);
                        graph.hosts.set(id(2), b);
                    } else if (scenario === 'forward') {
                        graph.hosts.set(id(1), a);
                        graph.hosts.set(id(2), host);
                    } else {
                        graph.hosts.set(id(1), a);
                        graph.hosts.set(id(2), b);
                        graph.hosts.set(id(3), host);
                    }
                    for (const node of graph.topology.graph.nodes)
                        if (node.kind === 'LOAD_BALANCER') {
                            node.testUrl = `http://127.0.0.1:${readiness.targetPort}/not-a-traffic-probe`;
                            node.intervalSeconds = 300;
                        }
                    graphs.push(graph);
                }
                const config: any = load(
                    await new MihomoGeneratorService({
                        getCachedTemplateByType: async () => template,
                    } as never).generateConfig(hosts, false, false, undefined, graphs),
                );
                assert.ok(
                    config?.proxies?.length,
                    'Real subscription generation must produce the bundle',
                );
                // Force fresh sessions only in the balance fixture to observe both upstream
                // choices. Production AnyTLS retains its normal session reuse semantics.
                if (scenario === 'balanced')
                    for (const proxy of config.proxies)
                        if (proxy.type === 'anytls') proxy['disable-reuse'] = true;
                return { config, port, api };
            };
            let serial = 0;
            const clientCase = async (
                name: string,
                mutate?: (config: any) => void,
                fail = false,
                scenario: Parameters<typeof makeConfig>[0] = 'ordinary',
            ) => {
                const { config, port, api } = await makeConfig(scenario);
                mutate?.(config);
                const count = requestCount;
                const child = await start(
                    `client-${++serial}-${name}`,
                    config,
                    [port, api],
                    false,
                    trust,
                );
                try {
                    await readiness.wait(port, () => children.has(child));
                    if (fail) {
                        await assert.rejects(requestThrough(port));
                        assert.equal(requestCount, count);
                        return;
                    }
                    const repeats = scenario === 'balanced' ? 8 : 1;
                    for (let i = 0; i < repeats; i++)
                        assert.equal(await requestThrough(port), download.repeat(128));
                    assert.equal(requestCount, count + repeats);
                    const state: any = await fetch(`http://127.0.0.1:${api}/proxies`).then((r) =>
                        r.json(),
                    );
                    const helpers = new Set(
                        config.proxies
                            .filter((p: any) => p['shadow-tls-opts'])
                            .map((p: any) => p.name),
                    );
                    for (const value of Object.values(state.proxies) as any[])
                        if (Array.isArray(value.all)) {
                            assert.ok(
                                value.all.every((name: string) => !helpers.has(name)),
                                'A transport helper is selectable',
                            );
                        }
                } finally {
                    await stop(child);
                }
            };
            for (const scenario of [
                'ordinary',
                'forward',
                'reverse',
                'balanced',
                'provider',
            ] as const) {
                await t.test(
                    `generated ${scenario} subscription carries authenticated traffic`,
                    async () => {
                        const before = ingressTaps.map((tap) => tap.packets.length);
                        await clientCase(scenario, undefined, false, scenario);
                        if (scenario === 'balanced')
                            ingressTaps.forEach((tap, index) =>
                                assert.ok(
                                    tap.packets.length > before[index],
                                    'Both balance branches must carry connections',
                                ),
                            );
                    },
                );
            }
            const innerProxy = (config: any) => config.proxies.find((p: any) => p.fingerprint);
            const outerProxy = (config: any) =>
                config.proxies.find((p: any) => p['shadow-tls-opts']);
            const negatives: [string, (config: any) => void][] = [
                [
                    'wrong-inner-CA',
                    (c) => {
                        innerProxy(c).fingerprint = '00'.repeat(32);
                    },
                ],
                [
                    'wrong-inner-SAN',
                    (c) => {
                        innerProxy(c).sni = 'wrong.example.com';
                    },
                ],
                [
                    'wrong-inner-password',
                    (c) => {
                        innerProxy(c).password = 'x'.repeat(32);
                    },
                ],
                [
                    'wrong-wrapper-password',
                    (c) => {
                        outerProxy(c).password = 'x'.repeat(32);
                    },
                ],
                [
                    'wrong-ShadowTLS-password',
                    (c) => {
                        outerProxy(c)['shadow-tls-opts'].password = 'x'.repeat(32);
                    },
                ],
                [
                    'wrong-camouflage-SAN',
                    (c) => {
                        outerProxy(c).sni = 'wrong.example.com';
                    },
                ],
                [
                    'private-inner-CA-cannot-validate-camouflage',
                    (c) => {
                        outerProxy(c).fingerprint = anyTlsClientIdentity(material).caFingerprint;
                    },
                ],
            ];
            for (const [name, mutate] of negatives)
                await t.test(`${name} fails closed`, () => clientCase(name, mutate, true));
            await t.test('captured outer wire does not expose application markers', () => {
                assert.ok(outerTap.packets.length > 0);
                for (const connection of outerTap.packets)
                    for (const direction of ['up', 'down'] as const) {
                        const wire = Buffer.concat(connection[direction]);
                        assert.ok(!wire.includes(Buffer.from(upload)));
                        assert.ok(!wire.includes(Buffer.from(download)));
                    }
            });
            await t.test('renewed inner leaf retains the same subscription pin', async () => {
                const renewed = await issueAnyTlsMaterial(id(301), material);
                assert.equal(
                    anyTlsClientIdentity(renewed).caFingerprint,
                    host.protocolOptions.caFingerprint,
                );
                await stop(inner);
                inner = await start(
                    'inner-renewed',
                    innerConfig(renewed.tls.certificate, renewed.tls.privateKey),
                    [innerPort],
                    true,
                );
                await clientCase('renewed-leaf');
            });
            // Ensure this fixture never needs a globally injected inner CA or insecure TLS.
            const yaml = dump((await makeConfig('ordinary')).config);
            assert.ok(!yaml.includes(material.tls.caCertificate));
            assert.doesNotMatch(yaml, /skip-cert-verify: true/);
        } finally {
            for (const child of children) await stop(child);
            for (const socket of sockets) socket.destroy();
            for (const server of servers)
                await new Promise<void>((resolve) => server.close(() => resolve()));
            await readiness.close();
            await rm(directory, { recursive: true, force: true });
        }
    },
);
