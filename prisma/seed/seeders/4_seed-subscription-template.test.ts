import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SUBSCRIPTION_TEMPLATE_TYPE_VALUES } from '@libs/contracts/constants';

import { INTERNAL_TOPOLOGY_TEMPLATE_TYPE } from '@modules/topologies/topology.constants';

import { seedSubscriptionTemplate } from './4_seed-subscription-template';

test('startup template seeding preserves internal topology storage without exposing it as a format', async () => {
    const retainedTypes = new Set<string>([
        ...SUBSCRIPTION_TEMPLATE_TYPE_VALUES,
        INTERNAL_TOPOLOGY_TEMPLATE_TYPE,
    ]);
    const createdTypes: string[] = [];
    const defaults = new Set<string>();
    let cleanupCalls = 0;
    const prisma = {
        subscriptionTemplate: {
            deleteMany: async (args: { where: { templateType: { notIn: string[] } } }) => {
                cleanupCalls++;
                for (const type of retainedTypes) {
                    assert(
                        args.where.templateType.notIn.includes(type),
                        `Startup would delete ${type}`,
                    );
                }
                return { count: 0 };
            },
            findUnique: async (args: { where: { templateType_name: { templateType: string } } }) =>
                defaults.has(args.where.templateType_name.templateType) ? {} : null,
            create: async (args: { data: { templateType: string } }) => {
                assert.notEqual(args.data.templateType, INTERNAL_TOPOLOGY_TEMPLATE_TYPE);
                createdTypes.push(args.data.templateType);
                defaults.add(args.data.templateType);
            },
        },
    } as unknown as PrismaClient;

    await seedSubscriptionTemplate(prisma);
    await seedSubscriptionTemplate(prisma);
    assert.equal(cleanupCalls, 2);
    assert.equal(createdTypes.length, 5);
    assert.equal(new Set(createdTypes).size, 5, 'Repeated startup must not duplicate defaults');
    assert(
        !SUBSCRIPTION_TEMPLATE_TYPE_VALUES.some(
            (value: string) => value === INTERNAL_TOPOLOGY_TEMPLATE_TYPE,
        ),
    );
});
