import 'reflect-metadata';
import { load } from 'js-yaml';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ResolvedProxyConfigSchema } from '@libs/contracts/models';

import {
    anyTlsClientIdentity,
    deriveAnyTlsPassword,
    issueAnyTlsMaterial,
} from '@modules/anytls/anytls-identity';
import { AnyTlsMaterialService } from '@modules/anytls/anytls-material.service';

import { ResolveProxyConfigService } from '../resolve-proxy/resolve-proxy-config.service';
import {
    anyTlsHost,
    anyTlsResolveOptions,
    anyTlsTemplate,
    resolveAnyTlsFixture,
    subscriberPassword,
} from './anytls-subscription-fixtures';
import { MihomoGeneratorService } from './mihomo.generator.service';
import { SingBoxGeneratorService } from './singbox.generator.service';
import { bound, id, proxy } from './topology-test-fixtures';
import { XrayJsonGeneratorService } from './xray-json.generator.service';
import { XrayGeneratorService } from './xray.generator.service';

const materialPromise = issueAnyTlsMaterial(id(301));
const templates = (template = anyTlsTemplate()) =>
    ({ getCachedTemplateByType: async () => structuredClone(template) }) as never;

test('AnyTLS subscription resolver reads existing PKI only, caches by inbound and never exposes private identity', async () => {
    const material = await materialPromise;
    let reads = 0;
    const service = new AnyTlsMaterialService(
        {
            read: async () => {
                reads++;
                return { material };
            },
            save: async () => {
                throw new Error('Subscriptions must not renew PKI');
            },
        } as never,
        {} as never,
    );
    const resolver = new ResolveProxyConfigService(
        { getOrThrow: () => 'sub.example.com' } as never,
        service,
    );
    const first = anyTlsHost();
    const second = { ...first, uuid: id(105) };
    const original = structuredClone([first, second]);
    const resolved = await resolver.resolveProxyConfig(anyTlsResolveOptions([first, second]));
    assert.equal(resolved.length, 2);
    assert.equal(reads, 1);
    assert.deepEqual([first, second], original);
    assert.notEqual(resolved[0].finalRemark, resolved[1].finalRemark);
    for (const host of resolved) {
        assert.equal(ResolvedProxyConfigSchema.safeParse(host).success, true);
        assert.equal(host.protocol, 'anytls');
        if (host.protocol !== 'anytls') throw new Error('Wrong protocol');
        assert.equal(
            host.protocolOptions.password,
            deriveAnyTlsPassword(subscriberPassword, id(301)),
        );
        assert.notEqual(host.protocolOptions.password, subscriberPassword);
        const serialized = JSON.stringify(host);
        for (const key of [
            material.caPrivateKey,
            material.tls.privateKey,
            material.tls.certificate,
        ])
            assert.ok(!serialized.includes(key));
        assert.doesNotMatch(serialized, /BEGIN (?:CERTIFICATE|PRIVATE KEY)/);
    }
});

test('invalid bindings, unsupported overrides and Cloudflare camouflage omit AnyTLS without breaking a subscription', async () => {
    const material = await materialPromise;
    const cases: Array<(host: ReturnType<typeof anyTlsHost>) => void> = [
        (h) => {
            h.configProfileInboundUuid = null;
        },
        (h) => {
            h.configProfileInboundUuid = id(999);
        },
        (h) => {
            h.inboundTag = 'foreign';
        },
        (h) => {
            (h.rawInbound as { tag: string }).tag = 'foreign';
        },
        (h) => {
            (h.rawInbound as any).settings.camouflage.serverName = 'www.cloudflare.com';
        },
        (h) => {
            (h.rawInbound as any).settings.camouflage.address = '104.16.1.2';
        },
        (h) => {
            h.keepSniBlank = true;
        },
        (h) => {
            h.overrideSniFromAddress = true;
        },
        (h) => {
            h.sni = 'different.example.com';
        },
        (h) => {
            h.securityLayer = 'NONE';
        },
        (h) => {
            h.pinnedPeerCertSha256 = 'insecure';
        },
        (h) => {
            h.verifyPeerCertByName = 'foreign';
        },
        (h) => {
            h.muxParams = { enabled: true };
        },
        (h) => {
            h.sockoptParams = { dialerProxy: 'DIRECT' };
        },
        (h) => {
            h.finalMask = { tcp: [] };
        },
        (h) => {
            h.mapper = { mihomo: [{ op: 'set', path: 'skip-cert-verify', value: true }] } as never;
        },
    ];
    const resolver = new ResolveProxyConfigService(
        { getOrThrow: () => 'sub.example.com' } as never,
        {
            clientIdentity: async () => anyTlsClientIdentity(material),
        } as never,
    );
    for (const change of cases) {
        const host = anyTlsHost();
        change(host);
        assert.deepEqual(await resolver.resolveProxyConfig(anyTlsResolveOptions([host])), []);
    }
    const missing = new ResolveProxyConfigService(
        { getOrThrow: () => 'sub.example.com' } as never,
        {
            clientIdentity: async () => {
                throw new Error('unprovisioned');
            },
        } as never,
    );
    assert.deepEqual(await missing.resolveProxyConfig(anyTlsResolveOptions()), []);
});

test('Mihomo emits independent encrypted layers and keeps helper transports out of all selectors/providers', async () => {
    const material = await materialPromise;
    const host = await resolveAnyTlsFixture(material);
    const template: any = anyTlsTemplate();
    template['proxy-groups'].push({
        name: 'All',
        type: 'select',
        'include-all': true,
        'exclude-filter': '^old$',
        remnawave: { 'include-proxies': false },
    });
    template['proxy-providers'] = {
        plain: { type: 'inline', remnawave: { 'include-proxies': true } },
        unsafe: {
            type: 'inline',
            override: { 'dialer-proxy': 'DIRECT' },
            remnawave: { 'include-proxies': true },
        },
    };
    const config: any = load(
        await new MihomoGeneratorService(templates(template)).generateConfig([proxy(2), host]),
    );
    const inner = config.proxies.find((p: any) => p.name === host.finalRemark);
    const outer = config.proxies.find((p: any) => p.name === inner['dialer-proxy']);
    assert.equal(outer.server, host.address);
    assert.equal(outer.port, host.port);
    assert.equal(outer.password, material.wrapperPassword);
    assert.equal(outer.sni, 'cover.example.com');
    assert.equal(outer['shadow-tls-opts'].version, 3);
    assert.equal(outer['shadow-tls-opts'].password, material.shadowPassword);
    assert.equal(outer.fingerprint, undefined);
    assert.equal(outer['skip-cert-verify'], false);
    assert.equal(inner.server, '127.0.0.1');
    assert.equal(inner.port, 14001);
    assert.equal(inner.sni, material.tls.serverName);
    assert.equal(inner.fingerprint, anyTlsClientIdentity(material).caFingerprint);
    assert.equal(inner['shadow-tls-opts'], undefined);
    assert.equal(inner['skip-cert-verify'], false);
    for (const group of config['proxy-groups']) {
        assert.ok(!group.proxies.includes(outer.name));
        assert.ok(new RegExp(group['exclude-filter']).test(outer.name));
        assert.ok(!new RegExp(group['exclude-filter']).test(inner.name));
    }
    assert.ok(
        config['proxy-groups'].some(
            (g: any) => g.name === 'GLOBAL' && g.proxies.includes(inner.name),
        ),
    );
    assert.ok(new RegExp(config['proxy-groups'][1]['exclude-filter']).test('old'));
    assert.deepEqual(
        config['proxy-providers'].plain.payload.map((p: any) => p.name),
        [proxy(2).finalRemark, inner.name],
    );
    assert.deepEqual(
        config['proxy-providers'].unsafe.payload.map((p: any) => p.name),
        [proxy(2).finalRemark],
    );
});

test('AnyTLS topology patches the network-facing wrapper only, including many-to-one balance and repeated graphs', async () => {
    const host = await resolveAnyTlsFixture(await materialPromise);
    for (const balanced of [false, true]) {
        const item = bound(balanced);
        // Use AnyTLS as both the first hop and the last hop to exercise both boundaries.
        item.hosts.set(id(1), structuredClone(host));
        const terminal = balanced ? 3 : 2;
        item.hosts.set(id(terminal), structuredClone(host));
        const second = structuredClone(item);
        second.topology.uuid = id(998);
        const before = structuredClone(item);
        const config: any = load(
            await new MihomoGeneratorService(templates()).generateConfig(
                [host],
                false,
                false,
                undefined,
                [item, second],
            ),
        );
        assert.deepEqual(item, before);
        const byName = new Map<string, any>(config.proxies.map((p: any) => [p.name, p]));
        assert.equal(byName.size, config.proxies.length);
        for (const graph of [item, second]) {
            const first = byName.get(`rw:${graph.topology.uuid}:${id(1)}`);
            assert.equal(byName.get(first['dialer-proxy'])['dialer-proxy'], undefined);
            const last = byName.get(`rw:${graph.topology.uuid}:${id(terminal)}`);
            assert.equal(last.fingerprint, host.protocolOptions.caFingerprint);
            const lastOuter = byName.get(last['dialer-proxy']);
            assert.equal(
                lastOuter['dialer-proxy'],
                balanced ? `rw:${graph.topology.uuid}:${id(30)}` : first.name,
            );
            if (balanced) {
                const balance = config['proxy-groups'].find(
                    (g: any) => g.name === lastOuter['dialer-proxy'],
                );
                assert.deepEqual(balance.proxies, [
                    first.name,
                    `rw:${graph.topology.uuid}:${id(2)}`,
                ]);
            }
        }
    }
});

test('helper names avoid ordinary/template collisions and unsupported members omit whole bundles', async () => {
    const host = await resolveAnyTlsFixture(await materialPromise);
    const collision = `rw-anytls:${host.finalRemark}:transport`;
    const ordinary = { ...proxy(2), finalRemark: collision };
    const config: any = load(
        await new MihomoGeneratorService(templates()).generateConfig([host, ordinary]),
    );
    assert.equal(new Set(config.proxies.map((p: any) => p.name)).size, 3);
    assert.equal(
        config.proxies.find((p: any) => p.name === host.finalRemark)['dialer-proxy'],
        `${collision}:1`,
    );
    const item = bound();
    item.hosts.set(id(1), host);
    item.hosts.get(id(2))!.metadata.excludeFromSubscriptionTypes = ['MIHOMO'];
    const omitted: any = load(
        await new MihomoGeneratorService(templates()).generateConfig([], false, false, undefined, [
            item,
        ]),
    );
    assert.deepEqual(omitted.proxies, []);
    assert.equal(omitted['proxy-groups'].length, 1);
});

test('unsupported formats never emit a weaker AnyTLS connection or poison ordinary Xray subscriptions', async () => {
    const host = await resolveAnyTlsFixture(await materialPromise);
    const stash: any = load(
        await new MihomoGeneratorService(templates()).generateConfig([proxy(2), host], true),
    );
    assert.equal(stash.proxies.length, 1);
    assert.equal(stash.proxies[0].type, 'socks5');
    assert.deepEqual(new XrayGeneratorService().generateLinks([host], false), []);
    const json = await new XrayJsonGeneratorService(
        templates({ outbounds: [] } as never),
    ).generateConfig({ hosts: [host, proxy(2)], isExtendedClient: false });
    assert.equal(JSON.parse(json).length, 1);
    const item = bound();
    item.hosts.set(id(1), host);
    const sing = JSON.parse(
        await new SingBoxGeneratorService(templates({ outbounds: [] } as never)).generateConfig(
            [proxy(2), host],
            undefined,
            [item],
        ),
    );
    assert.equal(sing.outbounds.length, 1);
    assert.equal(sing.outbounds[0].type, 'socks');
});
