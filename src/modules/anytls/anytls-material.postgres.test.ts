import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

import { anyTlsClientIdentity, issueAnyTlsMaterial } from './anytls-identity';
import { AnyTlsMaterialRepository } from './anytls-material.repository';
import { AnyTlsMaterialService } from './anytls-material.service';

test(
    'PostgreSQL AnyTLS identity CAS converges across panel workers, survives metadata sync, and cascades only with its inbound',
    { skip: !process.env.EDGE_DATABASE_TEST_URL },
    async () => {
        const prisma = new PrismaClient({
            datasources: { db: { url: process.env.EDGE_DATABASE_TEST_URL! } },
        });
        const uuid = randomUUID();
        const inboundUuid = randomUUID();
        const repository = new AnyTlsMaterialRepository({ tx: prisma } as never);
        try {
            await prisma.configProfiles.create({
                data: {
                    uuid,
                    name: `anytls-cas-${uuid}`,
                    config: { inbounds: [] },
                    configProfileInbounds: {
                        create: {
                            uuid: inboundUuid,
                            tag: `ANYTLS_${uuid.replaceAll('-', '')}`,
                            type: 'anytls',
                            port: 443,
                        },
                    },
                },
            });
            const services = Array.from(
                { length: 8 },
                () => new AnyTlsMaterialService(repository, {} as never),
            );
            const results = await Promise.all(
                services.map((service) => service.ensure(inboundUuid)),
            );
            const stored = await repository.read(inboundUuid);
            assert.equal(stored?.revision, 1);
            for (const result of results)
                assert.deepEqual(anyTlsClientIdentity(result), anyTlsClientIdentity(results[0]));
            await prisma.configProfileInbounds.update({
                where: { uuid: inboundUuid },
                data: {
                    rawInbound: { protocol: 'anytls', settings: { newDisplayMetadata: true } },
                },
            });
            assert.equal((await repository.read(inboundUuid))?.revision, 1);
            const publicInbound = await prisma.configProfileInbounds.findUnique({
                where: { uuid: inboundUuid },
            });
            assert.doesNotMatch(JSON.stringify(publicInbound), /privateKey|Password|caPrivateKey/);
            const later = new Date(Date.now() + 65 * 86400000);
            assert.ok(
                (
                    await repository.expiringProfiles(new Date(later.getTime() + 30 * 86400000))
                ).includes(uuid),
            );
            const renewed = await Promise.all(
                services.map((service) => service.ensure(inboundUuid, later)),
            );
            assert.equal((await repository.read(inboundUuid))?.revision, 2);
            for (const result of renewed)
                assert.deepEqual(anyTlsClientIdentity(result), anyTlsClientIdentity(results[0]));
            assert.equal(await repository.save(inboundUuid, 1, results[0]), false);
            assert.equal(
                (
                    await repository.expiringProfiles(new Date(later.getTime() + 30 * 86400000))
                ).includes(uuid),
                false,
            );
            await prisma.configProfileInbounds.delete({ where: { uuid: inboundUuid } });
            assert.equal(await repository.read(inboundUuid), null);
            const orphanMaterial = await issueAnyTlsMaterial(inboundUuid);
            await assert.rejects(
                repository.save(inboundUuid, 0, orphanMaterial),
                (error: { code?: string }) => error.code === 'P2003',
            );
        } finally {
            await prisma.configProfiles.deleteMany({ where: { uuid } });
            await prisma.$disconnect();
        }
    },
);
