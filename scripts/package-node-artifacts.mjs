// Run only in GitHub Actions. Export immutable images, never compile on the target VPS.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';

assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Image packaging belongs in GitHub Actions');
const directory = resolve('.xboard-node-artifacts');
await mkdir(directory); // Do not merge with an old/partial catalog.
const images = JSON.parse(await readFile('src/modules/nodes/node-bootstrap-images.json', 'utf8'));
assert.deepEqual(Object.keys(images).sort(), ['caddy', 'haproxy', 'node']);
const artifacts = [];
for (const [role, source] of Object.entries(images)) {
    assert.match(
        source,
        /^(ghcr\.io\/fengyuchen1314\/node|docker\.io\/library\/(haproxy|caddy))@sha256:[a-f0-9]{64}$/,
    );
    for (const arch of ['amd64', 'arm64']) {
        const imageTag = `localhost/xboard-${role}:${source.split('@sha256:')[1]}-${arch}`;
        execFileSync('docker', ['pull', '--platform', `linux/${arch}`, source], {
            stdio: 'inherit',
        });
        execFileSync('docker', ['tag', source, imageTag], { stdio: 'inherit' });
        const inspect = () =>
            JSON.parse(
                execFileSync('docker', ['image', 'inspect', imageTag], { encoding: 'utf8' }),
            )[0];
        const config = inspect();
        assert.equal(config.Architecture, arch);
        assert.equal(config.Os, 'linux');
        assert.match(config.Id, /^sha256:[a-f0-9]{64}$/);
        const filename = `${role}-${arch}.tar.gz`;
        const path = join(directory, filename);
        const child = spawn('docker', ['image', 'save', '--platform', `linux/${arch}`, imageTag], {
            stdio: ['ignore', 'pipe', 'inherit'],
        });
        const exited = new Promise((accept, reject) => {
            child.once('error', reject);
            child.once('exit', (code) =>
                code === 0 ? accept() : reject(new Error(`docker save exit ${code}`)),
            );
        });
        await Promise.all([
            exited,
            pipeline(
                child.stdout,
                createGzip({ level: 6 }),
                createWriteStream(path, { flags: 'wx' }),
            ),
        ]);
        execFileSync('docker', ['image', 'load', '--input', path], { stdio: 'inherit' });
        assert.equal(inspect().Id, config.Id);
        const hash = createHash('sha256');
        for await (const chunk of createReadStream(path)) hash.update(chunk);
        artifacts.push({
            role,
            arch,
            source,
            filename,
            imageTag,
            imageId: config.Id,
            size: (await stat(path)).size,
            sha256: hash.digest('hex'),
        });
    }
}
await writeFile(
    join(directory, 'manifest.json'),
    JSON.stringify({ version: 1, artifacts }, null, 2),
    { flag: 'wx' },
);
process.stdout.write(
    `Verified ${artifacts.length} archives, ${(artifacts.reduce((size, item) => size + item.size, 0) / 1024 ** 2).toFixed(1)} MiB`,
);
