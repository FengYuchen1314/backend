import assert from 'node:assert/strict';
import test from 'node:test';

import { ConfigProfileInboundEntity } from '@modules/config-profiles/entities';

import { prepareNodeEdge } from './node-edge-plan';

const VISION_UUID = '11111111-1111-4111-8111-111111111111';
const XHTTP_UUID = '22222222-2222-4222-8222-222222222222';

function realityInbound(
    uuid: string,
    tag: string,
    network: 'raw' | 'xhttp',
    serverNames: string[],
) {
    return {
        entity: new ConfigProfileInboundEntity({
            uuid,
            tag,
            type: 'vless',
            network,
            security: 'reality',
            port: 443,
            rawInbound: {},
        }),
        config: {
            tag,
            port: 443,
            protocol: 'vless',
            settings: { clients: [], decryption: 'none' },
            streamSettings: {
                network,
                security: 'reality',
                realitySettings: {
                    target: `${serverNames[0]}:443`,
                    serverNames,
                    privateKey: 'private-key',
                    shortIds: ['0123456789abcdef'],
                },
            },
        },
    };
}

test('shared 443 rewrites multiple REALITY inbounds to stable loopback ports and SNI routes', () => {
    const vision = realityInbound(VISION_UUID, 'VLESS_REALITY_VISION', 'raw', [
        'cover-a.example.com',
    ]);
    const xhttp = realityInbound(XHTTP_UUID, 'VLESS_XHTTP_XMUX', 'xhttp', ['cover-b.example.com']);
    const input = { inbounds: [xhttp.config, vision.config], outbounds: [] };
    const prepared = prepareNodeEdge(input, [xhttp.entity, vision.entity], {
        management: {
            domains: ['panel.example.com'],
            upstream: 'https://panel-origin.example.net',
        },
        website: {
            domains: ['www.example.com'],
            upstream: 'http://127.0.0.1:8080',
        },
    });

    assert.equal(prepared.plan.routes.length, 2);
    assert.deepEqual(
        prepared.plan.routes.map((route) => route.sni),
        ['cover-a.example.com', 'cover-b.example.com'],
    );
    assert.notEqual(prepared.plan.routes[0]!.targetPort, prepared.plan.routes[1]!.targetPort);
    assert.match(prepared.fingerprint, /^[a-f0-9]{64}$/);

    const rewritten = prepared.config.inbounds as Array<Record<string, unknown>>;
    for (const inbound of rewritten) {
        assert.equal(inbound.listen, '127.0.0.1');
        assert.equal(typeof inbound.port, 'number');
        assert.notEqual(inbound.port, 443);
        const stream = inbound.streamSettings as Record<string, unknown>;
        assert.deepEqual(stream.sockopt, { acceptProxyProtocol: true });
    }

    const reversed = prepareNodeEdge(input, [vision.entity, xhttp.entity], {
        management: prepared.settings.management,
        website: prepared.settings.website,
    });
    assert.deepEqual(reversed.plan, prepared.plan);
    assert.equal(reversed.fingerprint, prepared.fingerprint);
});

test('shared 443 rejects duplicate SNI across logical inbounds', () => {
    const first = realityInbound(VISION_UUID, 'FIRST', 'raw', ['duplicate.example.com']);
    const second = realityInbound(XHTTP_UUID, 'SECOND', 'xhttp', ['duplicate.example.com']);

    assert.throws(
        () =>
            prepareNodeEdge(
                { inbounds: [first.config, second.config] },
                [first.entity, second.entity],
                {},
            ),
        /already assigned.*Every inbound.*unique SNI/i,
    );
});

test('shared 443 rejects proxy/web collisions and reverse-proxy self loops', () => {
    const inbound = realityInbound(VISION_UUID, 'VISION', 'raw', ['cover.example.com']);

    assert.throws(
        () =>
            prepareNodeEdge({ inbounds: [inbound.config] }, [inbound.entity], {
                website: {
                    domains: ['cover.example.com'],
                    upstream: 'http://127.0.0.1:8080',
                },
            }),
        /must not share SNI/i,
    );

    assert.throws(
        () =>
            prepareNodeEdge({ inbounds: [inbound.config] }, [inbound.entity], {
                management: {
                    domains: ['panel.example.com'],
                    upstream: 'https://www.example.com',
                },
                website: {
                    domains: ['www.example.com'],
                    upstream: 'http://127.0.0.1:8080',
                },
            }),
        /must not point to any public domain/i,
    );
});

test('an unsupported protocol can never silently occupy shared public port 443', () => {
    const socks = new ConfigProfileInboundEntity({
        uuid: VISION_UUID,
        tag: 'SOCKS',
        type: 'socks',
        network: 'tcp',
        security: null,
        port: 443,
        rawInbound: {},
    });

    assert.throws(
        () =>
            prepareNodeEdge(
                {
                    inbounds: [
                        {
                            tag: 'SOCKS',
                            port: 443,
                            protocol: 'socks',
                            streamSettings: { network: 'tcp', security: 'none' },
                        },
                    ],
                },
                [socks],
                {},
            ),
        /cannot share public port 443/i,
    );
});

test('an inactive auxiliary inbound can never keep public port 443 behind the edge', () => {
    const vision = realityInbound(VISION_UUID, 'VISION', 'raw', ['cover.example.com']);

    assert.throws(
        () =>
            prepareNodeEdge(
                {
                    inbounds: [
                        vision.config,
                        {
                            tag: 'AUXILIARY',
                            port: 443,
                            protocol: 'dokodemo-door',
                        },
                    ],
                },
                [vision.entity],
                {},
            ),
        /still owns public port 443/i,
    );
});

test('a non-443 SOCKS-only node keeps its config and produces an empty proxy route set', () => {
    const socks = new ConfigProfileInboundEntity({
        uuid: VISION_UUID,
        tag: 'SOCKS',
        type: 'socks',
        network: 'tcp',
        security: null,
        port: 1_080,
        rawInbound: {},
    });
    const input = {
        inbounds: [{ tag: 'SOCKS', port: 1_080, protocol: 'socks' }],
    };
    const prepared = prepareNodeEdge(input, [socks], {});

    assert.deepEqual(prepared.config, input);
    assert.deepEqual(prepared.plan.routes, []);
});
