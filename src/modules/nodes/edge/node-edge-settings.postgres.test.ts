import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

import { NodeEdgeSettingsRepository } from './node-edge-settings.repository';

test(
    'PostgreSQL edge settings CAS survives concurrent saves and Agent metadata replacement',
    {
        skip: !process.env.EDGE_DATABASE_TEST_URL,
    },
    async () => {
        const prisma = new PrismaClient({
            datasources: { db: { url: process.env.EDGE_DATABASE_TEST_URL! } },
        });
        const uuid = randomUUID();
        const node = await prisma.nodes.create({
            data: { uuid, name: `edge-test-${uuid}`, address: `${uuid}.example.invalid` },
        });
        const repo = new NodeEdgeSettingsRepository({
            tx: prisma,
        } as unknown as TransactionHost<TransactionalAdapterPrisma>);
        try {
            const old = {
                management: null,
                website: { domains: ['old.example.com'], upstream: 'http://127.0.0.1:3000/' },
            };
            await prisma.nodeMeta.create({
                data: { nodeId: node.id, metadata: { xboardEdge: old, report: 'first' } },
            });
            assert.deepEqual(await repo.read(node.id), { revision: 0, settings: old });
            const fresh = {
                management: null,
                website: { domains: ['new.example.com'], upstream: 'http://127.0.0.1:3001/' },
            };
            const creates = await Promise.all(
                Array.from({ length: 8 }, () => repo.save(node.id, 0, fresh)),
            );
            assert.equal(creates.filter(Boolean).length, 1);
            await prisma.nodeMeta.update({
                where: { nodeId: node.id },
                data: { metadata: { report: 'replacement', xboardEdge: old } },
            });
            assert.deepEqual(await repo.read(node.id), { revision: 1, settings: fresh });
            const updates = await Promise.all(
                Array.from({ length: 8 }, () => repo.save(node.id, 1, old)),
            );
            assert.equal(updates.filter(Boolean).length, 1);
            assert.deepEqual(await repo.read(node.id), { revision: 2, settings: old });
            assert.equal(await repo.save(node.id, 1, fresh), false);
            await prisma.nodes.delete({ where: { uuid } });
            assert.equal(
                await prisma.nodeEdgeConfig.findUnique({ where: { nodeId: node.id } }),
                null,
            );
        } finally {
            await prisma.nodes.deleteMany({ where: { uuid } });
            await prisma.$disconnect();
        }
    },
);
