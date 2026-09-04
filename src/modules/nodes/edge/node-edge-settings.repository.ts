import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';

import { Injectable } from '@nestjs/common';

import { NodeEdgeSettingsSchema, TNodeEdgeSettings } from '@libs/contracts/models';

@Injectable()
export class NodeEdgeSettingsRepository {
    constructor(private readonly prisma: TransactionHost<TransactionalAdapterPrisma>) {}

    async read(nodeId: bigint) {
        const current = await this.prisma.tx.nodeEdgeConfig.findUnique({ where: { nodeId } });
        if (current)
            return {
                revision: current.revision,
                settings: NodeEdgeSettingsSchema.parse(current.settings),
            };
        // Read old WIP metadata once until the administrator saves the first revision.
        const legacy = await this.prisma.tx.nodeMeta.findUnique({
            where: { nodeId },
            select: { metadata: true },
        });
        const metadata = legacy?.metadata;
        const settings =
            metadata && typeof metadata === 'object' && !Array.isArray(metadata)
                ? (metadata as Record<string, unknown>).xboardEdge
                : undefined;
        return { revision: 0, settings: NodeEdgeSettingsSchema.parse(settings ?? {}) };
    }

    async save(
        nodeId: bigint,
        expectedRevision: number,
        settings: TNodeEdgeSettings,
    ): Promise<boolean> {
        if (expectedRevision === 0) {
            try {
                await this.prisma.tx.nodeEdgeConfig.create({
                    data: { nodeId, revision: 1, settings },
                });
                return true;
            } catch (error) {
                if (
                    typeof error === 'object' &&
                    error !== null &&
                    'code' in error &&
                    error.code === 'P2002'
                )
                    return false;
                throw error;
            }
        }
        const result = await this.prisma.tx.nodeEdgeConfig.updateMany({
            where: { nodeId, revision: expectedRevision },
            data: { settings, revision: { increment: 1 } },
        });
        return result.count === 1;
    }
}
