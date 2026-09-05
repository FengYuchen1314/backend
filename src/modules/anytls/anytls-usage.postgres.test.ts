import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

import { TAnyTlsUsageSnapshot } from '@libs/contracts/models';

import { AnyTlsUsageRepository } from './anytls-usage.repository';

test(
    'PostgreSQL AnyTLS cumulative billing is atomic, replay-safe and physically scoped',
    { skip: !process.env.EDGE_DATABASE_TEST_URL, timeout: 60000 },
    async () => {
        const prisma = new PrismaClient({
            datasources: { db: { url: process.env.EDGE_DATABASE_TEST_URL! } },
        });
        const repository = new AnyTlsUsageRepository(prisma as never);
        const nodeUuid = randomUUID(),
            secondUuid = randomUUID(),
            userUuid = randomUUID(),
            epoch = randomUUID();
        let userId: bigint | undefined;
        try {
            const node = await prisma.nodes.create({
                data: {
                    uuid: nodeUuid,
                    name: `anytls-usage-${nodeUuid}`,
                    address: `${nodeUuid}.invalid`,
                    nodeConsumptionMultiplier: 2000000000n,
                },
            });
            const second = await prisma.nodes.create({
                data: {
                    uuid: secondUuid,
                    name: `anytls-usage-${secondUuid}`,
                    address: `${secondUuid}.invalid`,
                },
            });
            const user = await prisma.users.create({
                data: {
                    username: `usage-${userUuid}`,
                    shortUuid: userUuid,
                    expireAt: new Date(Date.now() + 86400000),
                    vlessUuid: userUuid,
                    trojanPassword: 'test-only',
                    ssPassword: 'test-only',
                    traffic: { create: {} },
                },
            });
            userId = user.id;
            const snapshot = (
                up: string,
                down = '0',
                generation = epoch,
            ): TAnyTlsUsageSnapshot => ({
                available: true,
                version: 1,
                epoch: generation,
                users: [{ username: String(user.id), uplink: up, downlink: down }],
            });
            const options = {
                nodeUuid,
                nodeId: node.id,
                consumptionMultiplier: '500000000',
                ignoreBelowBytes: 0n,
                recordHistory: true,
            };
            const writes = await Promise.all(
                Array.from({ length: 8 }, () => repository.record(snapshot('101', '200'), options)),
            );
            assert.equal(writes.flatMap((value) => value.firstConnected).length, 1);
            assert.equal(writes.flatMap((value) => value.onlineUsers).length, 1);
            let traffic = await prisma.userTraffic.findUniqueOrThrow({ where: { id: user.id } });
            assert.equal(traffic.usedTrafficBytes, 150n);
            assert.equal(traffic.lifetimeUsedTrafficBytes, 150n);
            assert.equal(
                (await prisma.nodes.findUniqueOrThrow({ where: { uuid: nodeUuid } }))
                    .trafficUsedBytes,
                602n,
            );
            assert.equal(
                (
                    await prisma.nodesUserUsageHistory.aggregate({
                        where: { nodeId: node.id },
                        _sum: { totalBytes: true },
                    })
                )._sum.totalBytes,
                301n,
            );
            await Promise.all(
                [
                    snapshot('103', '202'),
                    snapshot('100', '190'),
                    snapshot('102', '201'),
                    snapshot('103', '202'),
                ].map((value) => repository.record(value, options)),
            );
            traffic = await prisma.userTraffic.findUniqueOrThrow({ where: { id: user.id } });
            assert.equal(traffic.usedTrafficBytes, 152n);
            assert.equal(
                (await repository.record(snapshot('104', '202'), options)).firstConnected.length,
                0,
            );
            traffic = await prisma.userTraffic.findUniqueOrThrow({ where: { id: user.id } });
            assert.equal(traffic.usedTrafficBytes, 153n);
            const key = { nodeUuid_epoch: { nodeUuid, epoch } };
            const before = await prisma.anyTlsUsageLedger.findUniqueOrThrow({ where: key });
            await prisma.userTraffic.update({
                where: { id: user.id },
                data: { lifetimeUsedTrafficBytes: 9223372036854775807n },
            });
            await assert.rejects(repository.record(snapshot('106', '202'), options));
            assert.deepEqual(
                await prisma.anyTlsUsageLedger.findUniqueOrThrow({ where: key }),
                before,
            );
            assert.equal(
                (
                    await prisma.nodesUserUsageHistory.aggregate({
                        where: { nodeId: node.id },
                        _sum: { totalBytes: true },
                    })
                )._sum.totalBytes,
                306n,
            );
            await prisma.userTraffic.update({
                where: { id: user.id },
                data: { lifetimeUsedTrafficBytes: 153n },
            });
            await repository.record(snapshot('106', '202'), options);
            await repository.record(snapshot('106', '202'), options); // Lost post-commit response replay.
            assert.equal(
                (await prisma.userTraffic.findUniqueOrThrow({ where: { id: user.id } }))
                    .usedTrafficBytes,
                154n,
            );
            // Same epoch string on another physical server is an independent ledger.
            await repository.record(snapshot('10'), {
                ...options,
                nodeUuid: secondUuid,
                nodeId: second.id,
            });
            assert.equal(
                (await prisma.userTraffic.findUniqueOrThrow({ where: { id: user.id } }))
                    .usedTrafficBytes,
                159n,
            );
            await repository.record(snapshot('2', '0', randomUUID()), options);
            assert.equal(
                (await prisma.userTraffic.findUniqueOrThrow({ where: { id: user.id } }))
                    .usedTrafficBytes,
                160n,
            );
            const wrongEpoch = randomUUID();
            await assert.rejects(
                repository.record(snapshot('100', '0', wrongEpoch), {
                    ...options,
                    nodeId: second.id,
                }),
                /identity mismatch/,
            );
            assert.equal(
                await prisma.anyTlsUsageLedger.count({ where: { nodeUuid, epoch: wrongEpoch } }),
                0,
            );
            const hugeEpoch = randomUUID();
            await repository.record(snapshot('9007199254740993', '0', hugeEpoch), options);
            assert.equal(
                (await prisma.userTraffic.findUniqueOrThrow({ where: { id: user.id } }))
                    .usedTrafficBytes,
                4503599627370656n,
            );
            // Disabling optional raw user history does not disable charging or node history.
            const userHistoryBefore = (
                await prisma.nodesUserUsageHistory.aggregate({
                    where: { nodeId: node.id },
                    _sum: { totalBytes: true },
                })
            )._sum.totalBytes;
            await repository.record(snapshot('9007199254740995', '0', hugeEpoch), {
                ...options,
                recordHistory: false,
            });
            assert.equal(
                (
                    await prisma.nodesUserUsageHistory.aggregate({
                        where: { nodeId: node.id },
                        _sum: { totalBytes: true },
                    })
                )._sum.totalBytes,
                userHistoryBefore,
            );
            await prisma.users.delete({ where: { id: user.id } });
            await repository.record(snapshot('108', '202'), options);
            assert.equal(await prisma.userTraffic.count({ where: { id: user.id } }), 0);
            assert.deepEqual(
                (await repository.record(snapshot('108', '202'), options)).onlineUsers,
                [],
            );
            await prisma.nodes.delete({ where: { uuid: nodeUuid } });
            assert.equal(await prisma.anyTlsUsageLedger.count({ where: { nodeUuid } }), 0);
            assert.equal(
                await prisma.anyTlsUsageLedger.count({ where: { nodeUuid: secondUuid } }),
                1,
            );
        } finally {
            if (userId !== undefined) await prisma.users.deleteMany({ where: { id: userId } });
            await prisma.nodes.deleteMany({ where: { uuid: { in: [nodeUuid, secondUuid] } } });
            await prisma.$disconnect();
        }
    },
);
