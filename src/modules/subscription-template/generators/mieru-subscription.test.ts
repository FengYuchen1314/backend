import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ResolvedProxyConfigSchema } from '@libs/contracts/models';

import { ResolvedProxyConfig } from '../resolve-proxy/interfaces';
import { ResolveProxyConfigService } from '../resolve-proxy/resolve-proxy-config.service';
import { ClashGeneratorService } from './clash.generator.service';
import { MihomoGeneratorService } from './mihomo.generator.service';
import { SingBoxGeneratorService } from './singbox.generator.service';
import { XrayJsonGeneratorService } from './xray-json.generator.service';
import { XrayGeneratorService } from './xray.generator.service';

const host = {
    finalRemark: 'Mieru node',
    address: 'proxy.example.com',
    port: 24_443,
    protocol: 'mieru',
    protocolOptions: {
        username: '42',
        password: 's3cret:/?#@',
        transportProtocol: 'TCP',
        mtu: 1_400,
        multiplexing: 'MULTIPLEXING_LOW',
        handshakeMode: 'HANDSHAKE_STANDARD',
    },
    transport: 'tcp',
    transportOptions: { header: null },
    security: 'none',
    streamOverrides: { finalMask: null, sockopt: null },
    mux: null,
    clientOverrides: {
        shuffleHost: false,
        mihomoX25519: false,
        mihomoIpVersion: null,
        serverDescription: null,
        xrayJsonTemplate: null,
        mapper: {},
    },
    metadata: {
        uuid: 'e7910de0-df46-4e01-b779-83d51d977617',
        tags: [],
        excludeFromSubscriptionTypes: [],
        inboundTag: 'MIERU_TCP_24443',
        configProfileUuid: 'ff294d9d-be14-4610-ae9d-701e4c307dd0',
        configProfileInboundUuid: '1253df12-42fd-4f87-9d11-d21811ce2241',
        isDisabled: false,
        isHidden: false,
        viewPosition: 0,
        remark: 'Mieru node',
        vlessRouteId: null,
        rawInbound: null,
    },
} as const satisfies ResolvedProxyConfig;

test('Mieru resolver validates managed settings and keeps user credentials', () => {
    const resolver = new ResolveProxyConfigService({
        getOrThrow: () => 'subscription.example.com',
    } as never);
    const resolved = (
        resolver as unknown as {
            resolveProtocolOptions(
                inputHost: unknown,
                inbound: unknown,
                user: unknown,
            ): ResolvedProxyConfig | null;
        }
    ).resolveProtocolOptions(
        {},
        {
            protocol: 'mieru',
            settings: {
                transport: 'TCP',
                mtu: 1_400,
                multiplexing: 'MULTIPLEXING_LOW',
                handshakeMode: 'HANDSHAKE_STANDARD',
            },
        },
        { id: 42n, trojanPassword: 's3cret:/?#@' },
    );

    assert.deepEqual(resolved, {
        protocol: 'mieru',
        protocolOptions: host.protocolOptions,
    });
    assert.equal(ResolvedProxyConfigSchema.safeParse(host).success, true);
});

test('Mihomo emits native Mieru fields while unsupported structured clients skip it', () => {
    const mihomo = new MihomoGeneratorService({} as never);
    const mihomoNode = (
        mihomo as unknown as {
            buildBaseProxyNode(
                value: ResolvedProxyConfig,
                extended: boolean,
            ): Record<string, unknown>;
        }
    ).buildBaseProxyNode(host, false);

    assert.equal(mihomoNode.type, 'mieru');
    assert.equal(mihomoNode.username, '42');
    assert.equal(mihomoNode.password, host.protocolOptions.password);
    assert.equal(mihomoNode.transport, 'TCP');
    assert.equal(mihomoNode.mtu, 1_400);
    assert.equal(mihomoNode.multiplexing, 'MULTIPLEXING_LOW');
    assert.equal(mihomoNode['handshake-mode'], 'HANDSHAKE_STANDARD');
    assert.equal('network' in mihomoNode, false);

    const clash = new ClashGeneratorService({} as never);
    const clashNode = (
        clash as unknown as {
            buildProxyNode(value: ResolvedProxyConfig): Record<string, unknown> | null;
        }
    ).buildProxyNode(host);
    assert.equal(clashNode, null);

    const singBox = new SingBoxGeneratorService({} as never);
    const singBoxOutbound = (
        singBox as unknown as {
            buildBaseOutbound(value: ResolvedProxyConfig): Record<string, unknown> | null;
        }
    ).buildBaseOutbound(host);
    assert.equal(singBoxOutbound, null);

    const xrayJson = new XrayJsonGeneratorService({} as never);
    const xrayOutbound = (
        xrayJson as unknown as {
            buildOutboundConfig(
                value: ResolvedProxyConfig,
                extended: boolean,
            ): Record<string, unknown> | null;
        }
    ).buildOutboundConfig(host, false);
    assert.equal(xrayOutbound, null);
});

test('base64 generator emits the official human-readable mierus URI', () => {
    const generator = new XrayGeneratorService();
    const [link] = generator.generateLinks([host], false);

    assert.equal(
        link,
        'mierus://42:s3cret%3A%2F%3F%23%40@proxy.example.com?profile=Mieru%20node&port=24443&protocol=TCP&mtu=1400&multiplexing=MULTIPLEXING_LOW&handshake-mode=HANDSHAKE_STANDARD',
    );
    assert.equal(link?.includes('#'), false);

    const ipv6 = { ...host, address: '2001:db8::1' } satisfies ResolvedProxyConfig;
    assert.match(generator.generateLinks([ipv6], false)[0] ?? '', /@\[2001:db8::1\]\?/);
});
