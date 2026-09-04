import { Module } from '@nestjs/common';

import { TopologyCompiler } from './topology.compiler';
import { TopologyController } from './topology.controller';
import { TopologyRepository } from './topology.repository';
import { TopologyService } from './topology.service';
import { TopologyValidator } from './topology.validator';

@Module({
    controllers: [TopologyController],
    providers: [TopologyRepository, TopologyValidator, TopologyCompiler, TopologyService],
    exports: [TopologyService],
})
export class TopologyModule {}
