import { CreateNodeBootstrapCommand, RedeemNodeBootstrapCommand } from '@contract/commands';
import { createZodDto } from 'nestjs-zod';

import { ArtifactDownloadSchema } from '../node-bootstrap-artifacts';

export class DownloadNodeArtifactBodyDto extends createZodDto(ArtifactDownloadSchema) {}

export class CreateNodeBootstrapBodyDto extends createZodDto(
    CreateNodeBootstrapCommand.RequestBodySchema,
) {}

export class CreateNodeBootstrapResponseDto extends createZodDto(
    CreateNodeBootstrapCommand.ResponseSchema,
) {}

export class RedeemNodeBootstrapBodyDto extends createZodDto(
    RedeemNodeBootstrapCommand.RequestBodySchema,
) {}
