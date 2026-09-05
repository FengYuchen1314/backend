import type { Response } from 'express';

import { pipeline } from 'node:stream/promises';

import { Body, Controller, HttpCode, HttpStatus, Post, Res, UseFilters } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';

import { HttpExceptionFilter } from '@common/exception/http-exception.filter';
import { errorHandler } from '@common/helpers/error-handler.helper';
import { CONTROLLERS_INFO, NODES_CONTROLLER, NODES_ROUTES } from '@libs/contracts/api';

import { RedeemNodeBootstrapBodyDto } from './dtos';
import { DownloadNodeArtifactBodyDto } from './dtos/node-bootstrap.dto';
import { NodeBootstrapService } from './node-bootstrap.service';

@ApiTags(CONTROLLERS_INFO.NODES.tag)
@UseFilters(HttpExceptionFilter)
@Controller(NODES_CONTROLLER)
export class NodeBootstrapController {
    constructor(private readonly nodeBootstrapService: NodeBootstrapService) {}

    @Post(NODES_ROUTES.BOOTSTRAP.ARTIFACT)
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: 'Download a pinned Node image archive using a scoped bootstrap grant',
    })
    @ApiBody({ type: DownloadNodeArtifactBodyDto })
    @ApiProduces('application/gzip')
    async artifact(
        @Body() body: DownloadNodeArtifactBodyDto,
        @Res() response: Response,
    ): Promise<void> {
        const { stream, artifact } = await this.nodeBootstrapService.downloadArtifact(
            body.token,
            body.filename,
        );
        response.setHeader('Cache-Control', 'no-store, max-age=0');
        response.setHeader('Content-Type', 'application/gzip');
        response.setHeader('Content-Length', artifact.size);
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.setHeader('Content-Disposition', `attachment; filename="${artifact.filename}"`);
        // pipeline closes the file on completion, client cancellation and transport failure.
        await pipeline(stream, response);
    }

    @Post(NODES_ROUTES.BOOTSTRAP.REDEEM)
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Redeem a one-time Remnawave Node bootstrap token' })
    @ApiBody({ type: RedeemNodeBootstrapBodyDto })
    @ApiProduces('text/x-shellscript')
    @ApiResponse({
        status: HttpStatus.OK,
        description: 'A no-store Remnawave Node installation script',
        schema: { type: 'string' },
    })
    async redeem(
        @Body() body: RedeemNodeBootstrapBodyDto,
        @Res({ passthrough: true }) response: Response,
    ): Promise<string> {
        response.setHeader('Cache-Control', 'no-store, max-age=0');
        response.setHeader('Pragma', 'no-cache');

        const result = await this.nodeBootstrapService.redeem(body.token);
        const script = errorHandler(result);

        response.setHeader('Content-Type', 'text/x-shellscript; charset=utf-8');
        response.setHeader(
            'Content-Disposition',
            'attachment; filename="install-remnawave-node.sh"',
        );

        return script;
    }
}
