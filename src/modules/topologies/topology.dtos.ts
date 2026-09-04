import { createZodDto } from 'nestjs-zod';

import {
    CreateTopologyCommand,
    DeleteTopologyCommand,
    GetTopologiesCommand,
    GetTopologyCommand,
    PreviewTopologyCommand,
    UpdateTopologyCommand,
    ValidateTopologyCommand,
} from '@libs/contracts/commands';

export class GetTopologiesResponseDto extends createZodDto(GetTopologiesCommand.ResponseSchema) {}
export class GetTopologyParamDto extends createZodDto(GetTopologyCommand.RequestParamSchema) {}
export class GetTopologyResponseDto extends createZodDto(GetTopologyCommand.ResponseSchema) {}
export class CreateTopologyBodyDto extends createZodDto(CreateTopologyCommand.RequestBodySchema) {}
export class CreateTopologyResponseDto extends createZodDto(CreateTopologyCommand.ResponseSchema) {}
export class UpdateTopologyParamDto extends createZodDto(
    UpdateTopologyCommand.RequestParamSchema,
) {}
export class UpdateTopologyBodyDto extends createZodDto(UpdateTopologyCommand.RequestBodySchema) {}
export class UpdateTopologyResponseDto extends createZodDto(UpdateTopologyCommand.ResponseSchema) {}
export class DeleteTopologyParamDto extends createZodDto(
    DeleteTopologyCommand.RequestParamSchema,
) {}
export class DeleteTopologyQueryDto extends createZodDto(
    DeleteTopologyCommand.RequestQuerySchema,
) {}
export class ValidateTopologyBodyDto extends createZodDto(
    ValidateTopologyCommand.RequestBodySchema,
) {}
export class ValidateTopologyResponseDto extends createZodDto(
    ValidateTopologyCommand.ResponseSchema,
) {}
export class PreviewTopologyBodyDto extends createZodDto(
    PreviewTopologyCommand.RequestBodySchema,
) {}
export class PreviewTopologyResponseDto extends createZodDto(
    PreviewTopologyCommand.ResponseSchema,
) {}
