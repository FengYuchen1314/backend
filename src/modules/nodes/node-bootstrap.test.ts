import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CreateNodeBootstrapCommand, RedeemNodeBootstrapCommand } from '@libs/contracts/commands';
import { ERRORS } from '@libs/contracts/constants';

import { NodeBootstrapService } from './node-bootstrap.service';
import {
    buildNodeBootstrapInstallCommand,
    getNodeBootstrapCacheKey,
    NODE_BOOTSTRAP_IMAGE,
    NODE_BOOTSTRAP_TTL_SECONDS,
    normalizePanelOrigin,
    renderNodeBootstrapInstaller,
} from './node-bootstrap.utils';

const VALID_NODE_SECRET = Buffer.from('node-secret-payload').toString('base64');

test('bootstrap contracts reject invalid ports and malformed tokens', () => {
    assert.equal(
        CreateNodeBootstrapCommand.RequestBodySchema.safeParse({ nodePort: 0 }).success,
        false,
    );
    assert.equal(
        CreateNodeBootstrapCommand.RequestBodySchema.safeParse({ nodePort: 65_535 }).success,
        true,
    );
    assert.equal(
        RedeemNodeBootstrapCommand.RequestBodySchema.safeParse({ token: 'short' }).success,
        false,
    );
});

test('panel origin is normalized and unsafe schemes are rejected', () => {
    assert.equal(
        normalizePanelOrigin('panel.example.com/path', undefined, undefined),
        'https://panel.example.com',
    );
    assert.equal(
        normalizePanelOrigin(undefined, 'https', 'panel.example.com'),
        'https://panel.example.com',
    );
    assert.throws(() => normalizePanelOrigin('file:///tmp/panel', undefined, undefined));
    assert.throws(() => normalizePanelOrigin('http://panel.example.com', undefined, undefined));
    assert.equal(
        normalizePanelOrigin(undefined, 'http', 'localhost:3000'),
        'http://localhost:3000',
    );
    assert.equal(normalizePanelOrigin(undefined, 'http', '[::1]:3000'), 'http://[::1]:3000');
});

test('install command only contacts the panel and keeps the token out of the URL', () => {
    const token = 'A'.repeat(43);
    const command = buildNodeBootstrapInstallCommand(
        'https://panel.example.com',
        token,
        '/api/nodes/bootstrap/redeem',
    );

    assert.match(command, /https:\/\/panel\.example\.com\/api\/nodes\/bootstrap\/redeem/);
    assert.doesNotMatch(command, new RegExp(`redeem/${token}`));
    assert.match(command, /--data-raw '\{"token":"A{43}"\}'/);
    assert.doesNotMatch(command, /github\.com|ghcr\.io|SECRET_KEY/);
});

test('installer writes protected panel-provided env and compose templates', () => {
    const script = renderNodeBootstrapInstaller(2_222, VALID_NODE_SECRET);

    assert.match(script, /^#!\/usr\/bin\/env bash/);
    assert.match(script, new RegExp(`image: ${NODE_BOOTSTRAP_IMAGE.replaceAll('.', '\\.')}`));
    assert.match(script, /NODE_PORT=2222/);
    assert.match(script, new RegExp(`SECRET_KEY=${VALID_NODE_SECRET}`));
    assert.match(script, /env_file:\n      - \.env/);
    assert.match(script, /chmod 600/);
    assert.doesNotMatch(script, /curl|wget|github\.com/);
});

test('bootstrap token is hashed at rest and can be redeemed only once', async () => {
    let storedKey = '';
    let storedValue: unknown;
    let storedTtl = 0;
    let consumed = false;
    let keygenCalls = 0;

    const cache = {
        async set(key: string, value: unknown, ttl: number) {
            storedKey = key;
            storedValue = value;
            storedTtl = ttl;
        },
        async getDel<T>(key: string): Promise<T | null> {
            assert.equal(key, storedKey);
            if (consumed) return null;
            consumed = true;
            return storedValue as T;
        },
    };
    const keygen = {
        async generateKey() {
            keygenCalls += 1;
            return { isOk: true as const, response: { payload: VALID_NODE_SECRET } };
        },
    };

    const service = new NodeBootstrapService(cache as never, keygen as never);
    const created = await service.create(2_222, {
        configuredDomain: 'panel.example.com',
        forwardedHost: undefined,
        forwardedProtocol: undefined,
    });

    assert.equal(created.isOk, true);
    if (!created.isOk) return;

    const tokenMatch = created.response.installCommand.match(/--data-raw '(\{[^']+\})'/);
    assert.ok(tokenMatch);
    const { token } = JSON.parse(tokenMatch[1]) as { token: string };

    assert.equal(token.length, 43);
    assert.equal(storedKey, getNodeBootstrapCacheKey(token));
    assert.equal(storedKey.includes(token), false);
    assert.equal(JSON.stringify(storedValue).includes(token), false);
    assert.equal(storedTtl, NODE_BOOTSTRAP_TTL_SECONDS);

    const first = await service.redeem(token);
    assert.equal(first.isOk, true);
    if (first.isOk) assert.match(first.response, new RegExp(`SECRET_KEY=${VALID_NODE_SECRET}`));

    const second = await service.redeem(token);
    assert.equal(second.isOk, false);
    if (!second.isOk) assert.equal(second.code, ERRORS.UNAUTHORIZED.code);
    assert.equal(keygenCalls, 1);
});
