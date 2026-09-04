import { CreateNodeBootstrapCommand, RedeemNodeBootstrapCommand } from '@contract/commands';
import { createZodDto } from 'nestjs-zod';

export class CreateNodeBootstrapBodyDto extends createZodDto(
    CreateNodeBootstrapCommand.RequestBodySchema,
) {}

export class CreateNodeBootstrapResponseDto extends createZodDto(
    CreateNodeBootstrapCommand.ResponseSchema,
) {}

export class RedeemNodeBootstrapBodyDto extends createZodDto(
    RedeemNodeBootstrapCommand.RequestBodySchema,
) {}
