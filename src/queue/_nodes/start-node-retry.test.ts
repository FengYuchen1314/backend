import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { NodesQueuesService } from './nodes-queues.service';
import { RetryableStartNodeBusyError, StartNodeProcessor } from './processors/start-node.processor';
import { StopNodeProcessor } from './processors/stop-node.processor';

test('stopping a leased-line node after its profile was removed still stops Mieru', async () => {
    const calls: string[] = [];
    const processor = new StopNodeProcessor(
        {
            async stopMieru() {
                calls.push('mieru');
                return { isOk: true, response: { isStopped: true } };
            },
            async stopXray() {
                calls.push('xray');
                return { isOk: true, response: { isStopped: true } };
            },
        } as never,
        {
            async execute() {
                return {
                    isOk: true,
                    response: {
                        uuid: 'node-1',
                        serverType: 'LEASED_LINE',
                        activeInbounds: [],
                        address: 'node.example.com',
                        port: 2222,
                    },
                };
            },
        } as never,
        {
            async execute() {
                calls.push('disabled');
            },
        } as never,
    );
    assert.equal(
        await processor.process({
            data: { nodeUuid: 'node-1', isNeedToBeDeleted: false },
        } as never),
        true,
    );
    assert.deepEqual(calls, ['mieru', 'disabled']);
});

test('failed stops are reported rather than claimed as successful', async () => {
    for (const stopResult of [{ isOk: false }, { isOk: true, response: { isStopped: false } }]) {
        const updates: object[] = [];
        const processor = new StopNodeProcessor(
            {
                async stopMieru() {
                    return stopResult;
                },
            } as never,
            {
                async execute() {
                    return {
                        isOk: true,
                        response: { uuid: 'node-1', serverType: 'LEASED_LINE', activeInbounds: [] },
                    };
                },
            } as never,
            {
                async execute(command: object) {
                    updates.push(command);
                },
            } as never,
        );
        assert.equal(
            await processor.process({
                data: { nodeUuid: 'node-1', isNeedToBeDeleted: false },
            } as never),
            false,
        );
        assert.equal(updates.length, 1);
        assert.doesNotMatch(JSON.stringify(updates), /"isDisabled":true/);
        assert.match(JSON.stringify(updates), /lastStatusMessage/);
    }
});

const buildQueuesService = (startNodeQueue: object) =>
    new NodesQueuesService(
        startNodeQueue as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
    );

test('retryable node starts use unique job ids with fixed backoff', async () => {
    const calls: Array<{
        data: Record<string, unknown>;
        opts: Record<string, unknown>;
    }> = [];
    const queue = {
        async add(_name: string, data: Record<string, unknown>, opts: Record<string, unknown>) {
            calls.push({ data, opts });
            return { id: opts.jobId };
        },
    };
    const service = buildQueuesService(queue);

    await service.startNode({ nodeUuid: 'node-1', force: true, retryIfBusy: true });
    await service.startNode({ nodeUuid: 'node-1', force: true, retryIfBusy: true });
    await service.startNode({ nodeUuid: 'node-1', force: true });

    assert.notEqual(calls[0]?.opts.jobId, calls[1]?.opts.jobId);
    assert.match(String(calls[0]?.opts.jobId), /^startNode-node-1-[0-9a-f-]{36}$/);
    assert.equal(Number(calls[0]?.opts.attempts) >= 3, true);
    assert.deepEqual(calls[0]?.opts.backoff, { type: 'fixed', delay: 2_000 });
    assert.equal(calls[2]?.opts.jobId, 'startNode-node-1');
    assert.equal('attempts' in (calls[2]?.opts ?? {}), false);
});

const buildProcessor = (options: {
    axios?: object;
    commandBus?: object;
    queryBus: object;
    rawCacheService?: object;
}) =>
    new StartNodeProcessor(
        (options.axios ?? {}) as never,
        {} as never,
        options.queryBus as never,
        { emit() {} } as never,
        (options.commandBus ?? {}) as never,
        (options.rawCacheService ?? {}) as never,
    );

test('retryable start rejects while the database reports the node is busy', async () => {
    const processor = buildProcessor({
        queryBus: {
            async execute() {
                return { isOk: true, response: { isConnecting: true } };
            },
        },
    });

    await assert.rejects(
        processor.process({ data: { nodeUuid: 'node-1', retryIfBusy: true } } as never),
        RetryableStartNodeBusyError,
    );
    assert.equal(await processor.process({ data: { nodeUuid: 'node-1' } } as never), undefined);
});

test('retryable start rejects when the node reports a request already in progress', async () => {
    const node = {
        uuid: 'node-1',
        name: 'Node 1',
        address: 'node.example.com',
        port: 2_222,
        proxyUrl: null,
        countryCode: 'US',
        id: 1n,
        tags: [],
        integrationUuids: [],
        activePluginUuid: null,
        activeConfigProfileUuid: 'profile-1',
        activeInbounds: [{ tag: 'SOCKS', type: 'socks' }],
        isConnecting: false,
        isConnected: true,
    };
    let queryCount = 0;
    const updates: unknown[] = [];
    const processor = buildProcessor({
        axios: {
            async getNodeHealth() {
                return { isOk: true, response: { nodeVersion: '3.4.1' } };
            },
            async syncNodePlugins() {
                return { isOk: true };
            },
            async startXray() {
                return {
                    isOk: true,
                    response: {
                        error: 'Request already in progress',
                        isStarted: false,
                    },
                };
            },
        },
        commandBus: {
            async execute(command: unknown) {
                updates.push(command);
                return { isOk: true, response: node };
            },
        },
        queryBus: {
            async execute() {
                queryCount += 1;
                if (queryCount === 1) return { isOk: true, response: node };
                if (queryCount === 2) {
                    return {
                        isOk: true,
                        response: { config: {}, hashesPayload: { emptyConfig: '', inbounds: [] } },
                    };
                }
                return { isOk: true, response: new Map() };
            },
        },
        rawCacheService: {
            async delMany() {},
        },
    });

    await assert.rejects(
        processor.process({
            data: { nodeUuid: node.uuid, force: true, retryIfBusy: true },
        } as never),
        RetryableStartNodeBusyError,
    );
    assert.equal(updates.length, 1);
});
