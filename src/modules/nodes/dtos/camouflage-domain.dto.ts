import {
    GetCamouflageDomainCatalogCommand,
    SelectCamouflageDomainCommand,
    ValidateCamouflageDomainCommand,
} from '@contract/commands';
import { createZodDto } from 'nestjs-zod';

export class GetCamouflageDomainCatalogQueryDto extends createZodDto(
    GetCamouflageDomainCatalogCommand.RequestQuerySchema,
) {}
export class GetCamouflageDomainCatalogResponseDto extends createZodDto(
    GetCamouflageDomainCatalogCommand.ResponseSchema,
) {}

export class ValidateCamouflageDomainParamDto extends createZodDto(
    ValidateCamouflageDomainCommand.RequestParamSchema,
) {}
export class ValidateCamouflageDomainBodyDto extends createZodDto(
    ValidateCamouflageDomainCommand.RequestBodySchema,
) {}
export class ValidateCamouflageDomainResponseDto extends createZodDto(
    ValidateCamouflageDomainCommand.ResponseSchema,
) {}

export class SelectCamouflageDomainParamDto extends createZodDto(
    SelectCamouflageDomainCommand.RequestParamSchema,
) {}
export class SelectCamouflageDomainBodyDto extends createZodDto(
    SelectCamouflageDomainCommand.RequestBodySchema,
) {}
export class SelectCamouflageDomainResponseDto extends createZodDto(
    SelectCamouflageDomainCommand.ResponseSchema,
) {}
