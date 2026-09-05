import path from 'node:path';

import base from '../rspack.config.mjs';

// Reuse the project's compiler and module resolution. This entry is a test runner,
// not a panel bootstrap; it never opens the database or starts panel services.
export default {
    ...base,
    entry: {
        'anytls-panel.test': './scripts/anytls-panel-acceptance.ts',
        'anytls-material.postgres.test': './src/modules/anytls/anytls-material.postgres.test.ts',
        'anytls-clients.test':
            './src/modules/subscription-template/generators/anytls-clients.linux.test.ts',
        'topology-clients.test':
            './src/modules/subscription-template/generators/topology-clients.linux.test.ts',
    },
    output: {
        path: path.resolve(import.meta.dirname, '../test-dist'),
        clean: true,
        filename: '[name].cjs',
    },
    devtool: false,
    optimization: { ...base.optimization, minimize: false },
};
