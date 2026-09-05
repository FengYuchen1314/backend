import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { Injectable } from '@nestjs/common';

import { PrismaService } from '@common/database/prisma.service';
import {
    AnyTlsUsageCounterSchema,
    AnyTlsUsageSnapshotSchema,
    TAnyTlsUsageSnapshot,
} from '@libs/contracts/models';

import { BulkUpdateUserUsedTrafficBuilder } from '@modules/users/builders';

const NANO = 1000000000n;
const MAX_DB = 9223372036854775807n;
const LedgerCounterSchema = AnyTlsUsageCounterSchema.extend({
    remainderNano: z
        .string()
        .regex(/^(0|[1-9]\d{0,8})$/)
        .default('0'),
});
const LedgerSchema = z.record(z.string(), LedgerCounterSchema);
export interface AnyTlsUsageOptions {
    nodeUuid: string;
    nodeId: bigint;
    consumptionMultiplier: string;
    ignoreBelowBytes: bigint;
    recordHistory: boolean;
}

// A pure integer calculation shared by the transaction and adversarial unit tests.
export function calculateAnyTlsUsage(
    snapshot: TAnyTlsUsageSnapshot,
    previous: unknown,
    options: Pick<AnyTlsUsageOptions, 'consumptionMultiplier' | 'ignoreBelowBytes'>,
) {
    AnyTlsUsageSnapshotSchema.parse(snapshot);
    const counters = LedgerSchema.parse(previous);
    if (!/^\d{1,19}$/.test(options.consumptionMultiplier) || options.ignoreBelowBytes < 0n)
        throw new Error('Invalid AnyTLS accounting policy.');
    const multiplier = BigInt(options.consumptionMultiplier);
    if (multiplier > MAX_DB)
        throw new Error('AnyTLS accounting multiplier exceeds the database limit.');
    const deltas: Array<{
        username: string;
        raw: bigint;
        charged: bigint;
        uplink: bigint;
        downlink: bigint;
    }> = [];
    for (const user of snapshot.users) {
        // Standalone Agent configs can contain arbitrary native usernames. Only
        // positive panel IDs are billable; never coerce ambiguous identifiers.
        if (!/^[1-9]\d{0,18}$/.test(user.username) || BigInt(user.username) > MAX_DB) continue;
        const prior = counters[user.username] ?? { uplink: '0', downlink: '0', remainderNano: '0' };
        const up = BigInt(user.uplink) - BigInt(prior.uplink);
        const down = BigInt(user.downlink) - BigInt(prior.downlink);
        if (up <= 0n && down <= 0n) continue; // Duplicate or older snapshot.
        if (up < 0n || down < 0n) throw new Error('Incomparable cumulative AnyTLS snapshot.');
        const raw = up + down;
        // Keep sub-threshold bytes pending in the cursor, so later polls accumulate them.
        if (raw < options.ignoreBelowBytes) continue;
        const numerator = raw * multiplier + BigInt(prior.remainderNano);
        const charged = numerator / NANO;
        if (raw > MAX_DB || charged > MAX_DB)
            throw new Error('AnyTLS accounting delta exceeds the database limit.');
        counters[user.username] = {
            uplink: user.uplink,
            downlink: user.downlink,
            remainderNano: String(numerator % NANO),
        };
        deltas.push({ username: user.username, raw, charged, uplink: up, downlink: down });
    }
    deltas.sort((a, b) => (BigInt(a.username) < BigInt(b.username) ? -1 : 1));
    return { counters, deltas };
}

@Injectable()
export class AnyTlsUsageRepository {
    constructor(private readonly prisma: PrismaService) {}

    async record(snapshot: TAnyTlsUsageSnapshot, options: AnyTlsUsageOptions) {
        const parsed = AnyTlsUsageSnapshotSchema.parse(snapshot);
        z.uuid().parse(options.nodeUuid);
        for (let attempt = 0; ; attempt++) {
            try {
                return await this.prisma.$transaction(
                    async (tx) => {
                        // INSERT + FOR UPDATE serializes concurrent polls for this epoch.
                        // No acknowledgement leaves the Agent: a failed transaction is replayable.
                        await tx.$executeRaw`INSERT INTO "anytls_usage_ledgers" ("node_uuid", "epoch")
                        VALUES (${options.nodeUuid}::uuid, ${parsed.epoch}::uuid) ON CONFLICT DO NOTHING`;
                        const rows = await tx.$queryRaw<
                            Array<{ counters: Prisma.JsonValue; nodeRemainderNano: bigint }>
                        >`SELECT "counters", "node_remainder_nano" AS "nodeRemainderNano" FROM "anytls_usage_ledgers"
                        WHERE "node_uuid" = ${options.nodeUuid}::uuid AND "epoch" = ${parsed.epoch}::uuid FOR UPDATE`;
                        if (rows.length !== 1)
                            throw new Error('AnyTLS accounting cursor unavailable.');
                        const node = await tx.nodes.findUnique({
                            where: { uuid: options.nodeUuid },
                            select: { id: true, nodeConsumptionMultiplier: true },
                        });
                        if (node?.id !== options.nodeId)
                            throw new Error('AnyTLS accounting physical-node identity mismatch.');
                        const { counters, deltas } = calculateAnyTlsUsage(
                            parsed,
                            rows[0].counters,
                            options,
                        );
                        const firstConnected: { id: bigint }[] = [];
                        const onlineUsers: string[] = [];
                        for (let start = 0; start < deltas.length; start += 1000) {
                            const batch = deltas.slice(start, start + 1000);
                            const ids = batch.map((value) => BigInt(value.username));
                            // Lock in the same order as native usage updates and traffic resets.
                            const existing = await tx.$queryRaw<
                                Array<{ id: bigint; firstConnectedAt: Date | null }>
                            >`SELECT "id", "first_connected_at" AS "firstConnectedAt" FROM "user_traffic" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`;
                            const existingIds = new Set(existing.map((value) => String(value.id)));
                            const live = batch.filter((value) => existingIds.has(value.username));
                            if (!live.length) continue; // Deleted users are consumed, never recreated.
                            onlineUsers.push(...live.map((value) => value.username));
                            const { query } = new BulkUpdateUserUsedTrafficBuilder(
                                live.map((value) => ({
                                    u: value.username,
                                    b: String(value.charged),
                                    n: options.nodeUuid,
                                })),
                            );
                            await tx.$queryRaw(query);
                            firstConnected.push(
                                ...existing
                                    .filter((value) => value.firstConnectedAt === null)
                                    .map(({ id }) => ({ id })),
                            );
                            if (options.recordHistory) {
                                const values = Prisma.join(
                                    live.map(
                                        (value) =>
                                            Prisma.sql`(${BigInt(value.username)}, ${value.raw})`,
                                    ),
                                );
                                await tx.$executeRaw`INSERT INTO "nodes_user_usage_history" ("node_id", "user_id", "total_bytes", "created_at", "updated_at")
                                SELECT ${options.nodeId}, data.id, data.bytes, CURRENT_DATE, NOW() FROM (VALUES ${values}) AS data(id, bytes)
                                ON CONFLICT ("node_id", "created_at", "user_id") DO UPDATE SET
                                "total_bytes" = "nodes_user_usage_history"."total_bytes" + EXCLUDED."total_bytes", "updated_at" = NOW()`;
                            }
                        }
                        if (deltas.length) {
                            const uplink = deltas.reduce((sum, value) => sum + value.uplink, 0n);
                            const downlink = deltas.reduce(
                                (sum, value) => sum + value.downlink,
                                0n,
                            );
                            const raw = uplink + downlink;
                            const previousRemainder = rows[0].nodeRemainderNano;
                            if (
                                node.nodeConsumptionMultiplier < 0n ||
                                previousRemainder < 0n ||
                                previousRemainder >= NANO
                            )
                                throw new Error('Invalid AnyTLS node accounting policy.');
                            const nodeNumerator =
                                raw * node.nodeConsumptionMultiplier + previousRemainder;
                            if (raw > MAX_DB || nodeNumerator / NANO > MAX_DB)
                                throw new Error('AnyTLS node delta exceeds the database limit.');
                            await tx.$executeRaw`INSERT INTO "nodes_usage_history" ("node_uuid", "upload_bytes", "download_bytes", "total_bytes", "created_at", "updated_at")
                            VALUES (${options.nodeUuid}::uuid, ${uplink}, ${downlink}, ${raw}, date_trunc('hour', NOW()), NOW())
                            ON CONFLICT ("node_uuid", "created_at") DO UPDATE SET
                            "upload_bytes" = "nodes_usage_history"."upload_bytes" + EXCLUDED."upload_bytes",
                            "download_bytes" = "nodes_usage_history"."download_bytes" + EXCLUDED."download_bytes",
                            "total_bytes" = "nodes_usage_history"."total_bytes" + EXCLUDED."total_bytes", "updated_at" = NOW()`;
                            await tx.nodes.update({
                                where: { uuid: options.nodeUuid },
                                data: { trafficUsedBytes: { increment: nodeNumerator / NANO } },
                            });
                            await tx.anyTlsUsageLedger.update({
                                where: {
                                    nodeUuid_epoch: {
                                        nodeUuid: options.nodeUuid,
                                        epoch: parsed.epoch,
                                    },
                                },
                                data: { counters, nodeRemainderNano: nodeNumerator % NANO },
                            });
                        }
                        return { firstConnected, onlineUsers };
                    },
                    { timeout: 30000, maxWait: 10000 },
                );
            } catch (error) {
                if (
                    attempt >= 3 ||
                    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
                    error.code !== 'P2034'
                )
                    throw error;
            }
        }
    }
}
