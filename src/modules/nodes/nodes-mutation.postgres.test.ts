import 'reflect-metadata';
import { NestJsPrismaKyselyModule } from '@kastov/nestjs-prisma-kysely';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';
import { PrismaClient } from '@prisma/client';
import { Kysely } from 'kysely';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { DB } from 'prisma/generated/types';

import { FactoryProvider } from '@nestjs/common';

import { CustomCamelCasePlugin, JSON_COLUMNS } from '@common/database/camel-case.plugin';
import { TxKyselyService } from '@common/database/tx-kysely.service';

import { NodesConverter } from './nodes.converter';
import { NodesService } from './nodes.service';
import { NodesRepository } from './repositories/nodes.repository';

test(
    'PostgreSQL node mutations keep Prisma fields and Kysely inbound links atomic',
    { skip: !process.env.EDGE_DATABASE_TEST_URL, timeout: 60000 },
    async (context) => {
        const prisma = new PrismaClient({
            datasources: { db: { url: process.env.EDGE_DATABASE_TEST_URL! } },
        });
        const adapter = new TransactionalAdapterPrisma({ prismaInjectionToken: PrismaClient });
        const host = new TransactionHost<TransactionalAdapterPrisma>({
            ...adapter.optionsFactory(prisma),
            connectionName: undefined,
            enableTransactionProxy: false,
            defaultTxOptions: {},
        });
        // Use the same Kysely provider factory and CLS host as PrismaModule, without loading
        // unrelated queues, production configuration, or an application build in this test.
        const provider = NestJsPrismaKyselyModule.forRoot({
            transactionHostToken: TransactionHost,
            plugins: [new CustomCamelCasePlugin({ excludeColumns: JSON_COLUMNS })],
        }).providers![0] as FactoryProvider;
        const kysely = provider.useFactory(host) as Kysely<DB>;
        const repository = new NodesRepository(
            host,
            new TxKyselyService(kysely),
            new NodesConverter(),
        );
        const nodes = [randomUUID(), randomUUID(), randomUUID()];
        const profiles: string[] = [randomUUID(), randomUUID(), randomUUID()];
        const inbounds = [randomUUID(), randomUUID(), randomUUID()];
        const missingInbound = randomUUID();
        let failInsert = false;
        let delayInsert = false;
        const singleInsert = repository.addInboundsToNode.bind(repository);
        const bulkInsert = repository.addInboundsToNodes.bind(repository);
        repository.addInboundsToNode = async (uuid, selected) => {
            if (delayInsert) await host.tx.$executeRaw`SELECT pg_sleep(0.025)`;
            return singleInsert(uuid, failInsert ? [...selected, missingInbound] : selected);
        };
        repository.addInboundsToNodes = (uuids, selected) =>
            bulkInsert(uuids, failInsert ? [...selected, missingInbound] : selected);
        const effects: string[] = [];
        const readState = async () => {
            const [savedNodes, savedLinks] = await prisma.$transaction(
                [
                    prisma.nodes.findMany({
                        where: { uuid: { in: nodes } },
                        select: {
                            uuid: true,
                            name: true,
                            address: true,
                            activeConfigProfileUuid: true,
                        },
                        orderBy: { uuid: 'asc' },
                    }),
                    prisma.configProfileInboundsToNodes.findMany({
                        where: { nodeUuid: { in: nodes } },
                        orderBy: [{ nodeUuid: 'asc' }, { configProfileInboundUuid: 'asc' }],
                    }),
                ],
                { isolationLevel: 'RepeatableRead' },
            );
            return { nodes: savedNodes, links: savedLinks };
        };
        const assertConsistent = async () => {
            const state = await readState();
            for (const node of state.nodes) {
                const profileIndex = profiles.indexOf(node.activeConfigProfileUuid!);
                assert.notEqual(profileIndex, -1);
                assert.deepEqual(
                    state.links
                        .filter((link) => link.nodeUuid === node.uuid)
                        .map((link) => link.configProfileInboundUuid),
                    [inbounds[profileIndex]],
                );
            }
        };
        const queued = async () => {
            assert.equal(host.isTransactionActive(), false);
            await assertConsistent(); // Separate client proves the queue sees committed state.
            effects.push('queue');
        };
        const service = new NodesService(
            repository,
            {
                emit() {
                    assert.equal(host.isTransactionActive(), false);
                    effects.push('event');
                },
            } as never,
            { startNode: queued, startAllNodesByProfile: queued } as never,
            {
                async execute(query: { uuid: string }) {
                    return {
                        isOk: true,
                        response: {
                            inbounds: await prisma.configProfileInbounds.findMany({
                                where: { profileUuid: query.uuid },
                            }),
                        },
                    };
                },
            } as never,
            {} as never,
            {
                async getOne() {
                    return { system: null, onlineUsers: 0, versions: null, xrayUptime: 0 };
                },
            } as never,
        );
        (service as unknown as { logger: { error(): void } }).logger = { error() {} };
        const selection = (index: number) => ({
            activeConfigProfileUuid: profiles[index],
            activeInbounds: [inbounds[index]],
        });

        try {
            for (let index = 0; index < profiles.length; index++) {
                await prisma.configProfiles.create({
                    data: {
                        uuid: profiles[index],
                        name: `mutation-profile-${profiles[index]}`,
                        config: {},
                        configProfileInbounds: {
                            create: {
                                uuid: inbounds[index],
                                tag: `mutation-${inbounds[index]}`,
                                type: 'socks',
                            },
                        },
                    },
                });
            }
            for (const uuid of nodes) {
                await prisma.nodes.create({
                    data: {
                        uuid,
                        name: `mutation-node-${uuid}`,
                        address: `${uuid}.example.invalid`,
                        activeConfigProfileUuid: profiles[0],
                        configProfileInboundsToNodes: {
                            create: { configProfileInboundUuid: inbounds[0] },
                        },
                    },
                });
            }
            await context.test(
                'unique name/address failures retain the original selection',
                async () => {
                    const before = await readState();
                    for (const fields of [
                        { name: `mutation-node-${nodes[2]}` },
                        { address: `${nodes[2]}.example.invalid` },
                    ]) {
                        const result = await service.updateNode({
                            uuid: nodes[0],
                            ...fields,
                            configProfile: selection(1),
                        } as never);
                        assert.equal(result.isOk, false);
                        assert.deepEqual(await readState(), before);
                        assert.deepEqual(effects, []);
                    }
                },
            );
            await context.test(
                'a Kysely FK insert failure rolls back single and bulk Prisma changes',
                async () => {
                    const before = await readState();
                    failInsert = true;
                    const single = await service.updateNode({
                        uuid: nodes[0],
                        name: `changed-${nodes[0]}`,
                        configProfile: selection(1),
                    } as never);
                    assert.equal(single.isOk, false);
                    assert.deepEqual(await readState(), before);
                    const bulk = await service.profileModification({
                        uuids: nodes.slice(0, 2),
                        configProfile: selection(1),
                    } as never);
                    assert.equal(bulk.isOk, false);
                    assert.deepEqual(await readState(), before);
                    assert.deepEqual(effects, []);
                    failInsert = false;
                },
            );
            await context.test(
                'successful single and bulk mutations expose complete committed state',
                async () => {
                    const single = await service.updateNode({
                        uuid: nodes[0],
                        configProfile: selection(1),
                    } as never);
                    assert.equal(single.isOk, true);
                    if (single.isOk)
                        assert.deepEqual(
                            single.response.configProfile.activeInbounds.map(
                                (inbound) => inbound.uuid,
                            ),
                            [inbounds[1]],
                        );
                    assert.deepEqual(effects, ['queue', 'event']);
                    const bulk = await service.profileModification({
                        uuids: nodes.slice(0, 2),
                        configProfile: selection(2),
                    } as never);
                    assert.equal(bulk.isOk, true);
                    assert.deepEqual(effects, ['queue', 'event', 'queue']);
                    await assertConsistent();
                },
            );
            await context.test(
                'overlapping replacements cannot merge two profiles inbound links',
                async () => {
                    delayInsert = true;
                    const results = await Promise.all(
                        Array.from({ length: 8 }, (_, index) =>
                            service.updateNode({
                                uuid: nodes[0],
                                configProfile: selection((index % 2) + 1),
                            } as never),
                        ),
                    );
                    assert.equal(
                        results.every((result) => result.isOk),
                        true,
                    );
                    await assertConsistent();
                },
            );
        } finally {
            await prisma.nodes.deleteMany({ where: { uuid: { in: nodes } } });
            await prisma.configProfiles.deleteMany({ where: { uuid: { in: profiles } } });
            await kysely.destroy();
            await prisma.$disconnect();
        }
    },
);
