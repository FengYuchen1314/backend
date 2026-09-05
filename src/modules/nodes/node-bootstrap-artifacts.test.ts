import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { SERVER_TYPES } from '@libs/contracts/constants';

import {
    ArtifactCatalogSchema,
    ArtifactDownloadSchema,
    artifactCacheKey,
    loadArtifactPlan,
    openArtifact,
} from './node-bootstrap-artifacts';
import { fixtureCatalog } from './node-bootstrap-test-fixtures';
import { renderNodeBootstrapInstaller } from './node-bootstrap.utils';

test('artifact catalog permits only the pinned complete cross-architecture image set', () => {
    const catalog = fixtureCatalog();
    assert(ArtifactCatalogSchema.safeParse(catalog).success);
    for (const patch of [
        { filename: '../secret' },
        { imageTag: '$(id)' },
        { source: 'ghcr.io/fengyuchen1314/node:latest' },
        { size: 0 },
        { arch: 'arm' },
    ]) {
        const changed = structuredClone(catalog);
        Object.assign(changed.artifacts[0], patch);
        assert(!ArtifactCatalogSchema.safeParse(changed).success);
    }
    assert(
        !ArtifactCatalogSchema.safeParse({
            ...catalog,
            artifacts: Array(6).fill(catalog.artifacts[0]),
        }).success,
    );
    assert(
        !ArtifactDownloadSchema.safeParse({ token: 'a'.repeat(43), filename: '../manifest.json' })
            .success,
    );
    assert(!artifactCacheKey('a'.repeat(43)).includes('a'.repeat(43)));
});

test('catalog readiness rejects missing/truncated archives and scopes non-public servers to the Node image', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rw-node-artifact-test-'));
    try {
        const catalog = fixtureCatalog();
        await writeFile(join(directory, 'manifest.json'), JSON.stringify(catalog));
        await assert.rejects(loadArtifactPlan(SERVER_TYPES.PUBLIC_DIRECT, directory));
        for (const artifact of catalog.artifacts)
            await writeFile(join(directory, artifact.filename), 'fixture');
        assert.equal(
            (await loadArtifactPlan(SERVER_TYPES.PUBLIC_DIRECT, directory)).artifacts.length,
            6,
        );
        assert.deepEqual(
            (await loadArtifactPlan(SERVER_TYPES.LEASED_LINE, directory)).artifacts.map(
                (item) => item.role,
            ),
            ['node', 'node'],
        );
        const artifact = ArtifactCatalogSchema.parse(catalog).artifacts[0];
        await writeFile(join(directory, artifact.filename), 'bad');
        await assert.rejects(openArtifact(artifact, directory));
        if (process.platform !== 'win32') {
            await rm(join(directory, artifact.filename));
            await symlink(
                join(directory, 'haproxy-amd64.tar.gz'),
                join(directory, artifact.filename),
            );
            await assert.rejects(openArtifact(artifact, directory));
        }
    } finally {
        await rm(directory, { recursive: true });
    }
});

test('installer downloads every required image only from panel, verifies before load, and forbids registry fallback', () => {
    const plan = {
        catalogHash: 'c'.repeat(64),
        artifacts: ArtifactCatalogSchema.parse(fixtureCatalog()).artifacts,
    };
    const script = renderNodeBootstrapInstaller(2222, 'YWJj', SERVER_TYPES.PUBLIC_DIRECT, {
        panelOrigin: 'https://panel.example.com',
        token: 'a'.repeat(43),
        plan,
    });
    assert.match(script, /https:\/\/panel.example.com\/api\/nodes\/bootstrap\/artifact/);
    assert.doesNotMatch(
        script,
        /compose[^\n]* pull|docker pull|--location|--insecure|ghcr\.io|docker\.io/,
    );
    assert.match(script, /sha256sum -c >\/dev\/null/);
    assert.doesNotMatch(script, /sha256sum --check|sha256sum[^\n]*--status/);
    assert.match(script, /docker image load/);
    assert.match(script, /docker image inspect/);
    assert.match(script, /pull_policy: never/);
    assert.match(script, /up --detach --pull never --no-build/);
    assert(script.indexOf('sha256sum -c') < script.indexOf('docker image load'));
    assert(script.indexOf('docker image inspect') < script.indexOf('REMNAWAVE_NODE_ENV'));
    assert.match(script, /Refusing to overwrite an existing Node installation/);
});
