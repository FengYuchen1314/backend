import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

import { Injectable } from '@nestjs/common';

import { SERVER_TYPES, TServerType } from '@libs/contracts/constants';

import images from './node-bootstrap-images.json';

export const ARTIFACT_DIRECTORY = '/opt/app/node-artifacts';
export const ARTIFACT_TTL_SECONDS = 3600;
export const ARTIFACT_ROUTE = '/api/nodes/bootstrap/artifact';
export const ArtifactDownloadSchema = z.object({
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    filename: z.string().regex(/^(node|haproxy|caddy)-(amd64|arm64)\.tar\.gz$/),
});
export const ArtifactSchema = z
    .strictObject({
        role: z.enum(['node', 'haproxy', 'caddy']),
        arch: z.enum(['amd64', 'arm64']),
        filename: z.string(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        size: z
            .number()
            .int()
            .positive()
            .max(2 * 1024 ** 3),
        imageId: z.string().regex(/^sha256:[a-f0-9]{64}$/),
        imageTag: z.string(),
        source: z.string(),
    })
    .superRefine((item, context) => {
        const source = images[item.role];
        const digest = source.split('@sha256:')[1];
        if (
            item.filename !== `${item.role}-${item.arch}.tar.gz` ||
            item.source !== source ||
            item.imageTag !== `localhost/xboard-${item.role}:${digest}-${item.arch}`
        )
            context.addIssue({
                code: 'custom',
                message: 'Artifact does not match the pinned image catalog',
            });
    });
export const ArtifactCatalogSchema = z
    .strictObject({
        version: z.literal(1),
        artifacts: z.array(ArtifactSchema).length(6),
    })
    .superRefine(({ artifacts }, context) => {
        if (new Set(artifacts.map((item) => item.filename)).size !== 6) {
            context.addIssue({
                code: 'custom',
                message: 'Every role and architecture must occur once',
            });
        }
    });
export type BootstrapArtifact = z.infer<typeof ArtifactSchema>;
export interface BootstrapArtifactPlan {
    catalogHash: string;
    artifacts: BootstrapArtifact[];
}

export function artifactCacheKey(token: string): string {
    return `node_bootstrap_artifacts:${createHash('sha256').update(token).digest('hex')}`;
}

export async function loadArtifactPlan(
    serverType: TServerType,
    directory = ARTIFACT_DIRECTORY,
): Promise<BootstrapArtifactPlan> {
    const handle = await open(
        join(directory, 'manifest.json'),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    let source: string;
    try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > 64 * 1024) throw new Error('Invalid artifact manifest');
        source = await handle.readFile('utf8');
    } finally {
        await handle.close();
    }
    const catalog = ArtifactCatalogSchema.parse(JSON.parse(source));
    const artifacts = catalog.artifacts.filter(
        (item) => serverType === SERVER_TYPES.PUBLIC_DIRECT || item.role === 'node',
    );
    // Detect incomplete images before handing the operator a one-time command.
    for (const artifact of artifacts) {
        const file = await openArtifact(artifact, directory);
        await file.close();
    }
    return { catalogHash: createHash('sha256').update(source).digest('hex'), artifacts };
}

export async function openArtifact(artifact: BootstrapArtifact, directory = ARTIFACT_DIRECTORY) {
    const safe = ArtifactSchema.parse(artifact);
    const file = await open(
        join(directory, safe.filename),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size !== safe.size)
            throw new Error('Incomplete bootstrap artifact');
        return file;
    } catch (error) {
        await file.close();
        throw error;
    }
}

@Injectable()
export class NodeBootstrapArtifactsService {
    plan(serverType: TServerType) {
        return loadArtifactPlan(serverType);
    }
    open(artifact: BootstrapArtifact) {
        return openArtifact(artifact);
    }
}
