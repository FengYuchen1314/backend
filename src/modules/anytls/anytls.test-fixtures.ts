import { TAnyTlsConfig } from '@libs/contracts/models';

import { ConfigProfileInboundEntity } from '@modules/config-profiles/entities';

export const ANYTLS_UUID = '11111111-1111-4111-8111-111111111111';
export const ANYTLS_PROFILE_UUID = '22222222-2222-4222-8222-222222222222';
export const anyTlsDefinition = () => ({
    tag: 'ANYTLS_A',
    wrapperPort: 14443,
    innerPort: 14001,
    camouflage: { serverName: 'cover.example.com', address: '192.0.2.10', port: 443 },
});
export const anyTlsProfile = () => ({
    inbounds: [],
    outbounds: [{ tag: 'DIRECT', protocol: 'freedom' }],
    xboardAnyTls: { version: 1, listeners: [anyTlsDefinition()] },
});
export const anyTlsInbound = () =>
    new ConfigProfileInboundEntity({
        uuid: ANYTLS_UUID,
        profileUuid: ANYTLS_PROFILE_UUID,
        tag: 'ANYTLS_A',
        type: 'anytls',
        network: 'tcp',
        security: 'tls',
        port: 443,
        rawInbound: { protocol: 'anytls', tag: 'ANYTLS_A', settings: anyTlsDefinition() },
    });
// Schema-only fixture, deliberately not a usable certificate or a production credential.
export const anyTlsConfigFixture = (): TAnyTlsConfig => ({
    version: 1,
    listeners: [
        {
            ...anyTlsDefinition(),
            id: ANYTLS_UUID,
            wrapperPassword: 'w'.repeat(32),
            shadowPassword: 's'.repeat(32),
            users: [],
            tls: {
                serverName: `${ANYTLS_UUID}.anytls.internal`,
                certificate: 'test'.repeat(32),
                privateKey: 'test'.repeat(32),
                caCertificate: 'test'.repeat(32),
            },
        },
    ],
});
