import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { configSchema } from './config.schema';

const minimumEnv = {
    DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1:5432/fixture',
    APP_SECRET: 'a'.repeat(64),
    FRONT_END_DOMAIN: '*',
    SUB_PUBLIC_DOMAIN: 'localhost/api/sub',
    METRICS_USER: 'fixture',
    METRICS_PASS: 'fixture',
    REDIS_HOST: '127.0.0.1',
    REDIS_PORT: '6379',
};

test('paired-image workflow uses an accepted runtime channel and preserves the actual Git branch separately', () => {
    const workflow = readFileSync('.github/workflows/xboard-image.yml', 'utf8');
    const branch = /^\s+BRANCH=(.+)$/m.exec(workflow)?.[1].trim();
    assert(branch, 'Image runtime channel build argument missing');
    const result = configSchema.safeParse({ ...minimumEnv, REMNAWAVE_BRANCH: branch });
    assert(
        result.success,
        `The emitted image runtime channel ${branch} cannot boot the production config schema`,
    );
    assert.match(workflow, /__RW_METADATA_GIT_BRANCH=\$\{\{ github\.ref_name \}\}/);
});

test('release channel validation remains independent of source branch metadata', () => {
    for (const REMNAWAVE_BRANCH of ['main', 'dev']) {
        assert(
            configSchema.safeParse({
                ...minimumEnv,
                REMNAWAVE_BRANCH,
                __RW_METADATA_GIT_BRANCH: 'wip/shared-443-backend',
            }).success,
        );
    }
    for (const REMNAWAVE_BRANCH of ['wip/shared-443-backend', 'xboard-dev', 'invalid']) {
        assert.equal(configSchema.safeParse({ ...minimumEnv, REMNAWAVE_BRANCH }).success, false);
    }
});
