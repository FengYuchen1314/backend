import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { AxiosModule } from '@common/axios';

import { KeygenModule } from '@modules/keygen/keygen.module';

import { CamouflageDomainCacheService } from './camouflage-domain/camouflage-domain-cache.service';
import { CamouflageDomainService } from './camouflage-domain/camouflage-domain.service';
import { COMMANDS } from './commands';
import { EVENTS } from './events';
import { NodeBootstrapController } from './node-bootstrap.controller';
import { NodeBootstrapService } from './node-bootstrap.service';
import { NodesSystemCacheService } from './nodes-system-cache.service';
import { NodesController } from './nodes.controller';
import { NodesConverter } from './nodes.converter';
import { NodesService } from './nodes.service';
import { QUERIES } from './queries';
import { NodesRepository } from './repositories/nodes.repository';

@Module({
    imports: [CqrsModule, KeygenModule, AxiosModule],
    controllers: [NodesController, NodeBootstrapController],
    providers: [
        NodesRepository,
        NodesConverter,
        NodesService,
        NodesSystemCacheService,
        NodeBootstrapService,
        CamouflageDomainCacheService,
        CamouflageDomainService,
        ...EVENTS,
        ...QUERIES,
        ...COMMANDS,
    ],
    exports: [NodesRepository],
})
export class NodesModule {}
