import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';
import { Prisma, SubscriptionTemplate } from '@prisma/client';
import z from 'zod';

import { Injectable } from '@nestjs/common';

import { TTopologyGraph, TopologyGraphSchema } from '@libs/contracts/models';

import { INTERNAL_TOPOLOGY_TEMPLATE_TYPE } from './topology.constants';
import {
    StoredTopologyEnvelope,
    TopologyRecord,
    TopologyReferenceSnapshot,
} from './topology.types';

const StoredTopologyEnvelopeSchema = z.object({
    kind: z.literal(INTERNAL_TOPOLOGY_TEMPLATE_TYPE),
    schemaVersion: z.literal(1),
    version: z.int().positive(),
    graph: TopologyGraphSchema,
});

type TopologyRow = Pick<
    SubscriptionTemplate,
    'createdAt' | 'name' | 'templateJson' | 'updatedAt' | 'uuid'
>;

@Injectable()
export class TopologyRepository {
    constructor(private readonly prisma: TransactionHost<TransactionalAdapterPrisma>) {}

    public async findAll(): Promise<TopologyRecord[]> {
        const rows = await this.prisma.tx.subscriptionTemplate.findMany({
            where: { templateType: INTERNAL_TOPOLOGY_TEMPLATE_TYPE },
            orderBy: { viewPosition: 'asc' },
            select: {
                uuid: true,
                name: true,
                templateJson: true,
                createdAt: true,
                updatedAt: true,
            },
        });

        return rows.map((row) => this.toRecord(row));
    }

    public async findByUuid(uuid: string): Promise<null | TopologyRecord> {
        const row = await this.prisma.tx.subscriptionTemplate.findFirst({
            where: { uuid, templateType: INTERNAL_TOPOLOGY_TEMPLATE_TYPE },
            select: {
                uuid: true,
                name: true,
                templateJson: true,
                createdAt: true,
                updatedAt: true,
            },
        });

        return row ? this.toRecord(row) : null;
    }

    public async nameExists(name: string, exceptUuid?: string): Promise<boolean> {
        const count = await this.prisma.tx.subscriptionTemplate.count({
            where: {
                templateType: INTERNAL_TOPOLOGY_TEMPLATE_TYPE,
                name,
                ...(exceptUuid ? { uuid: { not: exceptUuid } } : {}),
            },
        });
        return count > 0;
    }

    public async create(name: string, graph: TTopologyGraph): Promise<TopologyRecord> {
        const envelope = this.createEnvelope(1, graph);
        const row = await this.prisma.tx.subscriptionTemplate.create({
            data: {
                name,
                templateType: INTERNAL_TOPOLOGY_TEMPLATE_TYPE,
                tags: [],
                templateYaml: null,
                templateJson: envelope as unknown as Prisma.InputJsonValue,
            },
            select: {
                uuid: true,
                name: true,
                templateJson: true,
                createdAt: true,
                updatedAt: true,
            },
        });

        return this.toRecord(row);
    }

    public async updateIfVersion(
        uuid: string,
        expectedVersion: number,
        name: string,
        graph: TTopologyGraph,
    ): Promise<null | TopologyRecord> {
        const envelope = this.createEnvelope(expectedVersion + 1, graph);
        const serializedEnvelope = JSON.stringify(envelope);

        const rows = await this.prisma.tx.$queryRaw<TopologyRow[]>(Prisma.sql`
            UPDATE subscription_templates
               SET name = ${name},
                   template_json = ${serializedEnvelope}::jsonb,
                   updated_at = NOW()
             WHERE uuid = ${uuid}::uuid
               AND template_type = ${INTERNAL_TOPOLOGY_TEMPLATE_TYPE}
               AND (template_json ->> 'version')::integer = ${expectedVersion}
         RETURNING uuid::text AS "uuid",
                   name AS "name",
                   template_json AS "templateJson",
                   created_at AS "createdAt",
                   updated_at AS "updatedAt"
        `);

        return rows[0] ? this.toRecord(rows[0]) : null;
    }

    public async deleteIfVersion(uuid: string, expectedVersion: number): Promise<boolean> {
        const rows = await this.prisma.tx.$queryRaw<Array<{ uuid: string }>>(Prisma.sql`
            DELETE FROM subscription_templates
             WHERE uuid = ${uuid}::uuid
               AND template_type = ${INTERNAL_TOPOLOGY_TEMPLATE_TYPE}
               AND (template_json ->> 'version')::integer = ${expectedVersion}
         RETURNING uuid::text AS "uuid"
        `);

        return rows.length === 1;
    }

    public async getReferenceSnapshot(graph: TTopologyGraph): Promise<TopologyReferenceSnapshot> {
        const proxyNodes = graph.nodes.filter((node) => node.kind === 'PROXY');
        const hostUuids = [...new Set(proxyNodes.map((node) => node.hostUuid))];
        const nodeUuids = [...new Set(proxyNodes.map((node) => node.nodeUuid))];

        const [nodes, hosts] = await Promise.all([
            this.prisma.tx.nodes.findMany({
                where: { uuid: { in: nodeUuids } },
                select: { uuid: true },
            }),
            this.prisma.tx.hosts.findMany({
                where: { uuid: { in: hostUuids } },
                select: {
                    uuid: true,
                    configProfileInboundUuid: true,
                    nodes: { select: { nodeUuid: true } },
                    configProfileInbounds: {
                        select: {
                            configProfileInboundsToNodes: { select: { nodeUuid: true } },
                        },
                    },
                },
            }),
        ]);

        return {
            nodeUuids: new Set(nodes.map((node) => node.uuid)),
            hosts: new Map(
                hosts.map((host) => [
                    host.uuid,
                    {
                        nodeUuids: new Set(host.nodes.map((node) => node.nodeUuid)),
                        activeInboundNodeUuids: new Set(
                            host.configProfileInbounds?.configProfileInboundsToNodes.map(
                                (node) => node.nodeUuid,
                            ) ?? [],
                        ),
                    },
                ]),
            ),
        };
    }

    private createEnvelope(version: number, graph: TTopologyGraph): StoredTopologyEnvelope {
        return {
            kind: INTERNAL_TOPOLOGY_TEMPLATE_TYPE,
            schemaVersion: 1,
            version,
            graph,
        };
    }

    private toRecord(row: TopologyRow): TopologyRecord {
        const envelope = StoredTopologyEnvelopeSchema.parse(row.templateJson);
        return {
            uuid: row.uuid,
            name: row.name,
            version: envelope.version,
            graph: envelope.graph,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
        };
    }
}
