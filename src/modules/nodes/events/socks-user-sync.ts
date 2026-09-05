import { SERVER_TYPES } from '@libs/contracts/constants';

import { ConfigProfileInboundEntity } from '@modules/config-profiles/entities';

export function hasActiveSocksInbound(activeInbounds: ConfigProfileInboundEntity[]): boolean {
    return activeInbounds.some((inbound) => inbound.type.toLowerCase() === 'socks');
}

export function requiresFullUserSyncReload(
    activeInbounds: ConfigProfileInboundEntity[],
    serverType?: string,
): boolean {
    return (
        serverType === SERVER_TYPES.PUBLIC_DIRECT ||
        activeInbounds.some((inbound) =>
            ['mieru', 'socks', 'anytls'].includes(inbound.type.toLowerCase()),
        )
    );
}
