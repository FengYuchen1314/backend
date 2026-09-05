import { createHash } from 'node:crypto';

import { ArtifactCatalogSchema } from './node-bootstrap-artifacts';
import images from './node-bootstrap-images.json';

export const fixtureCatalog = () => ({
    version: 1 as const,
    artifacts: Object.entries(images).flatMap(([role, source]) =>
        ['amd64', 'arm64'].map((arch) => ({
            role,
            arch,
            source,
            filename: `${role}-${arch}.tar.gz`,
            sha256: createHash('sha256').update('fixture').digest('hex'),
            size: 7,
            imageId: `sha256:${'a'.repeat(64)}`,
            imageTag: `localhost/xboard-${role}:${source.split('@sha256:')[1]}-${arch}`,
        })),
    ),
});
export const fixtureDownloads = () => ({
    panelOrigin: 'https://panel.example.com',
    token: 'a'.repeat(43),
    plan: {
        catalogHash: 'c'.repeat(64),
        artifacts: ArtifactCatalogSchema.parse(fixtureCatalog()).artifacts,
    },
});
