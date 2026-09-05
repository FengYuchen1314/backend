import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { StopNodeProcessor } from './processors/stop-node.processor';

type StopResult = { isOk: false } | { isOk: true; response: { isStopped: boolean } };

function fixture(options: {
    serverType: 'BROADBAND_LANDING' | 'LEASED_LINE' | 'PUBLIC_DIRECT';
    protocols: string[];
    mieru?: () => Promise<StopResult>;
    xray?: () => Promise<StopResult>;
}) {
    const calls: string[] = [];
    const updates: object[] = [];
    const processor = new StopNodeProcessor(
        {
            async stopMieru() {
                calls.push('mieru');
                return options.mieru?.() ?? { isOk: true, response: { isStopped: true } };
            },
            async stopXray() {
                calls.push('xray');
                return options.xray?.() ?? { isOk: true, response: { isStopped: true } };
            },
        } as never,
        {
            async execute() {
                return {
                    isOk: true,
                    response: {
                        uuid: 'fixture-node',
                        serverType: options.serverType,
                        activeInbounds: options.protocols.map((type) => ({ type })),
                        address: 'fixture.example.com',
                        port: 2222,
                    },
                };
            },
        } as never,
        {
            async execute(command: object) {
                updates.push(command);
            },
        } as never,
    );
    return {
        calls,
        updates,
        stop: () =>
            processor.process({
                data: { nodeUuid: 'fixture-node', isNeedToBeDeleted: false },
            } as never),
    };
}

test('stopping a leased-line imported native profile follows its actual runtime', async () => {
    for (const protocols of [['vless'], ['socks'], ['trojan', 'shadowsocks']]) {
        const run = fixture({ serverType: 'LEASED_LINE', protocols });
        assert.equal(await run.stop(), true);
        assert.deepEqual(run.calls, ['xray']);
        assert.match(JSON.stringify(run.updates), /"isDisabled":true/);
    }
});

test('managed Mieru and imported Mieru use Mieru regardless of server category', async () => {
    for (const serverType of ['LEASED_LINE', 'PUBLIC_DIRECT', 'BROADBAND_LANDING'] as const) {
        const run = fixture({ serverType, protocols: ['mieru', 'MIERU'] });
        assert.equal(await run.stop(), true);
        assert.deepEqual(run.calls, ['mieru']);
    }
});

test('native and coordinated AnyTLS profiles stop through the Xray endpoint', async () => {
    for (const protocols of [['socks'], ['anytls'], ['vless', 'anytls']]) {
        const run = fixture({ serverType: 'PUBLIC_DIRECT', protocols });
        assert.equal(await run.stop(), true);
        assert.deepEqual(run.calls, ['xray']);
    }
});

test('empty selections retain the existing managed server-type fallback', async () => {
    for (const serverType of ['LEASED_LINE', 'PUBLIC_DIRECT', 'BROADBAND_LANDING'] as const) {
        const run = fixture({ serverType, protocols: [] });
        assert.equal(await run.stop(), true);
        assert.deepEqual(run.calls, [serverType === 'LEASED_LINE' ? 'mieru' : 'xray']);
    }
});

test('mixed selections attempt both runtimes before claiming the server is stopped', async () => {
    for (const serverType of ['LEASED_LINE', 'PUBLIC_DIRECT'] as const) {
        const run = fixture({ serverType, protocols: ['mieru', 'vless'] });
        assert.equal(await run.stop(), true);
        assert.deepEqual(run.calls.sort(), ['mieru', 'xray']);
        assert.match(JSON.stringify(run.updates), /"isDisabled":true/);
    }
});

test('mixed selections attempt the other stop even when one fails or throws', async () => {
    const failures: Array<() => Promise<StopResult>> = [
        async () => ({ isOk: false }),
        async () => ({ isOk: true, response: { isStopped: false } }),
        async () => {
            throw new Error('Fixture transport failure');
        },
    ];
    for (const failedRuntime of ['mieru', 'xray'] as const) {
        for (const failure of failures) {
            const run = fixture({
                serverType: 'LEASED_LINE',
                protocols: ['mieru', 'vless'],
                [failedRuntime]: failure,
            });
            assert.equal(await run.stop(), false);
            assert.deepEqual(run.calls.sort(), ['mieru', 'xray']);
            assert.doesNotMatch(JSON.stringify(run.updates), /"isDisabled":true/);
            assert.match(JSON.stringify(run.updates), /lastStatusMessage/);
        }
    }
});
