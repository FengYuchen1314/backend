import { CONTROLLERS_INFO, TOPOLOGIES_CONTROLLER } from '@contract/api';
import { ROLE } from '@contract/constants';

import { Body, Controller, HttpStatus, Param, Query, UseFilters, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { Endpoint } from '@common/decorators/base-endpoint';
import { Roles } from '@common/decorators/roles/roles';
import { ApiScopeResource } from '@common/decorators/scopes';
import { HttpExceptionFilter } from '@common/exception/http-exception.filter';
import { JwtDefaultGuard } from '@common/guards/jwt-guards/def-jwt-guard';
import { RolesGuard } from '@common/guards/roles';
import { ScopesGuard } from '@common/guards/scopes';
import { errorHandler } from '@common/helpers/error-handler.helper';
import {
    CreateTopologyCommand,
    DeleteTopologyCommand,
    GetTopologiesCommand,
    GetTopologyCommand,
    PreviewTopologyCommand,
    UpdateTopologyCommand,
    ValidateTopologyCommand,
} from '@libs/contracts/commands';

import {
    CreateTopologyBodyDto,
    CreateTopologyResponseDto,
    DeleteTopologyParamDto,
    DeleteTopologyQueryDto,
    GetTopologiesResponseDto,
    GetTopologyParamDto,
    GetTopologyResponseDto,
    PreviewTopologyBodyDto,
    PreviewTopologyResponseDto,
    UpdateTopologyBodyDto,
    UpdateTopologyParamDto,
    UpdateTopologyResponseDto,
    ValidateTopologyBodyDto,
    ValidateTopologyResponseDto,
} from './topology.dtos';
import { TopologyService } from './topology.service';

@ApiBearerAuth('Authorization')
@ApiScopeResource(CONTROLLERS_INFO.TOPOLOGIES.resource)
@ApiTags(CONTROLLERS_INFO.TOPOLOGIES.tag)
@Roles(ROLE.ADMIN, ROLE.API)
@UseGuards(JwtDefaultGuard, RolesGuard, ScopesGuard)
@UseFilters(HttpExceptionFilter)
@Controller(TOPOLOGIES_CONTROLLER)
export class TopologyController {
    constructor(private readonly service: TopologyService) {}

    @Endpoint({
        command: GetTopologiesCommand,
        httpCode: HttpStatus.OK,
        type: GetTopologiesResponseDto,
    })
    async getAll(): Promise<GetTopologiesResponseDto> {
        return { response: errorHandler(await this.service.getAll()) };
    }

    @Endpoint({
        command: GetTopologyCommand,
        httpCode: HttpStatus.OK,
        type: GetTopologyResponseDto,
    })
    async getByUuid(@Param() param: GetTopologyParamDto): Promise<GetTopologyResponseDto> {
        return { response: errorHandler(await this.service.getByUuid(param.uuid)) };
    }

    @Endpoint({
        command: CreateTopologyCommand,
        httpCode: HttpStatus.CREATED,
        type: CreateTopologyResponseDto,
    })
    async create(@Body() body: CreateTopologyBodyDto): Promise<CreateTopologyResponseDto> {
        return { response: errorHandler(await this.service.create(body.name, body.graph)) };
    }

    @Endpoint({
        command: UpdateTopologyCommand,
        httpCode: HttpStatus.OK,
        type: UpdateTopologyResponseDto,
    })
    async update(
        @Param() param: UpdateTopologyParamDto,
        @Body() body: UpdateTopologyBodyDto,
    ): Promise<UpdateTopologyResponseDto> {
        return {
            response: errorHandler(
                await this.service.update(
                    param.uuid,
                    body.expectedVersion,
                    body.name,
                    body.graph,
                    body.isPublished,
                ),
            ),
        };
    }

    @Endpoint({
        command: DeleteTopologyCommand,
        httpCode: HttpStatus.NO_CONTENT,
    })
    async delete(
        @Param() param: DeleteTopologyParamDto,
        @Query() query: DeleteTopologyQueryDto,
    ): Promise<void> {
        errorHandler(await this.service.delete(param.uuid, query.expectedVersion));
    }

    @Endpoint({
        command: ValidateTopologyCommand,
        httpCode: HttpStatus.OK,
        type: ValidateTopologyResponseDto,
    })
    async validate(@Body() body: ValidateTopologyBodyDto): Promise<ValidateTopologyResponseDto> {
        return { response: errorHandler(await this.service.validateGraph(body.graph)) };
    }

    @Endpoint({
        command: PreviewTopologyCommand,
        httpCode: HttpStatus.OK,
        type: PreviewTopologyResponseDto,
    })
    async preview(@Body() body: PreviewTopologyBodyDto): Promise<PreviewTopologyResponseDto> {
        return {
            response: errorHandler(await this.service.preview(body.graph, body.formats)),
        };
    }
}
