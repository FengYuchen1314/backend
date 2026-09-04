import { SERVER_TYPES, TServerType } from '@contract/constants';

import { ConfigProfileInboundEntity } from '@modules/config-profiles/entities';

export type TManagedNodeProtocol = 'SOCKS5' | 'VLESS_REALITY_VISION' | 'VLESS_XHTTP_REALITY_XMUX';

const ALLOWED_PROTOCOLS_BY_SERVER_TYPE: Record<TServerType, ReadonlySet<TManagedNodeProtocol>> = {
    [SERVER_TYPES.PUBLIC_DIRECT]: new Set([
        'SOCKS5',
        'VLESS_REALITY_VISION',
        'VLESS_XHTTP_REALITY_XMUX',
    ]),
    [SERVER_TYPES.BROADBAND_LANDING]: new Set(['SOCKS5']),
    [SERVER_TYPES.LEASED_LINE]: new Set(),
};

function asRecord(value: unknown): Record<string, unknown> | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
}

export function getManagedNodeProtocol(
    inbound: ConfigProfileInboundEntity,
): TManagedNodeProtocol | null {
    const rawInbound = asRecord(inbound.rawInbound);
    const rawProtocol = rawInbound?.protocol;

    if (typeof rawProtocol !== 'string') return null;

    const protocol = rawProtocol.toLowerCase();
    if (protocol !== inbound.type.toLowerCase()) return null;

    const settings = asRecord(rawInbound?.settings);

    if (protocol === 'socks') {
        return settings?.auth === 'password' ? 'SOCKS5' : null;
    }

    if (protocol !== 'vless') return null;

    const streamSettings = asRecord(rawInbound?.streamSettings);
    const network = String(inbound.network ?? streamSettings?.network ?? '').toLowerCase();
    const security = String(inbound.security ?? streamSettings?.security ?? '').toLowerCase();

    if (security !== 'reality') return null;

    if (network === 'raw' || network === 'tcp') {
        const flow = settings?.flow;
        if (flow === undefined || flow === 'xtls-rprx-vision') {
            return 'VLESS_REALITY_VISION';
        }
    }

    if (network === 'xhttp') {
        const xhttpSettings = asRecord(streamSettings?.xhttpSettings);
        const extra = asRecord(xhttpSettings?.extra);
        if (asRecord(extra?.xmux)) return 'VLESS_XHTTP_REALITY_XMUX';
    }

    return null;
}

export function validateManagedNodeCreation(
    serverType: TServerType,
    inbounds: ConfigProfileInboundEntity[],
): string | null {
    const allowedProtocols = ALLOWED_PROTOCOLS_BY_SERVER_TYPE[serverType];

    if (inbounds.length === 0) {
        return serverType === SERVER_TYPES.LEASED_LINE
            ? 'Managed leased-line deployment is unavailable until Mieru support is connected.'
            : 'At least one managed inbound is required when creating a node.';
    }

    for (const inbound of inbounds) {
        const protocol = getManagedNodeProtocol(inbound);

        if (serverType === SERVER_TYPES.LEASED_LINE) {
            return 'Managed leased-line deployment is unavailable until Mieru support is connected.';
        }

        if (!protocol) {
            return `Inbound ${inbound.tag} (${inbound.type}) is not in the managed creation whitelist.`;
        }

        if (allowedProtocols.has(protocol)) continue;

        return `Managed protocol ${protocol} is not allowed for server type ${serverType}.`;
    }

    return null;
}
