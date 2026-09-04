import { randomBytes } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import { RawCacheService } from '@common/raw-cache';
import { fail, ok, TResult } from '@common/types';
import { CreateNodeBootstrapCommand, RedeemNodeBootstrapCommand } from '@libs/contracts/commands';
import { ERRORS, TServerType } from '@libs/contracts/constants';

import { KeygenService } from '@modules/keygen/keygen.service';

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
            await this.rawCacheService.set(
                getNodeBootstrapCacheKey(token),
                { nodePort, serverType } satisfies NodeBootstrapCachePayload,
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
            return ok(
                renderNodeBootstrapInstaller(
                    payload.nodePort,
                    keygen.response.payload,
                    payload.serverType,
                ),
            );
        } catch (error) {
            this.logger.error(`Failed to render node bootstrap installer: ${String(error)}`);
            return fail(ERRORS.INTERNAL_SERVER_ERROR);
        }
    }
}
