/**
 * P2-0 · Parametric first-hop stage tests.
 *
 * Verifies:
 * 1. Default OFF — no broker attached, cascade behaves identically.
 * 2. OFF with broker attached but opts.parametricFirstHop not set → cascade.
 * 3. ON + broker hit → parametric results returned, cascade skipped.
 * 4. ON + broker miss (no hits) → falls through to cascade.
 * 5. ON + no active session → falls through to cascade.
 * 6. ON + broker throws → falls through to cascade (no exception thrown).
 * 7. ON + broker returns only null-value entries → miss → cascade.
 * 8. setParametricBroker attaches/detaches correctly.
 * 9. Results carry no mode/channel fields (opacity).
 * 10. Existing cascade tests still pass with broker attached but first-hop off.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { SearchEngine } from '../src/core/search.mjs';

function stubEngine(recallImpl) {
  const engine = Object.create(SearchEngine.prototype);
  engine.indexer = null;
  engine.store = null;
  engine.embedder = null;
  engine.cloud = null;
  engine.recall = recallImpl;
  engine._parametricBroker = null;
  engine.buildFtsQuery = (sem, kw) => (sem || kw || '').trim() || '';
  return engine;
}

function stubEngineWithGraph(recallImpl, graphImpl) {
  const engine = stubEngine(recallImpl);
  engine._searchGraphNodesFts = graphImpl;
  return engine;
}

function mockBroker(opts = {}) {
  const sessionId = Object.prototype.hasOwnProperty.call(opts, 'sessionId')
    ? opts.sessionId
    : 'sess-active';
  const recallResult = opts.recallResult ?? [{ value: 'blue', score: 0.95 }];
  const shouldThrow = opts.shouldThrow ?? false;
  return {
    getActiveSessionId: () => sessionId,
    recall: async (_sid, _q, _topK) => {
      if (shouldThrow) throw new Error('broker down');
      return recallResult;
    },
  };
}

// ------------------------------------------------------------------
// Default OFF (no broker)
// ------------------------------------------------------------------

test('P2-0 · no broker attached → cascade runs normally', async () => {
  let recallCalled = false;
  const engine = stubEngine(async () => {
    recallCalled = true;
    return [{ id: 'mem_1', title: 'M', summary: 's', type: 'memory' }];
  });
  const out = await engine.unifiedCascadeSearch('query', { parametricFirstHop: true });
  assert.ok(recallCalled, 'cascade recall should run when no broker is attached');
  assert.equal(out.results.length, 1);
  assert.equal(out.results[0].id, 'mem_1');
});

// ------------------------------------------------------------------
// Broker attached but first-hop not requested
// ------------------------------------------------------------------

test('P2-0 · broker attached but parametricFirstHop not set → cascade runs', async () => {
  let recallCalled = false;
  const engine = stubEngine(async () => {
    recallCalled = true;
    return [{ id: 'mem_1', title: 'M', summary: 's', type: 'memory' }];
  });
  engine._parametricBroker = mockBroker();
  const out = await engine.unifiedCascadeSearch('query');
  assert.ok(recallCalled, 'cascade should run when first-hop is not requested');
  assert.equal(out.results[0].id, 'mem_1');
});

// ------------------------------------------------------------------
// ON + hit → parametric results returned
// ------------------------------------------------------------------

test('P2-0 · first-hop hit → parametric results returned, cascade skipped', async () => {
  let recallCalled = false;
  const engine = stubEngine(async () => {
    recallCalled = true;
    return [{ id: 'mem_1', title: 'M', summary: 's', type: 'memory' }];
  });
  engine._parametricBroker = mockBroker({
    recallResult: [{ value: 'blue', score: 0.95 }, { value: 'red', score: 0.8 }],
  });
  const out = await engine.unifiedCascadeSearch('favorite color', {
    parametricFirstHop: true,
    limit: 5,
  });
  assert.ok(!recallCalled, 'cascade recall should NOT run on first-hop hit');
  assert.equal(out.results.length, 2);
  assert.equal(out.results[0].title, 'blue');
  assert.equal(out.results[0].type, 'parametric_binding');
  assert.equal(out.results[0].score, 0.95);
  assert.equal(out.results[1].title, 'red');
});

// ------------------------------------------------------------------
// ON + miss → falls through to cascade
// ------------------------------------------------------------------

test('P2-0 · first-hop miss (empty hits) → falls through to cascade', async () => {
  let recallCalled = false;
  const engine = stubEngine(async () => {
    recallCalled = true;
    return [{ id: 'mem_1', title: 'M', summary: 's', type: 'memory' }];
  });
  engine._parametricBroker = mockBroker({ recallResult: [] });
  const out = await engine.unifiedCascadeSearch('query', { parametricFirstHop: true });
  assert.ok(recallCalled, 'cascade should run on first-hop miss');
  assert.equal(out.results[0].id, 'mem_1');
});

test('P2-0 · first-hop miss (only null values) → falls through to cascade', async () => {
  let recallCalled = false;
  const engine = stubEngine(async () => {
    recallCalled = true;
    return [{ id: 'mem_1', title: 'M', summary: 's', type: 'memory' }];
  });
  engine._parametricBroker = mockBroker({
    recallResult: [{ value: null, score: 0.0 }, { value: null, score: 0.0 }],
  });
  const out = await engine.unifiedCascadeSearch('query', { parametricFirstHop: true });
  assert.ok(recallCalled, 'cascade should run when all parametric values are null');
  assert.equal(out.results[0].id, 'mem_1');
});

// ------------------------------------------------------------------
// ON + no active session → cascade
// ------------------------------------------------------------------

test('P2-0 · no active session → falls through to cascade', async () => {
  let recallCalled = false;
  const engine = stubEngine(async () => {
    recallCalled = true;
    return [{ id: 'mem_1', title: 'M', summary: 's', type: 'memory' }];
  });
  engine._parametricBroker = mockBroker({ sessionId: null });
  const out = await engine.unifiedCascadeSearch('query', { parametricFirstHop: true });
  assert.ok(recallCalled, 'cascade should run when no active session');
  assert.equal(out.results[0].id, 'mem_1');
});

// ------------------------------------------------------------------
// ON + broker throws → cascade (no exception propagated)
// ------------------------------------------------------------------

test('P2-0 · broker throws → falls through to cascade silently', async () => {
  let recallCalled = false;
  const engine = stubEngine(async () => {
    recallCalled = true;
    return [{ id: 'mem_1', title: 'M', summary: 's', type: 'memory' }];
  });
  engine._parametricBroker = mockBroker({ shouldThrow: true });
  const out = await engine.unifiedCascadeSearch('query', { parametricFirstHop: true });
  assert.ok(recallCalled, 'cascade should run when broker throws');
  assert.equal(out.results[0].id, 'mem_1');
});

// ------------------------------------------------------------------
// Opacity — no mode/channel fields in parametric results
// ------------------------------------------------------------------

test('P2-0 · parametric results carry no mode/channel fields', async () => {
  const engine = stubEngine(async () => []);
  engine._parametricBroker = mockBroker({
    recallResult: [{ value: 'blue', score: 0.95 }],
  });
  const out = await engine.unifiedCascadeSearch('q', { parametricFirstHop: true });
  for (const r of out.results) {
    assert.equal(r.source, undefined, 'source must not leak');
    assert.equal(r.source_channel, undefined, 'source_channel must not leak');
    assert.equal(r.cascade_layer, undefined, 'cascade_layer must not leak');
    assert.equal(r.recall_mode, undefined, 'recall_mode must not leak');
  }
});

// ------------------------------------------------------------------
// setParametricBroker
// ------------------------------------------------------------------

test('P2-0 · setParametricBroker attaches and detaches', async () => {
  const engine = stubEngine(async () => [{ id: 'm', title: 't', summary: 's', type: 'memory' }]);
  assert.equal(engine._parametricBroker, null);

  const broker = mockBroker();
  engine.setParametricBroker(broker);
  assert.equal(engine._parametricBroker, broker);

  engine.setParametricBroker(null);
  assert.equal(engine._parametricBroker, null);

  // setParametricBroker(undefined) also detaches
  engine.setParametricBroker(broker);
  engine.setParametricBroker(undefined);
  assert.equal(engine._parametricBroker, null);
});

// ------------------------------------------------------------------
// Constructor option
// ------------------------------------------------------------------

test('P2-0 · constructor options.parametricBroker is respected', async () => {
  const broker = mockBroker();
  const engine = new SearchEngine(null, null, null, null, { parametricBroker: broker });
  assert.equal(engine._parametricBroker, broker);
});

// ------------------------------------------------------------------
// Bit-identical cascade behaviour when first-hop is off
// ------------------------------------------------------------------

test('P2-0 · broker attached + first-hop off → identical to no broker', async () => {
  const recallImpl = async () => [
    { id: 'mem_1', title: 'M', summary: 's', type: 'memory', score: 0.9 },
  ];
  const graphImpl = () => [
    { id: 'graph_1', title: 'G', summary: 's', type: 'workspace_file', score: 0.7 },
  ];

  const engineNoBroker = stubEngineWithGraph(recallImpl, graphImpl);
  const engineWithBroker = stubEngineWithGraph(recallImpl, graphImpl);
  engineWithBroker._parametricBroker = mockBroker();

  const out1 = await engineNoBroker.unifiedCascadeSearch('query');
  const out2 = await engineWithBroker.unifiedCascadeSearch('query');

  assert.deepEqual(out1, out2, 'results must be identical with and without broker when first-hop is off');
});

// ------------------------------------------------------------------
// Empty query still returns empty even with broker + first-hop on
// ------------------------------------------------------------------

test('P2-0 · empty query + first-hop on → empty results (no broker call)', async () => {
  const engine = stubEngine(async () => { throw new Error('should not be called'); });
  engine._parametricBroker = {
    getActiveSessionId: () => { throw new Error('broker should not be called'); },
    recall: async () => { throw new Error('broker should not be called'); },
  };
  const out = await engine.unifiedCascadeSearch('', { parametricFirstHop: true });
  assert.deepEqual(out, { results: [] });
});

// ------------------------------------------------------------------
// F-074 · process-level env arming (AWARENESS_PARAMETRIC_FIRST_HOP)
// ------------------------------------------------------------------

test('F-074 · env=1 arms the first hop without opts (broker hit short-circuits)', async () => {
  process.env.AWARENESS_PARAMETRIC_FIRST_HOP = '1';
  try {
    let recallCalled = false;
    const engine = stubEngine(async () => {
      recallCalled = true;
      return [{ id: 'mem_1', title: 'M', summary: 's', type: 'memory' }];
    });
    engine._parametricBroker = mockBroker({
      recallResult: [{ value: 'blue', score: 0.95 }],
    });
    const out = await engine.unifiedCascadeSearch('favorite color');
    assert.ok(!recallCalled, 'cascade must be skipped when env arms a hit');
    assert.equal(out.results[0].title, 'blue');
  } finally {
    delete process.env.AWARENESS_PARAMETRIC_FIRST_HOP;
  }
});

test('F-074 · env unset → default off (cascade runs even with broker)', async () => {
  delete process.env.AWARENESS_PARAMETRIC_FIRST_HOP;
  let recallCalled = false;
  const engine = stubEngine(async () => {
    recallCalled = true;
    return [{ id: 'mem_1', title: 'M', summary: 's', type: 'memory' }];
  });
  engine._parametricBroker = mockBroker();
  await engine.unifiedCascadeSearch('query');
  assert.ok(recallCalled, 'env unset must leave the default-off behaviour');
});

test('F-074 · env values other than exactly "1" stay off', async () => {
  for (const val of ['0', 'true', 'yes', '1 ', 'on']) {
    process.env.AWARENESS_PARAMETRIC_FIRST_HOP = val;
    try {
      let recallCalled = false;
      const engine = stubEngine(async () => {
        recallCalled = true;
        return [{ id: 'mem_1', title: 'M', summary: 's', type: 'memory' }];
      });
      engine._parametricBroker = mockBroker();
      await engine.unifiedCascadeSearch('query');
      assert.ok(recallCalled, `env=${JSON.stringify(val)} must stay off`);
    } finally {
      delete process.env.AWARENESS_PARAMETRIC_FIRST_HOP;
    }
  }
});

test('F-074 · env=1 without broker → cascade (arming alone changes nothing)', async () => {
  process.env.AWARENESS_PARAMETRIC_FIRST_HOP = '1';
  try {
    let recallCalled = false;
    const engine = stubEngine(async () => {
      recallCalled = true;
      return [{ id: 'mem_1', title: 'M', summary: 's', type: 'memory' }];
    });
    engine._parametricBroker = null;
    const out = await engine.unifiedCascadeSearch('query');
    assert.ok(recallCalled, 'arming without a broker must be a no-op');
    assert.equal(out.results[0].id, 'mem_1');
  } finally {
    delete process.env.AWARENESS_PARAMETRIC_FIRST_HOP;
  }
});

test('F-074 · opts=true still wins regardless of env', async () => {
  delete process.env.AWARENESS_PARAMETRIC_FIRST_HOP;
  let recallCalled = false;
  const engine = stubEngine(async () => {
    recallCalled = true;
    return [{ id: 'mem_1', title: 'M', summary: 's', type: 'memory' }];
  });
  engine._parametricBroker = mockBroker({
    recallResult: [{ value: 'blue', score: 0.95 }],
  });
  const out = await engine.unifiedCascadeSearch('q', { parametricFirstHop: true });
  assert.ok(!recallCalled, 'per-call opt-in must work independent of env');
  assert.equal(out.results[0].title, 'blue');
});
