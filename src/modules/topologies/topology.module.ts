import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { TopologySubscriptionService } from './topology-subscription.service';
import { TopologyCompiler } from './topology.compiler';
import { TopologyController } from './topology.controller';
import { TopologyRepository } from './topology.repository';
import { TopologyService } from './topology.service';
import { TopologyValidator } from './topology.validator';

@Module({
    imports: [CqrsModule],
    controllers: [TopologyController],
    providers: [
        TopologyRepository,
        TopologyValidator,
        TopologyCompiler,
        TopologyService,
        TopologySubscriptionService,
    ],
    exports: [TopologyService, TopologySubscriptionService],
})
export class TopologyModule {}
