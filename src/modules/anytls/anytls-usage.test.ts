import 'reflect-metadata';
import { AxiosError } from 'axios';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

import { AxiosService } from '@common/axios';
import { AnyTlsUsageResponseSchema, TAnyTlsUsageSnapshot } from '@libs/contracts/models';

import { RecordUserUsageQueueProcessor } from '@queue/_nodes/processors/record-user-usage.processor';

import { calculateAnyTlsUsage } from './anytls-usage.repository';
import { AnyTlsUsageService } from './anytls-usage.service';

const epoch = randomUUID();
const snapshot = (up = '1', down = '0'): TAnyTlsUsageSnapshot => ({
    available: true,
    version: 1,
    epoch,
    users: [{ username: '42', uplink: up, downlink: down }],
});
const options = { consumptionMultiplier: '500000000', ignoreBelowBytes: 0n };
const payload = {
    nodeUuid: randomUUID(),
    nodeId: '1',
    consumptionMultiplier: '1000000000',
    connectionOpts: { address: 'fixture.example.com', port: 2222, proxyUrl: null },
};

test('AnyTLS cumulative accounting keeps exact integers, fractional remainders and pending small bytes', () => {
    const first = calculateAnyTlsUsage(snapshot(), {}, options);
    assert.equal(first.deltas[0].charged, 0n);
    assert.equal(first.counters['42'].remainderNano, '500000000');
    const second = calculateAnyTlsUsage(snapshot('2'), first.counters, options);
    assert.equal(second.deltas[0].charged, 1n);
    assert.equal(second.counters['42'].remainderNano, '0');
    const large = calculateAnyTlsUsage(snapshot('9007199254740993'), {}, options);
    assert.equal(large.deltas[0].charged, 4503599627370496n);
    assert.equal(large.deltas[0].raw, 9007199254740993n);
    const small = calculateAnyTlsUsage(snapshot('9'), {}, { ...options, ignoreBelowBytes: 10n });
    assert.deepEqual(small.counters, {});
    assert.equal(calculateAnyTlsUsage(snapshot('10'), small.counters, options).deltas[0].raw, 10n);
    assert.equal(
        calculateAnyTlsUsage(snapshot('10'), {}, { ...options, consumptionMultiplier: '0' })
            .deltas[0].charged,
        0n,
    );
});

test('duplicate/older snapshots do not rewind cursors; corrupt, duplicate-user or overflowing data fails closed', () => {
    const first = calculateAnyTlsUsage(snapshot('10', '20'), {}, options);
    const saved = structuredClone(first.counters);
    for (const input of [snapshot('10', '20'), snapshot('1', '2')]) {
        const result = calculateAnyTlsUsage(input, first.counters, options);
        assert.deepEqual(result.counters, saved);
        assert.deepEqual(result.deltas, []);
    }
    assert.throws(
        () => calculateAnyTlsUsage(snapshot('9', '21'), first.counters, options),
        /Incomparable/,
    );
    assert.deepEqual(first.counters, saved);
    const repeated = snapshot();
    repeated.users.push(repeated.users[0]);
    assert.equal(AnyTlsUsageResponseSchema.safeParse(repeated).success, false);
    for (const value of ['-1', '1.2', '1e20', '00', '9'.repeat(41)])
        assert.equal(AnyTlsUsageResponseSchema.safeParse(snapshot(value)).success, false);
    assert.throws(
        () => calculateAnyTlsUsage(snapshot('9223372036854775808'), {}, options),
        /database limit/,
    );
    assert.throws(
        () => calculateAnyTlsUsage(snapshot(), {}, { ...options, consumptionMultiplier: '-1' }),
        /policy/,
    );
    const unknown = snapshot();
    unknown.users[0].username = 'standalone-user';
    assert.deepEqual(calculateAnyTlsUsage(unknown, {}, options).deltas, []);
});

test('cumulative usage transport uses a non-reset GET and only authenticated 404 means legacy absence', async () => {
    const service = new AxiosService({} as never);
    Object.assign(service, { ensureJwt: async () => {}, resolveAgent: () => undefined });
    const probe = async (value: unknown) => {
        service.axiosInstance.get = (async (url: string) => {
            assert.ok(url.endsWith('/node/anytls/usage'));
            if (value instanceof Error) throw value;
            return { data: { response: value } };
        }) as never;
        return service.getAnyTlsUsage(payload.connectionOpts);
    };
    assert.equal((await probe(snapshot())).isOk, true);
    const httpError = (status: number) =>
        new AxiosError('fixture', 'ERR_BAD_RESPONSE', undefined, undefined, { status } as never);
    const legacy = await probe(httpError(404));
    assert.ok(legacy.isOk);
    assert.deepEqual(legacy.response, { available: false });
    for (const invalid of [
        httpError(401),
        httpError(403),
        httpError(500),
        new Error('timeout'),
        { available: true },
        { ...snapshot(), version: 2 },
    ])
        assert.equal((await probe(invalid)).isOk, false);
});

test('AnyTLS poll commits before notifications and never enters the native reset-based queue', async () => {
    const order: string[] = [];
    const service = new AnyTlsUsageService(
        { getAnyTlsUsage: async () => ({ isOk: true, response: snapshot() }) } as never,
        {
            record: async () => {
                order.push('commit');
                return { firstConnected: [{ id: 42n }], onlineUsers: ['42'] };
            },
        } as never,
        {
            getOrThrow: (key: string) => (key === 'USER_USAGE_IGNORE_BELOW_BYTES' ? 0n : false),
        } as never,
        {
            fireUserEventBulk: async () => {
                order.push('notify');
                throw new Error('Redis unavailable after commit');
            },
        } as never,
    );
    assert.deepEqual(await service.poll(payload), ['42']);
    assert.deepEqual(order, ['commit', 'notify']);
});

test('user-usage job preserves native collection on AnyTLS failure and deduplicates online IDs', async () => {
    for (const mode of ['healthy', 'anytls-failed', 'native-failed'] as const) {
        let nativeCalls = 0;
        const online: number[] = [];
        const queued: unknown[] = [];
        const processor = new RecordUserUsageQueueProcessor(
            {} as never,
            {
                getUsersStats: async (body: unknown) => {
                    nativeCalls++;
                    assert.deepEqual(body, { reset: true });
                    return mode === 'native-failed'
                        ? { isOk: false }
                        : {
                              isOk: true,
                              response: {
                                  users: [
                                      { username: '42', uplink: 1, downlink: 2 },
                                      { username: '43', uplink: 3, downlink: 4 },
                                  ],
                              },
                          };
                },
            } as never,
            { getOrThrow: () => 0n } as never,
            { updateUserUsage: async (value: unknown) => queued.push(value) } as never,
            { recordUserUsageDelayed: async () => {} } as never,
            {
                set: async (_key: string, value: number) => online.push(value),
                createPipeline: () => ({
                    hincrby: () => {},
                    expire: () => {},
                    exec: async () => [],
                }),
            } as never,
            {
                poll: async () => {
                    if (mode === 'anytls-failed') throw new Error('DB down');
                    return ['42', '44'];
                },
            } as never,
        );
        await processor.process({ data: payload } as never);
        assert.equal(nativeCalls, 1);
        assert.equal(online.at(-1), mode === 'healthy' ? 3 : 2);
        assert.equal(queued.length, mode === 'native-failed' ? 0 : 1);
        if (queued.length) assert.equal((queued[0] as unknown[]).length, 2);
    }
});
