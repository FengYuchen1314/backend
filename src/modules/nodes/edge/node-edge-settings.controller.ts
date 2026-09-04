import { CONTROLLERS_INFO, NODES_CONTROLLER } from '@contract/api';
import { GetNodeEdgeSettingsCommand, UpdateNodeEdgeSettingsCommand } from '@contract/commands';
import { ROLE } from '@contract/constants';
import { createZodDto } from 'nestjs-zod';

import { Body, Controller, HttpStatus, Param, UseFilters, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { Endpoint } from '@common/decorators/base-endpoint';
import { Roles } from '@common/decorators/roles/roles';
import { ApiScopeResource } from '@common/decorators/scopes';
import { HttpExceptionFilter } from '@common/exception/http-exception.filter';
import { JwtDefaultGuard } from '@common/guards/jwt-guards/def-jwt-guard';
import { RolesGuard } from '@common/guards/roles/roles.guard';
import { ScopesGuard } from '@common/guards/scopes';
import { errorHandler } from '@common/helpers/error-handler.helper';

import { NodeEdgeSettingsService } from './node-edge-settings.service';

class ParamsDto extends createZodDto(GetNodeEdgeSettingsCommand.RequestParamSchema) {}
class BodyDto extends createZodDto(UpdateNodeEdgeSettingsCommand.RequestBodySchema) {}
class GetResponseDto extends createZodDto(GetNodeEdgeSettingsCommand.ResponseSchema) {}
class SaveResponseDto extends createZodDto(UpdateNodeEdgeSettingsCommand.ResponseSchema) {}

@ApiBearerAuth('Authorization')
@ApiScopeResource(CONTROLLERS_INFO.NODES.resource)
@ApiTags(CONTROLLERS_INFO.NODES.tag)
@Roles(ROLE.ADMIN)
@UseGuards(JwtDefaultGuard, RolesGuard, ScopesGuard)
@UseFilters(HttpExceptionFilter)
@Controller(NODES_CONTROLLER)
export class NodeEdgeSettingsController {
    constructor(private readonly service: NodeEdgeSettingsService) {}

    @Endpoint({
        type: GetResponseDto,
        command: GetNodeEdgeSettingsCommand,
        httpCode: HttpStatus.OK,
    })
    async get(@Param() params: ParamsDto): Promise<GetResponseDto> {
        return { response: errorHandler(await this.service.get(params.uuid)) };
    }

    @Endpoint({
        type: SaveResponseDto,
        command: UpdateNodeEdgeSettingsCommand,
        httpCode: HttpStatus.OK,
    })
    async save(@Param() params: ParamsDto, @Body() body: BodyDto): Promise<SaveResponseDto> {
        return { response: errorHandler(await this.service.save(params.uuid, body)) };
    }
}
