import { Query } from '@nestjs/cqrs';

import { TResult } from '@common/types';
import { TNodeEdgeSettings } from '@libs/contracts/models';

export class GetNodeEdgeSettingsQuery extends Query<TResult<TNodeEdgeSettings>> {
    constructor(public readonly nodeId: bigint) {
        super();
    }
}
