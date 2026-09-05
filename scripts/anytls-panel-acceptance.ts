// Actions compiles the actual backend test entry for a dependency-only VPS runtime.
// This is panel preparation/PKI acceptance, not a claim of end-to-end AnyTLS proxy traffic.
import '../src/modules/anytls/anytls-identity.test';
import '../src/common/helpers/xray-config/managed-xray-profile.test';
import '../src/common/axios/anytls-capabilities.test';
import '../src/modules/users/queries/get-prepared-config-with-users/get-prepared-config-with-users.test';
import '../src/queue/_nodes/coordinated-start.test';
import '../src/modules/nodes/edge/node-edge-plan.test';
import '../src/modules/nodes/events/socks-user-sync.test';
import '../prisma/seed/seeders/6_sync-inbounds.test';
import '../src/modules/subscription-template/generators/anytls-subscription.test';
import '../src/modules/anytls/anytls-usage.test';
