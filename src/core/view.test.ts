import { test } from 'node:test';
import assert from 'node:assert/strict';
import { view, json, isViewResult, isJsonResult, toGasOutput } from './view.ts';
import type { OutputAdapter } from './output-adapter.ts';

function fakeOutput(): OutputAdapter & { calls: Array<{ method: string; args: unknown[] }> } {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  return {
    calls,
    renderView(name: string, data: Record<string, unknown>) {
      calls.push({ method: 'renderView', args: [name, data] });
      return 'rendered';
    },
    json(data: unknown) {
      calls.push({ method: 'json', args: [data] });
      return 'jsoned';
    },
  };
}

test('view() builds a tagged view result with status 200', () => {
  const response = view('login', { title: 'Sign in' });
  assert.equal(response.status, 200);
  assert.ok(isViewResult(response.body));
});

test('json() builds a tagged json result', () => {
  const response = json({ ok: true });
  assert.ok(isJsonResult(response.body));
});

test('isViewResult/isJsonResult reject unrelated bodies', () => {
  assert.equal(isViewResult({ ok: true }), false);
  assert.equal(isJsonResult({ ok: true }), false);
  assert.equal(isViewResult(null), false);
});

test('toGasOutput renders a view result through output.renderView with name+data', () => {
  const output = fakeOutput();
  const response = view('login', { title: 'Sign in' });

  toGasOutput(response, output);

  assert.deepEqual(output.calls, [{ method: 'renderView', args: ['login', { title: 'Sign in' }] }]);
});

test('toGasOutput sends a tagged json result through output.json with the right data', () => {
  const output = fakeOutput();
  const response = json({ ok: true });

  toGasOutput(response, output);

  assert.deepEqual(output.calls, [{ method: 'json', args: [{ ok: true }] }]);
});

test('toGasOutput sends a plain-object body through output.json', () => {
  const output = fakeOutput();
  const response = { status: 200, body: { ok: true } };

  toGasOutput(response, output);

  assert.deepEqual(output.calls, [{ method: 'json', args: [{ ok: true }] }]);
});

test('toGasOutput never passes status to the adapter', () => {
  const output = fakeOutput();
  toGasOutput(view('login'), output);
  toGasOutput(json({ ok: true }), output);

  for (const call of output.calls) {
    for (const arg of call.args) {
      if (typeof arg === 'object' && arg !== null) {
        assert.ok(!('status' in arg));
      }
    }
  }
});
