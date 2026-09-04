import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ConfigProfileInboundEntity } from '@modules/config-profiles/entities';

import { GetPreparedMitaConfigWithUsersHandler } from './get-prepared-mita-config-with-users.handler';
import { GetPreparedMitaConfigWithUsersQuery } from './get-prepared-mita-config-with-users.query';

const inbound = new ConfigProfileInboundEntity({
    uuid: '1253df12-42fd-4f87-9d11-d21811ce2241',
    profileUuid: 'ff294d9d-be14-4610-ae9d-701e4c307dd0',
    tag: 'MIERU_TCP_24443',
    type: 'mieru',
    network: 'tcp',
    security: null,
    port: 24_443,
    rawInbound: {
        protocol: 'mieru',
        settings: {
            port: 24_443,
            transport: 'TCP',
            mtu: 1_400,
            multiplexing: 'MULTIPLEXING_LOW',
            handshakeMode: 'HANDSHAKE_STANDARD',
            userHintIsMandatory: true,
            metricsLoggingInterval: '1m',
            loggingLevel: 'INFO',
        },
    },
});

test('prepared Mita config contains active bindings and all entitled users', async () => {
    const usersRepository = {
        async *getUsersForConfigStream() {
            yield [
                { id: 42n, trojanPassword: 'password-42', tags: [inbound.tag] },
                { id: 84n, trojanPassword: 'password-84', tags: [inbound.tag] },
            ];
        },
    };
    const handler = new GetPreparedMitaConfigWithUsersHandler(usersRepository as never);
    const result = await handler.execute(new GetPreparedMitaConfigWithUsersQuery([inbound]));

    assert.equal(result.isOk, true);
    if (!result.isOk) return;

    assert.deepEqual(result.response, {
        kind: 'ISOLATED_LISTENERS',
        instances: [
            {
                id: inbound.uuid,
                config: {
                    portBindings: [{ port: 24_443, protocol: 'TCP' }],
                    users: [
                        { name: '42', password: 'password-42' },
                        { name: '84', password: 'password-84' },
                    ],
                    advancedSettings: {
                        metricsLoggingInterval: '1m',
                        userHintIsMandatory: true,
                    },
                    loggingLevel: 'INFO',
                    mtu: 1_400,
                },
            },
        ],
    });
});

test('Mieru listeners retain their separate squad permissions, including users in both squads', async () => {
    const second = new ConfigProfileInboundEntity({
        ...inbound,
        uuid: '2253df12-42fd-4f87-9d11-d21811ce2241',
        tag: 'MIERU_B',
        port: 25443,
        rawInbound: {
            protocol: 'mieru',
            settings: {
                ...(inbound.rawInbound as { settings: object }).settings,
                port: 25443,
            },
        },
    });
    const handler = new GetPreparedMitaConfigWithUsersHandler({
        async *getUsersForConfigStream() {
            yield [
                { id: 1n, trojanPassword: 'a', tags: [inbound.tag] },
                { id: 2n, trojanPassword: 'b', tags: [second.tag] },
                { id: 3n, trojanPassword: 'both', tags: [inbound.tag, second.tag, second.tag] },
                { id: 4n, trojanPassword: 'unentitled', tags: ['other-inbound'] },
            ];
        },
    } as never);
    const result = await handler.execute(
        new GetPreparedMitaConfigWithUsersQuery([inbound, second]),
    );
    assert.equal(result.isOk, true);
    if (!result.isOk) return;
    assert.deepEqual(
        result.response.instances.map((instance) => ({
            id: instance.id,
            ports: instance.config.portBindings,
            users: instance.config.users.map((user) => user.name),
        })),
        [
            { id: inbound.uuid, ports: [{ port: 24443, protocol: 'TCP' }], users: ['1', '3'] },
            { id: second.uuid, ports: [{ port: 25443, protocol: 'TCP' }], users: ['2', '3'] },
        ],
    );
});
