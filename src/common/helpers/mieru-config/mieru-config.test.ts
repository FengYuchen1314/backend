import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MieruProfileConfigSchema } from '@libs/contracts/models';

import { isMieruProfileConfig, MieruConfig } from './mieru-config';

test('Mieru profile validation applies safe v1 defaults and exposes managed inbounds', () => {
    const config = new MieruConfig({
        runtime: 'MIERU',
        listeners: [{ tag: 'MIERU_TCP_24443', port: 24_443, protocol: 'TCP' }],
    });

    assert.equal(isMieruProfileConfig(config.getConfig()), true);
    assert.deepEqual(config.getConfig(), {
        runtime: 'MIERU',
        listeners: [{ tag: 'MIERU_TCP_24443', port: 24_443, protocol: 'TCP' }],
        mtu: 1_400,
        multiplexing: 'MULTIPLEXING_LOW',
        handshakeMode: 'HANDSHAKE_STANDARD',
        userHintIsMandatory: true,
        metricsLoggingInterval: '1m',
        loggingLevel: 'INFO',
    });

    assert.deepEqual(config.getAllInbounds(), [
        {
            tag: 'MIERU_TCP_24443',
            type: 'mieru',
            network: 'tcp',
            security: null,
            port: 24_443,
            rawInbound: {
                protocol: 'mieru',
                tag: 'MIERU_TCP_24443',
                settings: {
                    port: 24_443,
                    transport: 'TCP',
                    mtu: 1_400,
                    multiplexing: 'MULTIPLEXING_LOW',
                    handshakeMode: 'HANDSHAKE_STANDARD',
                    userHintIsMandatory: true,
                    metricsLoggingInterval: '1m',
                    loggingLevel: 'INFO',
                },
            },
        },
    ]);
});

test('Mieru profiles reject unsafe ports and duplicate tags or bindings', () => {
    assert.equal(
        MieruProfileConfigSchema.safeParse({
            runtime: 'MIERU',
            listeners: [{ tag: 'LOW_PORT', port: 443, protocol: 'TCP' }],
        }).success,
        false,
    );

    assert.equal(
        MieruProfileConfigSchema.safeParse({
            runtime: 'MIERU',
            listeners: [
                { tag: 'DUPLICATE', port: 24_443, protocol: 'TCP' },
                { tag: 'DUPLICATE', port: 24_444, protocol: 'TCP' },
            ],
        }).success,
        false,
    );

    assert.equal(
        MieruProfileConfigSchema.safeParse({
            runtime: 'MIERU',
            listeners: [
                { tag: 'ONE', port: 24_443, protocol: 'TCP' },
                { tag: 'TWO', port: 24_443, protocol: 'TCP' },
            ],
        }).success,
        false,
    );
});
