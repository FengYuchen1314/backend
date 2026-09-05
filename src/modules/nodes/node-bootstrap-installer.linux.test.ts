import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { SERVER_TYPES } from '@libs/contracts/constants';

import { fixtureDownloads } from './node-bootstrap-test-fixtures';
import {
    renderNodeBootstrapInstaller,
    buildNodeBootstrapInstallCommand,
} from './node-bootstrap.utils';

test(
    'real Bash/curl installer enforces panel-only verified downloads before starting services',
    { skip: process.platform !== 'linux' },
    async (t) => {
        for (const scenario of [
            'amd64',
            'arm64',
            'corrupt',
            'missing',
            'redirect',
            'wrong-image',
            'existing',
        ]) {
            await t.test(scenario, async () => {
                const directory = await mkdtemp(join(tmpdir(), 'rw-bootstrap-shell-'));
                const requests: string[] = [];
                const downloads = fixtureDownloads();
                const server = createServer(async (request, response) => {
                    requests.push(request.url!);
                    assert.equal(request.url, '/api/nodes/bootstrap/artifact');
                    const chunks = [];
                    for await (const chunk of request) chunks.push(chunk);
                    const body = JSON.parse(Buffer.concat(chunks).toString());
                    assert.equal(body.token, downloads.token);
                    assert.match(body.filename, /^(node|haproxy|caddy)-(amd64|arm64)\.tar\.gz$/);
                    if (scenario === 'missing') {
                        response.writeHead(404).end();
                        return;
                    }
                    if (scenario === 'redirect') {
                        response.writeHead(302, { Location: '/must-not-follow' }).end();
                        return;
                    }
                    response.end(
                        scenario === 'corrupt' && body.filename.startsWith('caddy')
                            ? 'corrupt'
                            : 'fixture',
                    );
                });
                await new Promise<void>((accept) => server.listen(0, '127.0.0.1', accept));
                const address = server.address() as { port: number };
                const install = join(directory, 'install');
                const log = join(directory, 'docker.log');
                try {
                    await mkdir(join(directory, 'bin'));
                    await mkdir(install);
                    if (scenario === 'existing')
                        await writeFile(join(install, '.env'), 'preserve-me');
                    const arch = scenario === 'arm64' ? 'arm64' : 'amd64';
                    await writeFile(
                        join(directory, 'bin/docker'),
                        `#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" >>'${log}'
case "$*" in
  'compose version') exit 0 ;;
  'container inspect '*) exit 1 ;;
  'info --format '*) echo 'linux/${arch}'; exit 0 ;;
  'image load --input '*) exit 0 ;;
  'image inspect --format '*) echo 'sha256:${(scenario === 'wrong-image' ? 'b' : 'a').repeat(64)} linux/${arch}'; exit 0 ;;
  'compose --file compose.yml up --detach --pull never --no-build') exit 0 ;;
  *) echo 'Unexpected Docker command' >&2; exit 99 ;;
esac
`,
                        { mode: 0o755 },
                    );
                    const script = renderNodeBootstrapInstaller(
                        2222,
                        'YWJj',
                        SERVER_TYPES.PUBLIC_DIRECT,
                        {
                            ...downloads,
                            panelOrigin: `http://127.0.0.1:${address.port}`,
                        },
                    );
                    const scriptPath = join(directory, 'install.sh');
                    await writeFile(scriptPath, script);
                    const environment = [
                        `PATH=${join(directory, 'bin')}:${process.env.PATH}`,
                        `REMNAWAVE_NODE_INSTALL_DIR=${install}`,
                    ];
                    const child =
                        process.getuid!() === 0
                            ? spawn('env', [...environment, 'bash', scriptPath])
                            : spawn('sudo', ['-n', 'env', ...environment, 'bash', scriptPath]);
                    let output = '';
                    child.stdout.on('data', (chunk) => {
                        output += chunk;
                    });
                    child.stderr.on('data', (chunk) => {
                        output += chunk;
                    });
                    const code = await new Promise((accept, reject) => {
                        child.once('error', reject);
                        child.once('exit', accept);
                    });
                    if (process.getuid!() !== 0) {
                        const ownership = spawn('sudo', [
                            '-n',
                            'chown',
                            '-R',
                            `${process.getuid!()}:${process.getgid!()}`,
                            directory,
                        ]);
                        assert.equal(
                            await new Promise((accept) => ownership.once('exit', accept)),
                            0,
                        );
                    }
                    const actions = await readFile(log, 'utf8');
                    const success = ['amd64', 'arm64'].includes(scenario);
                    assert.equal(code === 0, success, `Unexpected installer outcome: ${output}`);
                    assert.equal(actions.includes(' up --detach'), success);
                    assert.doesNotMatch(actions, /(?:^| )pull(?:$|\n)|remove| rm /);
                    if (success) {
                        assert.equal(requests.length, 3);
                        assert.equal((actions.match(/image load/g) ?? []).length, 3);
                        assert.match(
                            await readFile(join(install, '.env'), 'utf8'),
                            /SECRET_KEY=YWJj/,
                        );
                    } else {
                        if (scenario !== 'wrong-image') assert.doesNotMatch(actions, /image load/);
                        if (scenario === 'existing')
                            assert.equal(
                                await readFile(join(install, '.env'), 'utf8'),
                                'preserve-me',
                            );
                        else await assert.rejects(readFile(join(install, '.env')));
                    }
                } finally {
                    await new Promise<void>((accept) => server.close(() => accept()));
                    // sudo-created private fixture files need owner-only cleanup in CI.
                    if (process.getuid!() !== 0) {
                        const cleanup = spawn('sudo', [
                            '-n',
                            'chown',
                            '-R',
                            `${process.getuid!()}:${process.getgid!()}`,
                            directory,
                        ]);
                        await new Promise((accept) => cleanup.once('exit', accept));
                    }
                    await rm(directory, { recursive: true });
                }
            });
        }
    },
);

test(
    'the generated entry command never executes a truncated installer response',
    { skip: process.platform !== 'linux' },
    async () => {
        const directory = await mkdtemp(join(tmpdir(), 'rw-bootstrap-entry-'));
        const marker = join(directory, 'must-not-exist');
        const server = createServer((_request, response) => {
            response.writeHead(200, { 'Content-Length': 100000 });
            response.write(`touch '${marker}'\n`);
            setTimeout(() => response.destroy(), 20);
        });
        await new Promise<void>((accept) => server.listen(0, '127.0.0.1', accept));
        try {
            const command = buildNodeBootstrapInstallCommand(
                `http://127.0.0.1:${(server.address() as { port: number }).port}`,
                'a'.repeat(43),
                '/api/nodes/bootstrap/redeem',
            );
            const child = spawn('bash', ['-c', command], { stdio: 'ignore' });
            const code = await new Promise((accept, reject) => {
                child.once('error', reject);
                child.once('exit', accept);
            });
            assert.notEqual(code, 0);
            await assert.rejects(readFile(marker));
        } finally {
            await new Promise<void>((accept) => server.close(() => accept()));
            await rm(directory, { recursive: true });
        }
    },
);
