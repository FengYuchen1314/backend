import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { HashedSet } from '@remnawave/hashed-set';

import {
    deriveSocksPassword,
    getSocksUserHashIdentity,
} from '@common/helpers/derive-socks-password';

import { UserForConfigEntity } from '@modules/users/entities/users-for-config';

import { XRayConfig } from './xray-config.validator';

const buildConfig = () => ({
    inbounds: [
        {
            tag: 'SOCKS_MANAGED',
            port: 10_800,
            protocol: 'socks',
            settings: {
                auth: 'password',
                accounts: [{ user: 'template-user', pass: 'template-password' }],
                users: [{ user: 'legacy-template-user', pass: 'legacy-template-password' }],
                udp: true,
            },
        },
        {
            tag: 'RAW_EXISTING',
            port: 10_801,
            protocol: 'dokodemo-door',
            settings: {
                address: '127.0.0.1',
                port: 80,
                network: 'tcp',
            },
        },
    ],
    outbounds: [{ tag: 'DIRECT', protocol: 'freedom' }],
});

test('socks inbound is managed while unrelated raw inbounds stay untouched', () => {
    const input = buildConfig();
    const config = new XRayConfig(input);

    assert.deepEqual(
        config.getAllInbounds().map((inbound) => ({ tag: inbound.tag, type: inbound.type })),
        [{ tag: 'SOCKS_MANAGED', type: 'socks' }],
    );

    config.cleanInboundClients(false);

    assert.equal('accounts' in input.inbounds[0].settings, false);
    assert.deepEqual(input.inbounds[0].settings.users, []);
    assert.equal(input.inbounds[0].settings.auth, 'password');
    assert.equal(input.inbounds[0].settings.udp, true);
    assert.deepEqual(input.inbounds[1].settings, {
        address: '127.0.0.1',
        port: 80,
        network: 'tcp',
    });
});

test('socks users use numeric ids, dedicated passwords, and matching hash identities', () => {
    const input = buildConfig();
    const config = new XRayConfig(input);
    const inboundHashes = new Map<string, HashedSet>();

    config.cleanInboundClients(false);
    config.includeUserBatch(
        [
            new UserForConfigEntity({
                id: 42n,
                trojanPassword: 'stable-user-password',
                vlessUuid: '56f01999-2f72-4e8b-a81e-5298e618ba39',
                ssPassword: 'unused',
                tags: ['SOCKS_MANAGED'],
            }),
        ],
        inboundHashes,
    );

    assert.equal('accounts' in input.inbounds[0].settings, false);
    const socksPassword = input.inbounds[0]?.settings.users?.[0]?.pass;

    assert.deepEqual(input.inbounds[0].settings.users, [
        {
            user: '42',
            pass: deriveSocksPassword(
                'stable-user-password',
                '56f01999-2f72-4e8b-a81e-5298e618ba39',
            ),
        },
    ]);
    assert.ok(socksPassword);
    assert.notEqual(socksPassword, 'stable-user-password');
    assert.equal(
        inboundHashes.get('SOCKS_MANAGED')?.hash64String,
        new HashedSet([getSocksUserHashIdentity('42', socksPassword)]).hash64String,
    );
    assert.notEqual(
        inboundHashes.get('SOCKS_MANAGED')?.hash64String,
        new HashedSet([
            getSocksUserHashIdentity(
                '42',
                deriveSocksPassword(
                    'changed-user-password',
                    '56f01999-2f72-4e8b-a81e-5298e618ba39',
                ),
            ),
        ]).hash64String,
    );
});

test('socks password derivation changes when either credential input changes', () => {
    const uuid = '56f01999-2f72-4e8b-a81e-5298e618ba39';
    const password = deriveSocksPassword('stable-user-password', uuid);

    assert.notEqual(password, deriveSocksPassword('changed-user-password', uuid));
    assert.notEqual(
        password,
        deriveSocksPassword('stable-user-password', 'd49f478d-eb3d-4da3-9fe8-a4aa59354fa5'),
    );
    assert.match(password, /^[A-Za-z0-9_-]{43}$/);
});
