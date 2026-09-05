import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolvePlatformSource } from './node-artifact-platforms.mjs';

test('packaging pulls distinct child digests from the pinned multi-architecture index', () => {
    const source = `ghcr.io/fengyuchen1314/node@sha256:${'a'.repeat(64)}`;
    const amd = {
        platform: { os: 'linux', architecture: 'amd64' },
        digest: `sha256:${'b'.repeat(64)}`,
    };
    const arm = {
        platform: { os: 'linux', architecture: 'arm64', variant: 'v8' },
        digest: `sha256:${'c'.repeat(64)}`,
    };
    const index = {
        manifests: [amd, arm, { platform: { os: 'unknown', architecture: 'unknown' } }],
    };
    assert.equal(
        resolvePlatformSource(source, index, 'amd64'),
        source.replace('a'.repeat(64), 'b'.repeat(64)),
    );
    assert.equal(
        resolvePlatformSource(source, index, 'arm64'),
        source.replace('a'.repeat(64), 'c'.repeat(64)),
    );
    for (const invalid of [
        { manifests: [amd] },
        { manifests: [arm, arm] },
        { manifests: [{ ...arm, digest: 'latest' }] },
    ]) {
        assert.throws(() => resolvePlatformSource(source, invalid, 'arm64'));
    }
    assert.throws(() => resolvePlatformSource('node:latest', index, 'arm64'));
});
