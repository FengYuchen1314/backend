// Plain-JavaScript orchestration of Actions-built applications. No mocked poll,
// direct billing write, test-only crypto bypass or host service is involved.
import assert from 'node:assert/strict';
import { randomBytes, hkdfSync, sign, X509Certificate } from 'node:crypto';
import { resolve4 } from 'node:dns/promises';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';

const phase = process.argv[2];
const read = (name) => readFile(`/test/${name}`, 'utf8');
const save = (name, data) => writeFile(`/test/${name}`, data, { mode: 0o600, flag: 'wx' });
if (phase === 'setup') {
    assert.equal(
        process.env.__RW_METADATA_GIT_BACKEND_COMMIT,
        '6c2105e30df3ac0c46619ec73eb76b9dbf40d19f',
    );
    const password = randomBytes(32).toString('hex');
    await save(
        'db.env',
        `POSTGRES_USER=panel_test\nPOSTGRES_DB=panel_test\nPOSTGRES_PASSWORD=${password}\n`,
    );
    await save(
        'panel.env',
        [
            `DATABASE_URL=postgresql://panel_test:${password}@db:5432/panel_test`,
            `APP_SECRET=${randomBytes(32).toString('hex')}`,
            'APP_PORT=3000',
            'METRICS_PORT=3001',
            'API_INSTANCES=1',
            'WORKER_INSTANCES=1',
            'NODE_OPTIONS=--max-old-space-size=512',
            'FRONT_END_DOMAIN=*',
            'PANEL_DOMAIN=localhost',
            'SUB_PUBLIC_DOMAIN=localhost/api/sub',
            'REDIS_HOST=redis',
            'REDIS_PORT=6379',
            'REDIS_DB=1',
            'METRICS_USER=fixture',
            `METRICS_PASS=${randomBytes(24).toString('hex')}`,
            'IS_TELEGRAM_NOTIFICATIONS_ENABLED=false',
            'WEBHOOK_ENABLED=false',
            'IS_HTTP_LOGGING_ENABLED=false',
            'EXPORT_TO_STREAM_ENABLED=false',
        ].join('\n') + '\n',
    );
    await save(
        'admin.json',
        JSON.stringify({
            username: 'e2e_admin',
            password: `Aa1-${randomBytes(24).toString('hex')}`,
        }),
    );
    await mkdir('/test/edge/run', { recursive: true, mode: 0o700 });
    await save(
        'edge/haproxy.cfg',
        `global
    master-worker
    user haproxy
    group haproxy
defaults
    mode tcp
    timeout connect 5s
    timeout client 30s
    timeout server 30s
frontend bootstrap_https
    bind :443
    default_backend bootstrap_caddy
backend bootstrap_caddy
    server caddy 127.0.0.1:18443
`,
    );
    await save(
        'edge/Caddyfile',
        `{
    admin 127.0.0.1:2019
    auto_https off
}
http://127.0.0.1:18080, http://127.0.0.1:18443 {
    respond "Not configured" 404
}
`,
    );
    process.exit(0);
}
if (phase === 'resolve-camouflage') {
    const serverName = 'lax1.vultrobjects.com';
    await save(
        'camouflage.json',
        JSON.stringify({ serverName, address: (await resolve4(serverName))[0], port: 443 }),
    );
} else if (phase === 'proxy') {
    createServer((incoming, outgoing) => {
        const headers = {
            ...incoming.headers,
            host: 'panel:3000',
            'x-forwarded-for': '127.0.0.1',
            'x-forwarded-proto': 'https',
        };
        delete headers.forwarded;
        delete headers['x-forwarded-host'];
        const req = httpRequest(
            {
                hostname: 'panel',
                port: 3000,
                path: incoming.url,
                method: incoming.method,
                headers,
                timeout: 30000,
            },
            (res) => {
                outgoing.writeHead(res.statusCode, res.headers);
                res.pipe(outgoing);
            },
        );
        req.on('error', () => {
            if (!outgoing.headersSent) outgoing.writeHead(502);
            outgoing.end();
        });
        req.on('timeout', () => req.destroy(new Error('Private relay deadline')));
        incoming.on('aborted', () => req.destroy());
        incoming.pipe(req);
    }).listen(8080, '0.0.0.0');
} else {
    let token = await read('admin-token').catch(() => '');
    const api = async (path, method = 'GET', body) => {
        const res = await fetch(`http://proxy:8080/api${path}`, {
            method,
            signal: AbortSignal.timeout(30000),
            headers: {
                'Content-Type': 'application/json',
                'X-Remnawave-Client-Type': 'browser',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        assert(res.ok, `Panel ${method} ${path.split('/')[1]} failed (${res.status})`);
        return (await res.json()).response;
    };
    const waitFor = async (label, action, timeout = 90000) => {
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
            const result = await action();
            if (result) return result;
            await delay(1000);
        }
        throw new Error(`${label} deadline`);
    };
    if (phase === 'register') {
        await waitFor('Panel bootstrap', () => api('/auth/status').catch(() => null), 180000);
        const registered = await api(
            '/auth/register',
            'POST',
            JSON.parse(await read('admin.json')),
        );
        token = registered.accessToken;
        assert.equal(typeof token, 'string');
        await save('admin-token', token);
        const { secretKey } = await api('/keygen');
        const identity = JSON.parse(Buffer.from(secretKey, 'base64').toString('utf8'));
        await save('agent-cert.pem', identity.nodeCertPem);
        await save(
            'agent.env',
            [
                `SECRET_KEY=${secretKey}`,
                'NODE_PORT=28443',
                'NFTABLES_LOGGING=false',
                'ANYTLS_ENABLED=true',
                'EDGE_ENABLED=true',
                'EDGE_CONFIG_DIR=/test/edge',
                'EDGE_HAPROXY_MASTER_SOCKET=/test/edge/run/master.sock',
            ].join('\n') + '\n',
        );
        process.stdout.write(
            'PASS: real panel bootstrap, disposable administrator and API-issued Agent credentials\n',
        );
    } else if (phase === 'configure') {
        const { serverName, address } = JSON.parse(await read('camouflage.json'));
        const profile = await api('/config-profiles', 'POST', {
            name: 'E2E encrypted AnyTLS',
            config: {
                inbounds: [],
                outbounds: [{ tag: 'DIRECT', protocol: 'freedom' }],
                xboardAnyTls: {
                    version: 1,
                    listeners: [
                        {
                            tag: 'E2E_ANYTLS',
                            wrapperPort: 14443,
                            innerPort: 16001,
                            camouflage: { serverName, address, port: 443 },
                        },
                    ],
                },
            },
        });
        assert.equal(profile.inbounds.length, 1);
        assert.equal(profile.inbounds[0].type.toLowerCase(), 'anytls');
        const squad = await api('/internal-squads', 'POST', {
            name: 'E2E AnyTLS squad',
            inbounds: [profile.inbounds[0].uuid],
        });
        const user = await api('/users', 'POST', {
            username: 'e2e_subscriber',
            expireAt: new Date(Date.now() + 86400000).toISOString(),
            activeInternalSquads: [squad.uuid],
            trafficLimitBytes: 0,
        });
        // Managed creation is still disabled until its UI/bootstrap work is accepted.
        // Exercise the existing external-import API without claiming managed creation.
        const node = await api('/nodes', 'POST', {
            name: 'E2E AnyTLS Agent',
            address: 'agent',
            port: 28443,
            creationMode: 'EXTERNAL_IMPORT',
            serverType: 'PUBLIC_DIRECT',
            consumptionMultiplier: 0.5,
            nodeConsumptionMultiplier: 2,
            configProfile: {
                activeConfigProfileUuid: profile.uuid,
                activeInbounds: [profile.inbounds[0].uuid],
            },
        });
        await save(
            'fixture.json',
            JSON.stringify({
                userUuid: user.uuid,
                nodeUuid: node.uuid,
                profileUuid: profile.uuid,
                inboundUuid: profile.inbounds[0].uuid,
            }),
        );
        await waitFor('Panel-coordinated Agent startup', async () => {
            const current = await api(`/nodes/${node.uuid}`);
            return current.isConnected && !current.isConnecting;
        });
        await api('/hosts', 'POST', {
            inbound: {
                configProfileUuid: profile.uuid,
                configProfileInboundUuid: profile.inbounds[0].uuid,
            },
            remark: 'E2E encrypted node',
            address: 'agent',
            port: 443,
            nodes: [node.uuid],
        });
        const subscription = await fetch(`http://proxy:8080/api/sub/${user.shortUuid}/mihomo`, {
            headers: { 'User-Agent': 'mihomo/1.19.30' },
            signal: AbortSignal.timeout(30000),
        });
        assert.equal(subscription.status, 200, 'Real subscription endpoint failed');
        const { load } = createRequire('/opt/app/package.json')('js-yaml');
        const config = load(await subscription.text());
        assert(Array.isArray(config.proxies));
        const inner = config.proxies.find(
            (proxy) => proxy.type === 'anytls' && proxy['dialer-proxy'],
        );
        assert(inner, 'Real panel subscription omitted the encrypted AnyTLS node');
        const outer = config.proxies.find((proxy) => proxy.name === inner['dialer-proxy']);
        assert.equal(outer?.['shadow-tls-opts']?.version, 3);
        assert.equal(inner['skip-cert-verify'], false);
        assert.equal(outer['skip-cert-verify'], false);
        assert.equal(typeof inner.fingerprint, 'string');
        assert.equal(outer.fingerprint, undefined);
        await save(
            'subscription-proxies.json',
            JSON.stringify({ proxies: config.proxies, selected: inner.name }),
        );
        process.stdout.write(
            'PASS: real profile, entitlement, user, Node startup and encrypted Mihomo subscription generation\n',
        );
    } else if (phase === 'verify' || phase === 'reconcile') {
        const fixture = JSON.parse(await read('fixture.json'));
        if (phase === 'reconcile') {
            await api(`/nodes/${fixture.nodeUuid}/actions/restart`, 'POST');
            await waitFor('Agent restart reconciliation', async () => {
                const node = await api(`/nodes/${fixture.nodeUuid}`);
                return node.isConnected && !node.isConnecting;
            });
            process.stdout.write(
                'PASS: real panel requested complete Agent reconciliation after restart\n',
            );
            process.exit(0);
        }
        const { PrismaClient } = createRequire('/opt/app/package.json')('@prisma/client');
        const prisma = new PrismaClient();
        try {
            const keys = await prisma.keygen.findFirstOrThrow();
            const issuedFingerprint = new X509Certificate(await read('agent-cert.pem'))
                .fingerprint256;
            const canon = (pem) =>
                pem.replace(/-----[^-]+-----/g, '').replace(/[^A-Za-z0-9+/=]/g, '');
            const ikm = Buffer.concat([
                Buffer.from(canon(keys.pubKey)),
                Buffer.from(canon(keys.caCert)),
            ]);
            const okm = Buffer.from(hkdfSync('sha256', ikm, Buffer.alloc(0), 'rw-v1', 22));
            const servername = `${okm.subarray(0, 16).toString('hex')}.${okm.subarray(16, 21).toString('hex')}.${['com', 'net', 'org', 'io', 'dev', 'app'][okm[21] % 6]}`;
            const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
            const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ sub: 'e2e-read-only-usage', exp: Math.floor(Date.now() / 1000) + 300 })}`;
            const jwt = `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), keys.privKey).toString('base64url')}`;
            const usage = () =>
                new Promise((resolve, reject) => {
                    const req = httpsRequest(
                        {
                            hostname: 'agent',
                            port: 28443,
                            path: '/node/anytls/usage',
                            ca: keys.caCert,
                            cert: keys.clientCert,
                            key: keys.clientKey,
                            servername,
                            rejectUnauthorized: true,
                            minVersion: 'TLSv1.3',
                            timeout: 15000,
                            checkServerIdentity: (_host, cert) =>
                                cert.fingerprint256 === issuedFingerprint
                                    ? undefined
                                    : new Error('Wrong issued Agent identity'),
                            headers: { Authorization: `Bearer ${jwt}` },
                        },
                        (res) => {
                            let body = '';
                            res.on('data', (chunk) => {
                                body += chunk;
                                if (body.length > 65536)
                                    req.destroy(new Error('Oversized Agent usage'));
                            });
                            res.on('error', reject);
                            res.on('end', () => {
                                try {
                                    assert.equal(res.statusCode, 200);
                                    resolve(JSON.parse(body).response);
                                } catch (error) {
                                    reject(error);
                                }
                            });
                        },
                    );
                    req.on('error', reject);
                    req.on('timeout', () => req.destroy(new Error('Agent usage deadline')));
                    req.end();
                });
            const user = await prisma.users.findUniqueOrThrow({
                where: { uuid: fixture.userUuid },
            });
            const node = await prisma.nodes.findUniqueOrThrow({
                where: { uuid: fixture.nodeUuid },
            });
            const snapshot = await usage();
            assert.equal(snapshot.available, true);
            assert.equal(snapshot.users.length, 1);
            assert.equal(snapshot.users[0].username, String(user.id));
            const raw = BigInt(snapshot.users[0].uplink) + BigInt(snapshot.users[0].downlink);
            assert(raw > 0n);
            const charged = raw / 2n;
            await waitFor('Automatic real panel billing', async () => {
                const traffic = await prisma.userTraffic.findUniqueOrThrow({
                    where: { id: user.id },
                });
                return traffic.usedTrafficBytes === charged;
            });
            const assertLedger = async () => {
                const traffic = await prisma.userTraffic.findUniqueOrThrow({
                    where: { id: user.id },
                });
                assert.equal(traffic.usedTrafficBytes, charged);
                assert.equal(traffic.lifetimeUsedTrafficBytes, charged);
                assert(traffic.firstConnectedAt && traffic.onlineAt);
                assert.equal(traffic.lastConnectedNodeUuid, node.uuid);
                assert.equal(
                    (await prisma.nodes.findUniqueOrThrow({ where: { uuid: node.uuid } }))
                        .trafficUsedBytes,
                    raw * 2n,
                );
                assert.equal(
                    (
                        await prisma.nodesUserUsageHistory.aggregate({
                            where: { nodeId: node.id, userId: user.id },
                            _sum: { totalBytes: true },
                        })
                    )._sum.totalBytes,
                    raw,
                );
                const ledger = await prisma.anyTlsUsageLedger.findUniqueOrThrow({
                    where: { nodeUuid_epoch: { nodeUuid: node.uuid, epoch: snapshot.epoch } },
                });
                assert.equal(ledger.counters[String(user.id)].uplink, snapshot.users[0].uplink);
                assert.equal(ledger.counters[String(user.id)].downlink, snapshot.users[0].downlink);
                assert.equal(
                    BigInt((await api(`/users/${user.uuid}`)).userTraffic.usedTrafficBytes),
                    charged,
                );
            };
            await assertLedger();
            // Observe two more normal 15-second scheduler intervals; no direct billing writes.
            await delay(35000);
            assert.deepEqual(await usage(), snapshot);
            await assertLedger();
            const prior = await read('accepted-usage.json')
                .then(JSON.parse)
                .catch(() => null);
            if (prior) assert.deepEqual(snapshot, prior);
            else await save('accepted-usage.json', JSON.stringify(snapshot));
            process.stdout.write(
                `PASS: native subscription traffic -> real Agent -> scheduled panel worker -> PostgreSQL and user API; raw=${raw} charged=${charged}; repeated polling is unchanged\n`,
            );
        } finally {
            await prisma.$disconnect();
        }
    } else throw new Error('Unsupported E2E phase');
}
