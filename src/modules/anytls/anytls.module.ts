import { Module } from '@nestjs/common';

import { AnyTlsMaterialRepository } from './anytls-material.repository';
import { AnyTlsMaterialService } from './anytls-material.service';

@Module({
    providers: [AnyTlsMaterialRepository, AnyTlsMaterialService],
    exports: [AnyTlsMaterialService],
})
export class AnyTlsModule {}
