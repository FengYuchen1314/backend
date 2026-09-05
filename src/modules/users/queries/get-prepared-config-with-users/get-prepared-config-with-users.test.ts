import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { deriveAnyTlsPassword, issueAnyTlsMaterial } from '@modules/anytls/anytls-identity';
import {
    anyTlsInbound,
    anyTlsProfile,
    ANYTLS_PROFILE_UUID,
    ANYTLS_UUID,
} from '@modules/anytls/anytls.test-fixtures';
import { ConfigProfileInboundEntity } from '@modules/config-profiles/entities';
import { GetConfigProfileByUuidQuery } from '@modules/config-profiles/queries/get-config-profile-by-uuid';

import { GetPreparedConfigWithUsersHandler } from './get-prepared-config-with-users.handler';
import { GetPreparedConfigWithUsersQuery } from './get-prepared-config-with-users.query';

test('one user stream populates separate native/AnyTLS entitlement sets without exposing the CA key', async () => {
    const material = await issueAnyTlsMaterial(ANYTLS_UUID);
    const profile = {
        ...anyTlsProfile(),
        inbounds: [
            {
                tag: 'VLESS',
                protocol: 'vless',
                port: 443,
                settings: { clients: [{ id: 'stale' }] },
            },
        ],
    };
    const inactive = {
        ...profile.xboardAnyTls.listeners[0],
        tag: 'INACTIVE',
        innerPort: 14002,
        wrapperPort: 14444,
        camouflage: { serverName: 'inactive.example.com', address: '192.0.2.11', port: 443 },
    };
    profile.xboardAnyTls.listeners.push(inactive);
    const activeInbounds = [
        anyTlsInbound(),
        new ConfigProfileInboundEntity({
            uuid: '33333333-3333-4333-8333-333333333333',
            profileUuid: ANYTLS_PROFILE_UUID,
            tag: 'VLESS',
            type: 'vless',
        }),
    ];
    const users = [
        {
            id: 1n,
            trojanPassword: 'one',
            vlessUuid: '11111111-1111-4111-8111-111111111111',
            ssPassword: 'one',
            tags: ['ANYTLS_A'],
        },
        {
            id: 2n,
            trojanPassword: 'two',
            vlessUuid: '22222222-2222-4222-8222-222222222222',
            ssPassword: 'two',
            tags: ['VLESS'],
        },
        {
            id: 3n,
            trojanPassword: 'three',
            vlessUuid: '33333333-3333-4333-8333-333333333333',
            ssPassword: 'three',
            tags: ['ANYTLS_A', 'ANYTLS_A', 'VLESS', 'VLESS'],
        },
        {
            id: 4n,
            trojanPassword: 'four',
            vlessUuid: '44444444-4444-4444-8444-444444444444',
            ssPassword: 'four',
            tags: ['INACTIVE'],
        },
    ];
    let streams = 0;
    const identities: string[] = [];
    const handler = new GetPreparedConfigWithUsersHandler(
        {
            async *getUsersForConfigStream(inbounds: unknown) {
                assert.equal(inbounds, activeInbounds);
                streams++;
                yield users.slice(0, 2);
                yield users.slice(2);
            },
        } as never,
        {
            async execute(query: unknown) {
                return {
                    isOk: true,
                    response:
                        query instanceof GetConfigProfileByUuidQuery ? { config: profile } : [],
                };
            },
        } as never,
        {
            async ensure(uuid: string) {
                identities.push(uuid);
                return material;
            },
        } as never,
    );
    const result = await handler.execute(
        new GetPreparedConfigWithUsersQuery(ANYTLS_PROFILE_UUID, activeInbounds),
    );
    assert.equal(result.isOk, true);
    if (!result.isOk) return;
    assert.equal(streams, 1);
    assert.deepEqual(identities, [ANYTLS_UUID]);
    assert.deepEqual(result.response.anyTlsConfig?.listeners[0].users, [
        { name: '1', password: deriveAnyTlsPassword('one', ANYTLS_UUID) },
        { name: '3', password: deriveAnyTlsPassword('three', ANYTLS_UUID) },
    ]);
    assert.equal(result.response.anyTlsConfig?.listeners.length, 1);
    assert.doesNotMatch(
        JSON.stringify(result.response),
        /caPrivateKey|xboardAnyTls|INACTIVE|stale/,
    );
    const native = result.response.config as {
        inbounds: { settings: { clients: { email: string }[] } }[];
    };
    assert.deepEqual(
        native.inbounds[0].settings.clients.map((client) => client.email),
        ['2', '3'],
    );
    assert.deepEqual(
        result.response.hashesPayload.inbounds.map((inbound) => inbound.tag),
        ['VLESS'],
    );
});

test('preparation rejects foreign or missing active AnyTLS inbounds before streaming users', async () => {
    for (const inbound of [
        new ConfigProfileInboundEntity({ ...anyTlsInbound(), profileUuid: 'foreign' }),
        new ConfigProfileInboundEntity({ ...anyTlsInbound(), tag: 'MISSING' }),
    ]) {
        const handler = new GetPreparedConfigWithUsersHandler(
            {
                getUsersForConfigStream() {
                    assert.fail('must not stream');
                },
            } as never,
            {
                async execute(query: unknown) {
                    return {
                        isOk: true,
                        response:
                            query instanceof GetConfigProfileByUuidQuery
                                ? { config: anyTlsProfile() }
                                : [],
                    };
                },
            } as never,
            {
                ensure() {
                    assert.fail('must not issue identity');
                },
            } as never,
        );
        assert.equal(
            (
                await handler.execute(
                    new GetPreparedConfigWithUsersQuery(ANYTLS_PROFILE_UUID, [inbound]),
                )
            ).isOk,
            false,
        );
    }
});
