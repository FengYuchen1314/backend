import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { anyTlsConfigFixture, anyTlsInbound } from '@modules/anytls/anytls.test-fixtures';
import { ConfigProfileInboundEntity } from '@modules/config-profiles/entities';

import { NODES_JOB_NAMES } from './constants';
import { StartAllNodesByProfileQueueProcessor } from './processors/start-all-nodes-by-profile.processor';
import { StartNodeProcessor } from './processors/start-node.processor';

function fixture(
    options: {
        anyTls?: boolean;
        legacy?: boolean;
        capabilityFailure?: boolean;
        plugin?: boolean;
        failPreparation?: boolean;
        residential?: boolean;
    } = {},
) {
    const calls: string[] = [];
    const updates: Record<string, unknown>[] = [];
    const requests: Record<string, unknown>[] = [];
    const node = {
        uuid: 'node-1',
        id: 1n,
        name: 'Node 1',
        address: '192.0.2.20',
        port: 2222,
        proxyUrl: null,
        countryCode: 'US',
        tags: [],
        integrationUuids: [],
        serverType: options.residential ? 'RESIDENTIAL_EXIT' : 'PUBLIC_DIRECT',
        activePluginUuid: options.plugin ? 'plugin-1' : null,
        activeConfigProfileUuid: 'profile-1',
        activeInbounds: options.anyTls
            ? [anyTlsInbound()]
            : [
                  new ConfigProfileInboundEntity({
                      uuid: '33333333-3333-4333-8333-333333333333',
                      tag: 'VLESS',
                      type: 'vless',
                  }),
              ],
        isConnected: true,
        isConnecting: false,
    };
    const processor = new StartNodeProcessor(
        {
            async getNodeHealth() {
                return { isOk: true, response: { nodeVersion: '3.4.1' } };
            },
            async getAnyTlsCapabilities() {
                calls.push('capabilities');
                return options.capabilityFailure
                    ? { isOk: false }
                    : {
                          isOk: true,
                          response: {
                              available: !options.legacy,
                              coordinatedStartVersion: options.legacy ? null : 1,
                          },
                      };
            },
            async syncNodePlugins() {
                calls.push('plugin-sync');
                return { isOk: true };
            },
            async getNodeEdgeStatus() {
                return { isOk: true, response: { available: true, haproxy: true, caddy: true } };
            },
            async startXray(data: Record<string, unknown>) {
                calls.push('start');
                requests.push(data);
                return {
                    isOk: true,
                    response: {
                        isStarted: true,
                        error: null,
                        system: { info: {}, stats: {} },
                        nodeInformation: { version: '3.4.1' },
                        version: '26.9.1',
                    },
                };
            },
        } as never,
        {} as never,
        {
            async execute(query: object) {
                switch (query.constructor.name) {
                    case 'GetNodeByUuidQuery':
                        return { isOk: true, response: node };
                    case 'GetPreparedConfigWithUsersQuery':
                        if (options.failPreparation) throw new Error('PRIVATE PREPARATION DETAIL');
                        return {
                            isOk: true,
                            response: {
                                config: {
                                    inbounds: options.anyTls
                                        ? []
                                        : [
                                              {
                                                  tag: 'VLESS',
                                                  protocol: 'vless',
                                                  port: 443,
                                                  streamSettings: {
                                                      network: 'raw',
                                                      security: 'reality',
                                                      realitySettings: {
                                                          serverNames: ['vision.example.com'],
                                                      },
                                                  },
                                              },
                                          ],
                                },
                                hashesPayload: { emptyConfig: 'hash', inbounds: [] },
                                ...(options.anyTls ? { anyTlsConfig: anyTlsConfigFixture() } : {}),
                            },
                        };
                    case 'GetNodeEdgeSettingsQuery':
                        return { isOk: true, response: {} };
                    case 'GetResolvedIntegrationsQuery':
                        return { isOk: true, response: new Map() };
                    default:
                        assert.fail(`Unexpected query ${query.constructor.name}`);
                }
            },
        } as never,
        { emit() {} } as never,
        {
            async execute(command: { node: Record<string, unknown> }) {
                updates.push(command.node);
                return { isOk: true, response: node };
            },
        } as never,
        { async delMany() {}, async setMany() {} } as never,
    );
    return {
        calls,
        updates,
        requests,
        run: () => processor.process({ data: { nodeUuid: 'node-1', retryIfBusy: true } } as never),
    };
}

test('coordinated Agents receive both explicit runtime configs and no legacy plugin mutation', async () => {
    for (const anyTls of [true, false]) {
        const item = fixture({ anyTls });
        await item.run();
        assert.deepEqual(item.calls, ['capabilities', 'start']);
        assert.deepEqual(
            item.requests[0]?.anyTlsConfig,
            anyTls ? anyTlsConfigFixture() : { version: 1, listeners: [] },
        );
        const plan = item.requests[0]?.edgePlan as {
            routes: { targetPort: number; sendProxyV2: boolean }[];
        };
        assert.equal(plan.routes[0].sendProxyV2, !anyTls);
        if (anyTls) assert.equal(plan.routes[0].targetPort, 14443);
        assert.equal(item.updates.at(-1)?.isConnected, true);
        assert.equal(item.updates.at(-1)?.isConnecting, false);
    }
});

test('legacy Agents retain VLESS startup, but AnyTLS never silently downgrades or uses plugins', async () => {
    const legacy = fixture({ legacy: true });
    await legacy.run();
    assert.deepEqual(legacy.calls, ['capabilities', 'plugin-sync', 'start']);
    assert.equal(Object.hasOwn(legacy.requests[0], 'anyTlsConfig'), false);
    for (const options of [
        { legacy: true, anyTls: true },
        { capabilityFailure: true },
        { plugin: true },
        { residential: true, anyTls: true },
        { failPreparation: true },
    ]) {
        const item = fixture(options);
        await item.run();
        assert.equal(item.requests.length, 0);
        assert.equal(item.updates.at(-1)?.isConnecting, false);
        assert.equal(item.updates.at(-1)?.isConnected, false);
        assert.doesNotMatch(JSON.stringify(item.updates), /PRIVATE PREPARATION DETAIL/);
    }
});

test('bulk public-direct profile starts use the individual coordinated path without premature busy flags', async () => {
    const calls: string[] = [];
    const starts: object[] = [];
    const queue = {
        async pause() {
            calls.push('pause');
        },
        async resume() {
            calls.push('resume');
        },
    };
    const processor = new StartAllNodesByProfileQueueProcessor(
        {} as never,
        {
            queues: { startNode: queue, startAllNodes: queue },
            async startNode(payload: object) {
                starts.push(payload);
            },
        } as never,
        {
            async execute() {
                return {
                    isOk: true,
                    response: [
                        {
                            uuid: 'public-1',
                            serverType: 'PUBLIC_DIRECT',
                            activeInbounds: [anyTlsInbound()],
                        },
                        { uuid: 'public-2', serverType: 'PUBLIC_DIRECT', activeInbounds: [] },
                    ],
                };
            },
        } as never,
        {
            execute() {
                assert.fail('Bulk path must not claim the per-node connecting lock');
            },
        } as never,
        {} as never,
    );
    await processor.process({
        name: NODES_JOB_NAMES.START_ALL_BY_PROFILE,
        data: { profileUuid: 'profile', emitter: 'test', force: true },
    } as never);
    assert.deepEqual(starts, [
        { nodeUuid: 'public-1', force: true, retryIfBusy: true },
        { nodeUuid: 'public-2', force: true, retryIfBusy: true },
    ]);
    assert.deepEqual(calls, ['pause', 'pause', 'resume', 'resume']);
});
