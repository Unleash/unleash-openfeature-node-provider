import { readFileSync } from 'node:fs';
import http from 'node:http';
import {
  type Client,
  type EvaluationDetails,
  type JsonValue,
  OpenFeature,
} from '@openfeature/server-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UnleashProvider } from '../src/index';

/**
 * Read our OpenFeature-Unleash contract specs.
 * The spec is pinned as the `verifier` git submodule and we read it as plain JSON.
 */
const readSpec = (p: string) => JSON.parse(readFileSync(new URL(`../verifier/spec/${p}`, import.meta.url), 'utf8'));
const contract = readSpec('contract.json');
const clientFeatures = readSpec('fixtures/unleash-features.json');

// This provider evaluates locally and takes per-call context — both server capabilities.
const capabilities = ['localEval', 'perCallContext'];
const evaluatesLocally = capabilities.includes('localEval');
const appliesTo = (s: Scenario) => (s.requires ?? []).every((c) => capabilities.includes(c));

// run as EXPECTED failures (delete the entry when it goes red).
const knownGaps: Record<string, string> = {
  'number-empty-string-guard': 'Returns 0 for an empty NUMBER payload (Number("") === 0); should be default + PARSE_ERROR.',
};

interface Scenario {
  id: string;
  description: string;
  flagKey: string;
  type: 'boolean' | 'string' | 'number' | 'object';
  default: unknown;
  context?: Record<string, unknown>;
  requires?: string[];
  expect: { value: unknown; variant?: string; errorCode?: string };
}

/**
 * A fake Unleash Client API: so the provider runs its real
 * fetch/parse/evaluate path with no server, no token, no network.
 */
async function startFakeUnleash() {
  const server = http.createServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      const { method = 'GET', url = '' } = req;
      if (method === 'GET' && url.startsWith('/api/client/features')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(clientFeatures));
        return;
      }
      if (method === 'POST' && (url.startsWith('/api/client/register') || url.startsWith('/api/client/metrics'))) {
        res.writeHead(202);
        res.end();
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}/api`,
    token: 'conformance-not-a-real-token',
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

function evaluate(client: Client, s: Scenario): Promise<EvaluationDetails<JsonValue>> {
  const ctx = s.context ?? {};
  switch (s.type) {
    case 'boolean':
      return client.getBooleanDetails(s.flagKey, s.default as boolean, ctx) as Promise<EvaluationDetails<JsonValue>>;
    case 'string':
      return client.getStringDetails(s.flagKey, s.default as string, ctx) as Promise<EvaluationDetails<JsonValue>>;
    case 'number':
      return client.getNumberDetails(s.flagKey, s.default as number, ctx) as Promise<EvaluationDetails<JsonValue>>;
    case 'object':
      return client.getObjectDetails(s.flagKey, s.default as JsonValue, ctx);
  }
}

describe(`OpenFeature conformance · spec v${contract.specificationVersion}`, () => {
  let client: Client;
  let fake: Awaited<ReturnType<typeof startFakeUnleash>>;

  beforeAll(async () => {
    fake = await startFakeUnleash();
    await OpenFeature.setProviderAndWait(
      new UnleashProvider({
        url: fake.url,
        appName: 'openfeature-conformance',
        customHeaders: { Authorization: fake.token },
        refreshInterval: 1000,
      }),
    );
    client = OpenFeature.getClient();
  });

  afterAll(async () => {
    await OpenFeature.close();
    await fake.close();
  });

  for (const s of (contract.scenarios as Scenario[]).filter(appliesTo)) {
    const gap = knownGaps[s.id];
    const runner = gap ? it.fails : it;

    runner(`${s.id} — ${s.description}${gap ? ' [KNOWN GAP]' : ''}`, async () => {
      const d = await evaluate(client, s);

      // Tier 1 — the end result the app receives.
      expect(d.value).toEqual(s.expect.value);
      if (s.expect.variant) expect(d.variant).toBe(s.expect.variant);

      // Tier 2 — error semantics (this provider evaluates locally, so it owns them).
      if (evaluatesLocally) {
        if (s.expect.errorCode) expect(d.errorCode).toBe(s.expect.errorCode);
        else expect(d.errorCode).toBeUndefined();
      }
    });
  }
});
