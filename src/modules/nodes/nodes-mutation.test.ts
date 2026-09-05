import 'reflect-metadata';
import { TransactionalAdapter, TransactionHost } from '@nestjs-cls/transactional';
import { Prisma } from '@prisma/client';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ERRORS } from '@libs/contracts/constants';

import { NodesEntity } from './entities';
import { NodesService } from './nodes.service';

interface State {
    nodes: Record<string, Partial<NodesEntity>>;
    links: Record<string, string[]>;
}

function fixture(options: { insertFailure?: boolean; queueFailure?: boolean } = {}) {
    let saved: State = {
        nodes: Object.fromEntries(
            ['a', 'b'].map((uuid, index) => [
                uuid,
                {
                    uuid,
                    id: BigInt(index + 1),
                    name: `node-${uuid}`,
                    address: `${uuid}.example.invalid`,
                    isDisabled: false,
                    consumptionMultiplier: 1_000_000_000n,
                    nodeConsumptionMultiplier: 1_000_000_000n,
                    activeConfigProfileUuid: 'old-profile',
                },
            ]),
        ),
        links: { a: ['old-inbound'], b: ['old-inbound'] },
    };
    const calls: string[] = [];
    const initial = structuredClone(saved);
    const host = new TransactionHost<TransactionalAdapter<unknown, State, object>>({
        connectionName: undefined,
        enableTransactionProxy: false,
        defaultTxOptions: {},
        getFallbackInstance: () => saved,
        async wrapWithTransaction(_options, operation, setTx) {
            calls.push('begin');
            const pending = structuredClone(saved);
            setTx(pending);
            try {
                const result = await operation();
                saved = pending;
                calls.push('commit');
                return result;
            } catch (error) {
                calls.push('rollback');
                throw error;
            }
        },
    });
    const entity = (uuid: string) => ({
        ...structuredClone(host.tx.nodes[uuid]),
        activeInbounds: host.tx.links[uuid].map((inboundUuid) => ({ uuid: inboundUuid })),
    });
    const repository = {
        async findByUUID(uuid: string) {
            return entity(uuid);
        },
        async update({ uuid, ...fields }: Partial<NodesEntity>) {
            calls.push('update');
            if (fields.name === 'occupied-name') {
                throw new Prisma.PrismaClientKnownRequestError('Fixture duplicate name', {
                    code: 'P2002',
                    clientVersion: 'fixture',
                    meta: { modelName: 'Nodes', target: ['name'] },
                });
            }
            Object.assign(
                host.tx.nodes[uuid!],
                Object.fromEntries(
                    Object.entries(fields).filter(([, value]) => value !== undefined),
                ),
            );
            return entity(uuid!);
        },
        async updateMany(uuids: string[], fields: Partial<NodesEntity>) {
            calls.push('update-many');
            for (const uuid of uuids) Object.assign(host.tx.nodes[uuid], fields);
            return true;
        },
        async removeInboundsFromNode(uuid: string) {
            calls.push('remove');
            host.tx.links[uuid] = [];
            return true;
        },
        async addInboundsToNode(uuid: string, inbounds: string[]) {
            calls.push('insert');
            if (options.insertFailure) throw new Error('Fixture link insert failed');
            host.tx.links[uuid] = [...inbounds];
            return true;
        },
        async removeInboundsFromNodes(uuids: string[]) {
            for (const uuid of uuids) await this.removeInboundsFromNode(uuid);
            return true;
        },
        async addInboundsToNodes(uuids: string[], inbounds: string[]) {
            for (const uuid of uuids) await this.addInboundsToNode(uuid, inbounds);
            return true;
        },
    };
    const queued = async () => {
        calls.push('queue');
        assert.equal(host.isTransactionActive(), false);
        assert.equal(calls.includes('commit'), true);
        if (options.queueFailure) throw new Error('Fixture queue unavailable');
    };
    let profileFailure = false;
    const service = new NodesService(
        repository as never,
        {
            emit() {
                calls.push('event');
                assert.equal(host.isTransactionActive(), false);
                assert.equal(calls.includes('commit'), true);
            },
        } as never,
        { startNode: queued, startAllNodesByProfile: queued } as never,
        {
            async execute() {
                return profileFailure
                    ? { isOk: false, ...ERRORS.CONFIG_PROFILE_NOT_FOUND }
                    : { isOk: true, response: { inbounds: [{ uuid: 'new-inbound' }] } };
            },
        } as never,
        {} as never,
        {
            async getOne() {
                return { system: null, onlineUsers: 0, versions: null, xrayUptime: 0 };
            },
        } as never,
    );
    // Expected fixture errors should not print stack traces or request data in test output.
    (service as unknown as { logger: { error(): void } }).logger = { error() {} };
    return {
        calls,
        initial,
        service,
        state: () => saved,
        failProfileLookup: () => (profileFailure = true),
    };
}

const configProfile = {
    activeConfigProfileUuid: 'new-profile',
    activeInbounds: ['new-inbound'],
};

test('a duplicate node name cannot partially replace its inbound links', async () => {
    const run = fixture();
    const result = await run.service.updateNode({
        uuid: 'a',
        name: 'occupied-name',
        configProfile,
    } as never);
    assert.equal(result.isOk, false);
    assert.deepEqual(run.state(), run.initial);
    assert.equal(run.calls.includes('queue'), false);
    assert.equal(run.calls.includes('event'), false);
    assert.equal(run.calls.includes('rollback'), true);
});

test('a failed inbound insert rolls back single and bulk profile mutations', async () => {
    for (const bulk of [false, true]) {
        const run = fixture({ insertFailure: true });
        const result = bulk
            ? await run.service.profileModification({ uuids: ['a', 'b'], configProfile } as never)
            : await run.service.updateNode({
                  uuid: 'a',
                  name: 'changed-name',
                  configProfile,
              } as never);
        assert.equal(result.isOk, false);
        assert.deepEqual(run.state(), run.initial);
        assert.equal(run.calls.includes('queue'), false);
        assert.equal(run.calls.includes('event'), false);
        assert.equal(run.calls.includes('rollback'), true);
    }
});

test('successful single-node mutation commits the complete selection before queueing or events', async () => {
    const run = fixture();
    const result = await run.service.updateNode({ uuid: 'a', configProfile } as never);
    assert.equal(result.isOk, true);
    assert.equal(run.state().nodes.a.activeConfigProfileUuid, 'new-profile');
    assert.deepEqual(run.state().links.a, ['new-inbound']);
    assert.deepEqual(run.state().nodes.b, run.initial.nodes.b);
    assert.deepEqual(run.state().links.b, run.initial.links.b);
    assert.deepEqual(run.calls, [
        'begin',
        'update',
        'remove',
        'insert',
        'commit',
        'queue',
        'event',
    ]);
    if (result.isOk) {
        assert.deepEqual(
            result.response.configProfile.activeInbounds.map((inbound) => inbound.uuid),
            ['new-inbound'],
        );
    }
});

test('successful bulk mutations commit all profile pointers and links before queueing', async () => {
    const run = fixture();
    const result = await run.service.profileModification({
        uuids: ['a', 'b'],
        configProfile,
    } as never);
    assert.equal(result.isOk, true);
    for (const uuid of ['a', 'b']) {
        assert.equal(run.state().nodes[uuid].activeConfigProfileUuid, 'new-profile');
        assert.deepEqual(run.state().links[uuid], ['new-inbound']);
    }
    assert.deepEqual(run.calls, [
        'begin',
        'update-many',
        'remove',
        'remove',
        'insert',
        'insert',
        'commit',
        'queue',
    ]);
});

test('field-only updates preserve profile links and disabled nodes are not restarted', async () => {
    const run = fixture();
    run.state().nodes.a.isDisabled = true;
    const result = await run.service.updateNode({ uuid: 'a', name: 'changed-name' } as never);
    assert.equal(result.isOk, true);
    assert.equal(run.state().nodes.a.name, 'changed-name');
    assert.equal(run.state().nodes.a.activeConfigProfileUuid, 'old-profile');
    assert.deepEqual(run.state().links.a, ['old-inbound']);
    assert.deepEqual(run.calls, ['begin', 'update', 'commit', 'event']);
});

test('invalid active selections fail before any single or bulk write', async () => {
    for (const activeInbounds of [[], ['new-inbound', 'new-inbound'], ['other-inbound']]) {
        for (const bulk of [false, true]) {
            const run = fixture();
            const invalidProfile = { ...configProfile, activeInbounds };
            const result = bulk
                ? await run.service.profileModification({
                      uuids: ['a', 'b'],
                      configProfile: invalidProfile,
                  } as never)
                : await run.service.updateNode({
                      uuid: 'a',
                      configProfile: invalidProfile,
                  } as never);
            assert.equal(result.isOk, false);
            assert.deepEqual(run.state(), run.initial);
            assert.deepEqual(run.calls, []);
        }
    }
});

test('profile lookup failures are returned before any node mutation', async () => {
    const run = fixture();
    run.failProfileLookup();
    const result = await run.service.updateNode({ uuid: 'a', configProfile } as never);
    assert.equal(result.isOk, false);
    assert.deepEqual(run.state(), run.initial);
    assert.deepEqual(run.calls, []);
});

test('a post-commit queue failure cannot roll back or split the saved configuration', async () => {
    for (const bulk of [false, true]) {
        const run = fixture({ queueFailure: true });
        const result = bulk
            ? await run.service.profileModification({ uuids: ['a', 'b'], configProfile } as never)
            : await run.service.updateNode({ uuid: 'a', configProfile } as never);
        assert.equal(result.isOk, false);
        assert.equal(run.state().nodes.a.activeConfigProfileUuid, 'new-profile');
        assert.deepEqual(run.state().links.a, ['new-inbound']);
        assert.equal(run.calls.includes('rollback'), false);
        assert.equal(run.calls.includes('commit'), true);
    }
});
