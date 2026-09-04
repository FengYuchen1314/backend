import { GetUpdateStatusCommand, TriggerUpdateCommand } from '@contract/commands';
import { createZodDto } from 'nestjs-zod';

export class GetUpdateStatusResponseDto extends createZodDto(
    GetUpdateStatusCommand.ResponseSchema,
) {}

export class TriggerUpdateResponseDto extends createZodDto(TriggerUpdateCommand.ResponseSchema) {}
