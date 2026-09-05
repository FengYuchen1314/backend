import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MieruConfig } from '@common/helpers/mieru-config';
import { XRayConfig } from '@common/helpers/xray-config';

import { syncInbounds } from './6_sync-inbounds';

test('startup sync accepts mixed Mieru/Xray profiles and preserves unchanged inbound identities', async () => {
    const mieru = { runtime: 'MIERU', listeners: [{ tag: 'MIERU', port: 24443, protocol: 'TCP' }] };
    const xray = {
        inbounds: [
            {
                tag: 'SOCKS',
                port: 1080,
                protocol: 'socks',
                settings: { auth: 'password', udp: false },
            },
        ],
    };
    const profiles = [
        { uuid: 'mieru-profile', name: 'Mieru', config: mieru },
        { uuid: 'xray-profile', name: 'Xray', config: xray },
    ];
    const rows = new Map([
        [
            'mieru-profile',
            new MieruConfig(mieru)
                .getAllInbounds()
                .map((row) => ({ ...row, uuid: 'stable-mieru-inbound' })),
        ],
        [
            'xray-profile',
            new XRayConfig(xray)
                .getAllInbounds()
                .map((row) => ({ ...row, uuid: 'stable-socks-inbound' })),
        ],
    ]);
    const prisma = {
        configProfiles: { findMany: async () => profiles },
        configProfileInbounds: {
            findMany: async ({ where }: { where: { profileUuid: string } }) =>
                rows.get(where.profileUuid),
            deleteMany: async () =>
                assert.fail('Unchanged profiles must not lose inbound/Host/squad bindings'),
            createMany: async () => assert.fail('Unchanged inbounds must keep their UUIDs'),
            update: async () => assert.fail('Unchanged inbounds need no rewrite'),
        },
    } as unknown as PrismaClient;
    await syncInbounds(prisma);
    await syncInbounds(prisma);
});
