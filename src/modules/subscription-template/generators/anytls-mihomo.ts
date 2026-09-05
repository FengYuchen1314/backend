import type { ResolvedProxyConfig } from '../resolve-proxy/interfaces';
import type { AllocateProxyName, RenderedHostProxies } from './topology-render';

import { isNonEmptyObject } from '@common/utils';
import { AnyTlsProtocolOptionsSchema } from '@libs/contracts/models';

import { isCloudflareCdnHostname } from '@modules/nodes/camouflage-domain/cloudflare-ip-ranges';

export interface AnyTlsMihomoProxy extends Record<string, unknown> {
    name: string;
    type: string;
    server: string;
    port: number;
    udp: boolean;
}

// Inline ShadowTLS replaces the outer TLS record layer in Mihomo. Keep a second,
// authenticated AnyTLS connection inside it; only its network-facing wrapper can
// be attached to a topology predecessor. Never pass either layer to Host mappers.
export function buildAnyTlsMihomo(
    host: ResolvedProxyConfig,
    label: string,
    allocateName: AllocateProxyName,
    fingerprint: string,
): RenderedHostProxies<AnyTlsMihomoProxy> | null {
    if (host.protocol !== 'anytls') return null;
    const parsed = AnyTlsProtocolOptionsSchema.safeParse(host.protocolOptions);
    if (!parsed.success) return null;
    const opts = parsed.data;
    if (
        opts.inboundUuid !== host.metadata.configProfileInboundUuid ||
        isCloudflareCdnHostname(opts.camouflageServerName) ||
        host.security !== 'tls' ||
        host.securityOptions.serverName !== opts.serverName ||
        host.securityOptions.pinnedPeerCertSha256 ||
        host.securityOptions.verifyPeerCertByName ||
        host.transport !== 'tcp' ||
        host.transportOptions.header !== null ||
        isNonEmptyObject(host.mux) ||
        isNonEmptyObject(host.streamOverrides.sockopt) ||
        isNonEmptyObject(host.streamOverrides.finalMask) ||
        (host.clientOverrides.mapper.mihomo?.length ?? 0) > 0
    )
        return null;

    const wrapperName = allocateName(`rw-anytls:${label}:transport`);
    const transport: AnyTlsMihomoProxy = {
        name: wrapperName,
        type: 'anytls',
        server: host.address,
        port: host.port,
        password: opts.wrapperPassword,
        sni: opts.camouflageServerName,
        'skip-cert-verify': false,
        'client-fingerprint': fingerprint,
        'shadow-tls-opts': { version: 3, password: opts.shadowPassword },
        // The wrapper ACL permits TCP to this listener's inner loopback port only.
        udp: false,
        ...(host.clientOverrides.mihomoIpVersion && {
            'ip-version': host.clientOverrides.mihomoIpVersion,
        }),
    };
    const entry: AnyTlsMihomoProxy = {
        name: label,
        type: 'anytls',
        server: '127.0.0.1',
        port: opts.innerPort,
        password: opts.password,
        sni: opts.serverName,
        // Pin the private CA, not the leaf: Mihomo then validates chain, SAN and
        // lifetime. The camouflage site's unrelated public CA is NOT pinned here.
        fingerprint: opts.caFingerprint,
        'skip-cert-verify': false,
        'client-fingerprint': fingerprint,
        'dialer-proxy': wrapperName,
        udp: true,
    };
    return { entry, transport, proxies: [transport, entry], privateNames: [wrapperName] };
}

// Helpers remain addressable by dialer-proxy but are not offered by any group,
// include-all expansion, generated provider payload or the built-in GLOBAL group.
export function hideAnyTlsTransports(
    config: Record<string, unknown>,
    privateNames: Set<string>,
): void {
    if (!privateNames.size) return;
    const groups = config['proxy-groups'] as Record<string, unknown>[];
    const proxies = config.proxies as Array<{ name: string }>;
    if (!groups.some((group) => group.name === 'GLOBAL')) {
        groups.push({
            name: 'GLOBAL',
            type: 'select',
            proxies: [
                ...new Set([
                    'DIRECT',
                    'REJECT',
                    ...groups.map((g) => g.name as string),
                    ...proxies.map((p) => p.name).filter((name) => !privateNames.has(name)),
                ]),
            ],
        });
    }
    const escaped = [...privateNames].map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const filter = `^(?:${escaped.join('|')})$`;
    for (const group of groups) {
        if (Array.isArray(group.proxies)) {
            group.proxies = group.proxies.filter((name) => !privateNames.has(name));
        }
        // RE2 supports alternation/non-capturing groups. Preserve existing filters.
        group['exclude-filter'] =
            typeof group['exclude-filter'] === 'string' && group['exclude-filter']
                ? `(?:${group['exclude-filter']})|${filter}`
                : filter;
    }
}
