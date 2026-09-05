import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';
import { X509Certificate } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { AnyTlsMaterial } from './anytls-identity';

@Injectable()
export class AnyTlsMaterialRepository {
    constructor(private readonly prisma: TransactionHost<TransactionalAdapterPrisma>) {}

    read(inboundUuid: string) {
        return this.prisma.tx.anyTlsMaterial.findUnique({ where: { inboundUuid } });
    }

    async save(inboundUuid: string, revision: number, material: AnyTlsMaterial): Promise<boolean> {
        const expiresAt = new Date(new X509Certificate(material.tls.certificate).validTo);
        if (revision === 0) {
            try {
                await this.prisma.tx.anyTlsMaterial.create({
                    data: { inboundUuid, revision: 1, material, expiresAt },
                });
                return true;
            } catch (error) {
                if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002')
                    return false;
                throw error;
            }
        }
        const result = await this.prisma.tx.anyTlsMaterial.updateMany({
            where: { inboundUuid, revision },
            data: { material, expiresAt, revision: { increment: 1 } },
        });
        return result.count === 1;
    }

    async expiringProfiles(before: Date): Promise<string[]> {
        const rows = await this.prisma.tx.anyTlsMaterial.findMany({
            where: { expiresAt: { lt: before } },
            select: { inbound: { select: { profileUuid: true } } },
        });
        return [...new Set(rows.map((row) => row.inbound.profileUuid))];
    }
}
