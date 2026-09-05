import { randomBytes } from 'node:crypto';

import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';

import { RawCacheService } from '@common/raw-cache';
import { fail, ok, TResult } from '@common/types';
import { CreateNodeBootstrapCommand, RedeemNodeBootstrapCommand } from '@libs/contracts/commands';
import { ERRORS, TServerType } from '@libs/contracts/constants';

import { KeygenService } from '@modules/keygen/keygen.service';

import {
    ARTIFACT_TTL_SECONDS,
    ArtifactDownloadSchema,
    artifactCacheKey,
    NodeBootstrapArtifactsService,
} from './node-bootstrap-artifacts';
import {
    buildNodeBootstrapInstallCommand,
    getNodeBootstrapCacheKey,
    NODE_BOOTSTRAP_TTL_SECONDS,
    normalizePanelOrigin,
    renderNodeBootstrapInstaller,
} from './node-bootstrap.utils';

interface NodeBootstrapCachePayload {
    nodePort: number;
    serverType: TServerType;
    panelOrigin: string;
    catalogHash: string;
}

export interface NodeBootstrapPanelLocation {
    configuredDomain: string | undefined;
    forwardedHost: string | string[] | undefined;
    forwardedProtocol: string | string[] | undefined;
}

type NodeBootstrapResponse = CreateNodeBootstrapCommand.Response['response'];

@Injectable()
export class NodeBootstrapService {
    private readonly logger = new Logger(NodeBootstrapService.name);

    constructor(
        private readonly rawCacheService: RawCacheService,
        private readonly keygenService: KeygenService,
        private readonly artifactsService: NodeBootstrapArtifactsService,
    ) {}

    public async create(
        nodePort: number,
        serverType: TServerType,
        panelLocation: NodeBootstrapPanelLocation,
    ): Promise<TResult<NodeBootstrapResponse>> {
        try {
            const panelOrigin = normalizePanelOrigin(
                panelLocation.configuredDomain,
                panelLocation.forwardedProtocol,
                panelLocation.forwardedHost,
            );
            const token = randomBytes(32).toString('base64url');
            const plan = await this.artifactsService.plan(serverType);
            await this.rawCacheService.set(
                getNodeBootstrapCacheKey(token),
                {
                    nodePort,
                    serverType,
                    panelOrigin,
                    catalogHash: plan.catalogHash,
                } satisfies NodeBootstrapCachePayload,
                NODE_BOOTSTRAP_TTL_SECONDS,
            );

            return ok({
                installCommand: buildNodeBootstrapInstallCommand(
                    panelOrigin,
                    token,
                    RedeemNodeBootstrapCommand.url,
                ),
                expiresAt: new Date(Date.now() + NODE_BOOTSTRAP_TTL_SECONDS * 1_000).toISOString(),
                expiresInSeconds: NODE_BOOTSTRAP_TTL_SECONDS,
            });
        } catch (error) {
            this.logger.error(`Failed to create node bootstrap command: ${String(error)}`);
            return fail(ERRORS.INTERNAL_SERVER_ERROR);
        }
    }

    public async redeem(token: string): Promise<TResult<string>> {
        let payload: NodeBootstrapCachePayload | null;
        try {
            payload = await this.rawCacheService.getDel<NodeBootstrapCachePayload>(
                getNodeBootstrapCacheKey(token),
            );
        } catch (error) {
            this.logger.error(`Failed to consume node bootstrap token: ${String(error)}`);
            return fail(ERRORS.INTERNAL_SERVER_ERROR);
        }

        if (!payload) {
            return fail(ERRORS.UNAUTHORIZED);
        }

        const keygen = await this.keygenService.generateKey();
        if (!keygen.isOk) {
            return fail(ERRORS.INTERNAL_SERVER_ERROR);
        }

        try {
            const plan = await this.artifactsService.plan(payload.serverType);
            if (plan.catalogHash !== payload.catalogHash) return fail(ERRORS.UNAUTHORIZED);
            const artifactToken = randomBytes(32).toString('base64url');
            await this.rawCacheService.set(
                artifactCacheKey(artifactToken),
                {
                    catalogHash: plan.catalogHash,
                    serverType: payload.serverType,
                },
                ARTIFACT_TTL_SECONDS,
            );
            return ok(
                renderNodeBootstrapInstaller(
                    payload.nodePort,
                    keygen.response.payload,
                    payload.serverType,
                    { panelOrigin: payload.panelOrigin, token: artifactToken, plan },
                ),
            );
        } catch (error) {
            this.logger.error(`Failed to render node bootstrap installer: ${String(error)}`);
            return fail(ERRORS.INTERNAL_SERVER_ERROR);
        }
    }

    public async downloadArtifact(token: string, filename: string) {
        if (!ArtifactDownloadSchema.safeParse({ token, filename }).success)
            throw new UnauthorizedException();
        const grant = await this.rawCacheService.get<
            Pick<NodeBootstrapCachePayload, 'catalogHash' | 'serverType'>
        >(artifactCacheKey(token));
        if (!grant) throw new UnauthorizedException();
        const plan = await this.artifactsService.plan(grant.serverType);
        const artifact = plan.artifacts.find((item) => item.filename === filename);
        if (!artifact || plan.catalogHash !== grant.catalogHash) throw new UnauthorizedException();
        const attempts = await this.rawCacheService.incrementWithTtl(
            `${artifactCacheKey(token)}:${filename}`,
            ARTIFACT_TTL_SECONDS,
        );
        if (attempts > 8) throw new UnauthorizedException('Artifact retry allowance exhausted');
        const file = await this.artifactsService.open(artifact);
        return { stream: file.createReadStream(), artifact };
    }
}
