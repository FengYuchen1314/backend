import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';
import { Prisma, PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

import { graph } from '../subscription-template/generators/topology-test-fixtures';
import { INTERNAL_TOPOLOGY_TEMPLATE_TYPE } from './topology.constants';
import { TopologyRepository } from './topology.repository';

test(
    'PostgreSQL topology publication defaults legacy rows to drafts and uses atomic version checks',
    {
        skip: !process.env.EDGE_DATABASE_TEST_URL,
    },
    async () => {
        const prisma = new PrismaClient({
            datasources: { db: { url: process.env.EDGE_DATABASE_TEST_URL! } },
        });
        const repository = new TopologyRepository({
            tx: prisma,
        } as unknown as TransactionHost<TransactionalAdapterPrisma>);
        let uuid: string | undefined;
        try {
            const name = `topology-test-${randomUUID()}`;
            const created = await repository.create(name, graph());
            uuid = created.uuid;
            assert.equal(created.isPublished, false);
            assert.equal(created.version, 1);
            await prisma.subscriptionTemplate.update({
                where: { uuid },
                data: {
                    templateJson: {
                        kind: INTERNAL_TOPOLOGY_TEMPLATE_TYPE,
                        schemaVersion: 1,
                        version: 1,
                        graph: graph(),
                    } as unknown as Prisma.InputJsonValue,
                },
            });
            assert.equal((await repository.findByUuid(uuid))!.isPublished, false);
            const writes = await Promise.all(
                Array.from({ length: 8 }, () =>
                    repository.updateIfVersion(uuid!, 1, name, graph(), true),
                ),
            );
            assert.equal(writes.filter(Boolean).length, 1);
            assert.equal((await repository.findByUuid(uuid))!.version, 2);
            assert.equal((await repository.findByUuid(uuid))!.isPublished, true);
            assert.equal(await repository.updateIfVersion(uuid, 1, name, graph(), false), null);
            assert.equal(await repository.deleteIfVersion(uuid, 1), false);
            assert.equal(
                (await repository.updateIfVersion(uuid, 2, name, graph(), false))!.isPublished,
                false,
            );
            assert.equal(await repository.deleteIfVersion(uuid, 3), true);
            assert.equal(await repository.findByUuid(uuid), null);
        } finally {
            // Only the exact row created by this test, never a table-wide cleanup.
            if (uuid) await prisma.subscriptionTemplate.deleteMany({ where: { uuid } });
            await prisma.$disconnect();
        }
    },
);
