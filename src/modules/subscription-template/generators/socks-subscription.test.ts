import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { deriveSocksPassword } from '@common/helpers/derive-socks-password';
import { XRayConfig } from '@common/helpers/xray-config';
import { ResolvedProxyConfigSchema } from '@libs/contracts/models';

import { UserForConfigEntity } from '@modules/users/entities/users-for-config';

import { ResolvedProxyConfig } from '../resolve-proxy/interfaces';
import { ResolveProxyConfigService } from '../resolve-proxy/resolve-proxy-config.service';
import { ClashGeneratorService } from './clash.generator.service';
import { MihomoGeneratorService } from './mihomo.generator.service';
import { SingBoxGeneratorService } from './singbox.generator.service';
import { XrayJsonGeneratorService } from './xray-json.generator.service';
import { XrayGeneratorService } from './xray.generator.service';

const sourceTrojanPassword = 'stable-user-password';
const sourceVlessUuid = '56f01999-2f72-4e8b-a81e-5298e618ba39';
const socksPassword = deriveSocksPassword(sourceTrojanPassword, sourceVlessUuid);

const host = {
    finalRemark: 'SOCKS node',
    address: 'proxy.example.com',
    port: 10_800,
    protocol: 'socks',
    protocolOptions: {
        username: '42',
        password: socksPassword,
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
        inboundTag: 'SOCKS_MANAGED',
        configProfileUuid: 'ff294d9d-be14-4610-ae9d-701e4c307dd0',
        configProfileInboundUuid: '1253df12-42fd-4f87-9d11-d21811ce2241',
        isDisabled: false,
        isHidden: false,
        viewPosition: 0,
        remark: 'SOCKS node',
        vlessRouteId: null,
        rawInbound: null,
    },
} as const satisfies ResolvedProxyConfig;

test('resolved SOCKS model carries numeric username and password', () => {
    assert.equal(ResolvedProxyConfigSchema.safeParse(host).success, true);
    assert.notEqual(host.protocolOptions.password, sourceTrojanPassword);
});

test('subscription resolver and inbound injection use the same dedicated SOCKS password', () => {
    const resolver = new ResolveProxyConfigService({
        getOrThrow: () => 'subscription.example.com',
    } as never);
    const resolvedProtocol = (
        resolver as unknown as {
            resolveProtocolOptions(
                inputHost: unknown,
                inbound: unknown,
                user: unknown,
            ): null | {
                protocol: string;
                protocolOptions: { password: string; username: string };
            };
        }
    ).resolveProtocolOptions(
        {},
        { protocol: 'socks', settings: {} },
        {
            id: 42n,
            trojanPassword: sourceTrojanPassword,
            vlessUuid: sourceVlessUuid,
        },
    );

    const config = {
        inbounds: [
            {
                tag: 'SOCKS_MANAGED',
                port: 10_800,
                protocol: 'socks',
                settings: { auth: 'password', users: [] },
            },
        ],
        outbounds: [{ tag: 'DIRECT', protocol: 'freedom' }],
    };
    const xrayConfig = new XRayConfig(config);
    xrayConfig.cleanInboundClients(false);
    xrayConfig.includeUserBatch(
        [
            new UserForConfigEntity({
                id: 42n,
                trojanPassword: sourceTrojanPassword,
                vlessUuid: sourceVlessUuid,
                ssPassword: 'unused',
                tags: ['SOCKS_MANAGED'],
            }),
        ],
        new Map(),
    );

    const firstInbound = config.inbounds[0];
    assert.ok(firstInbound);
    const injectedPassword = (
        firstInbound.settings.users as Array<{ pass: string; user: string }>
    )[0]?.pass;

    assert.equal(resolvedProtocol?.protocol, 'socks');
    assert.equal(resolvedProtocol?.protocolOptions.password, socksPassword);
    assert.equal(injectedPassword, socksPassword);
    assert.notEqual(injectedPassword, sourceTrojanPassword);
});

test('structured subscription generators emit native SOCKS5 authentication fields', () => {
    const xrayJson = new XrayJsonGeneratorService({} as never);
    const xrayOutbound = (
        xrayJson as unknown as {
            buildOutbound(value: ResolvedProxyConfig, tag: string): Record<string, unknown>;
        }
    ).buildOutbound(host, 'proxy') as {
        protocol: string;
        settings: Record<string, unknown>;
    };
    assert.equal(xrayOutbound.protocol, 'socks');
    assert.deepEqual(xrayOutbound.settings, {
        address: host.address,
        port: host.port,
        user: host.protocolOptions.username,
        pass: host.protocolOptions.password,
    });

    const mihomo = new MihomoGeneratorService({} as never);
    const mihomoNode = (
        mihomo as unknown as {
            buildBaseProxyNode(
                value: ResolvedProxyConfig,
                extended: boolean,
            ): Record<string, unknown>;
        }
    ).buildBaseProxyNode(host, false);
    assert.equal(mihomoNode.type, 'socks5');
    assert.equal(mihomoNode.username, '42');
    assert.equal(mihomoNode.password, socksPassword);

    const clash = new ClashGeneratorService({} as never);
    const clashNode = (
        clash as unknown as {
            buildProxyNode(value: ResolvedProxyConfig): Record<string, unknown>;
        }
    ).buildProxyNode(host);
    assert.equal(clashNode.type, 'socks5');
    assert.equal(clashNode.username, '42');
    assert.equal(clashNode.password, socksPassword);

    const singBox = new SingBoxGeneratorService({} as never);
    const singBoxOutbound = (
        singBox as unknown as {
            buildBaseOutbound(value: ResolvedProxyConfig): Record<string, unknown>;
        }
    ).buildBaseOutbound(host);
    assert.equal(singBoxOutbound.type, 'socks');
    assert.equal(singBoxOutbound.version, '5');
    assert.equal(singBoxOutbound.username, '42');
    assert.equal(singBoxOutbound.password, socksPassword);
});

test('base64 subscription omits SOCKS instead of emitting a non-portable URI', () => {
    const generator = new XrayGeneratorService();
    assert.deepEqual(generator.generateLinks([host], false), []);
});
