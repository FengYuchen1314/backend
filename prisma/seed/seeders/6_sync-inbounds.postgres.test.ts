import 'reflect-metadata';
import { Prisma, PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

import { MieruConfig } from '@common/helpers/mieru-config';

import { syncInbounds } from './6_sync-inbounds';

test(
    'PostgreSQL startup keeps Mieru inbound, node and Host bindings across repeated sync',
    {
        skip: !process.env.EDGE_DATABASE_TEST_URL,
    },
    async () => {
        const prisma = new PrismaClient({
            datasources: { db: { url: process.env.EDGE_DATABASE_TEST_URL! } },
        });
        const rollback = new Error('Roll back the complete disposable Mieru sync fixture');
        try {
            await assert.rejects(
                prisma.$transaction(
                    async (tx) => {
                        const suffix = randomUUID();
                        const config = new MieruConfig({
                            runtime: 'MIERU',
                            listeners: [{ tag: `MIERU_${suffix}`, port: 24443, protocol: 'TCP' }],
                        });
                        const profile = await tx.configProfiles.create({
                            data: {
                                name: `mieru-seed-${suffix}`,
                                config: config.getConfig() as unknown as Prisma.InputJsonValue,
                            },
                        });
                        const definition = config.getAllInbounds()[0];
                        const inbound = await tx.configProfileInbounds.create({
                            data: {
                                ...definition,
                                profileUuid: profile.uuid,
                                rawInbound:
                                    definition.rawInbound as unknown as Prisma.InputJsonValue,
                            },
                        });
                        const node = await tx.nodes.create({
                            data: {
                                name: `mieru-seed-${suffix}`,
                                address: `${suffix}.example.invalid`,
                                serverType: 'LEASED_LINE',
                                activeConfigProfileUuid: profile.uuid,
                            },
                        });
                        const binding = await tx.configProfileInboundsToNodes.create({
                            data: { nodeUuid: node.uuid, configProfileInboundUuid: inbound.uuid },
                        });
                        const host = await tx.hosts.create({
                            data: {
                                remark: `mieru-seed-${suffix}`,
                                address: '192.0.2.12',
                                port: 24443,
                                configProfileUuid: profile.uuid,
                                configProfileInboundUuid: inbound.uuid,
                            },
                        });
                        for (let restart = 0; restart < 2; restart++) {
                            await syncInbounds(tx as PrismaClient);
                            assert.deepEqual(
                                await tx.configProfileInbounds.findUnique({
                                    where: { uuid: inbound.uuid },
                                }),
                                inbound,
                            );
                            assert.deepEqual(
                                await tx.nodes.findUnique({ where: { uuid: node.uuid } }),
                                node,
                            );
                            assert.deepEqual(
                                await tx.hosts.findUnique({ where: { uuid: host.uuid } }),
                                host,
                            );
                            assert.deepEqual(
                                await tx.configProfileInboundsToNodes.findMany({
                                    where: { nodeUuid: node.uuid },
                                }),
                                [binding],
                            );
                        }
                        throw rollback;
                    },
                    { timeout: 15000 },
                ),
                (error: unknown) => error === rollback,
            );
        } finally {
            await prisma.$disconnect();
        }
    },
);
