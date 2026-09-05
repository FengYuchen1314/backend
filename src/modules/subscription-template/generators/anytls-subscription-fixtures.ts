import type { AnyTlsMaterial } from '@modules/anytls/anytls-identity';
import { anyTlsClientIdentity } from '@modules/anytls/anytls-identity';
import { anyTlsDefinition } from '@modules/anytls/anytls.test-fixtures';
import { HostWithRawInbound } from '@modules/hosts/entities/host-with-inbound-tag.entity';

import {
    IResolveProxyConfigOptions,
    ResolveProxyConfigService,
} from '../resolve-proxy/resolve-proxy-config.service';
import { id } from './topology-test-fixtures';

export const subscriberPassword = 'test-only-subscriber-master-password';
export function anyTlsHost(n = 1): HostWithRawInbound {
    return {
        uuid: id(100 + n),
        remark: `Encrypted AnyTLS ${n}`,
        address: '127.0.0.1',
        port: 443,
        configProfileUuid: id(200 + n),
        configProfileInboundUuid: id(300 + n),
        inboundTag: 'ANYTLS_A',
        rawInbound: { protocol: 'anytls', tag: 'ANYTLS_A', settings: anyTlsDefinition() },
        mapper: {},
        tags: [],
        excludeFromSubscriptionTypes: [],
        isDisabled: false,
        isHidden: false,
        viewPosition: n,
        shuffleHost: false,
        mihomoX25519: false,
        mihomoIpVersion: null,
        serverDescription: null,
        xrayJsonTemplate: null,
        securityLayer: 'DEFAULT',
        fingerprint: null,
        sni: null,
        keepSniBlank: false,
        overrideSniFromAddress: false,
        pinnedPeerCertSha256: null,
        verifyPeerCertByName: null,
        finalMask: null,
        sockoptParams: null,
        muxParams: null,
        vlessRouteId: null,
    } as unknown as HostWithRawInbound;
}

export function anyTlsResolveOptions(hosts = [anyTlsHost()]): IResolveProxyConfigOptions {
    return {
        hosts,
        user: {
            id: 42n,
            username: 'test-user',
            status: 'ACTIVE',
            trojanPassword: subscriberPassword,
            vlessUuid: id(42),
        } as never,
        subscriptionSettings: {
            isShowCustomRemarks: false,
            customRemarks: { emptyHosts: [] },
        } as never,
    };
}

export async function resolveAnyTlsFixture(material: AnyTlsMaterial, host = anyTlsHost()) {
    const resolver = new ResolveProxyConfigService(
        { getOrThrow: () => 'sub.example.com' } as never,
        {
            clientIdentity: async () => anyTlsClientIdentity(material),
        } as never,
    );
    const result = await resolver.resolveProxyConfig(anyTlsResolveOptions([host]));
    if (result.length !== 1 || result[0].protocol !== 'anytls')
        throw new Error('AnyTLS fixture did not resolve');
    return result[0];
}

export const anyTlsTemplate = () => ({
    proxies: [],
    'proxy-groups': [{ name: 'Main', type: 'select', proxies: [] }],
    rules: ['MATCH,Main'],
});
