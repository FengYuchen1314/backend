import { ConfigProfileInboundEntity } from '@modules/config-profiles/entities';

export function hasActiveSocksInbound(activeInbounds: ConfigProfileInboundEntity[]): boolean {
    return activeInbounds.some((inbound) => inbound.type.toLowerCase() === 'socks');
}

export function requiresFullUserSyncReload(activeInbounds: ConfigProfileInboundEntity[]): boolean {
    return activeInbounds.some((inbound) =>
        ['mieru', 'socks'].includes(inbound.type.toLowerCase()),
    );
}
