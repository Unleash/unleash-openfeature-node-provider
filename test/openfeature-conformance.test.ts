import { type Client, OpenFeature } from '@openfeature/server-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  appliesTo,
  type Capability,
  evaluate,
  type FakeUnleash,
  type Scenario,
  scenarios,
  startFakeUnleash,
} from 'unleash-openfeature-nodejs-verifier';
import { UnleashProvider } from '../src/index';

// This provider evaluates locally and takes per-call context → both server capabilities.
const capabilities: readonly Capability[] = ['localEval', 'perCallContext'];

// TODO - run as EXPECTED failures 
const knownGaps: Record<string, string> = {
  'bool-missing-flag':
    'Emits FLAG_NOT_FOUND for a missing flag; spec says missing → default with no error.',
  'number-empty-string-guard':
    'Returns 0 for an empty NUMBER payload (Number("") === 0); should be default + PARSE_ERROR.',
};

describe('OpenFeature conformance (shared contract)', () => {
  let client: Client;
  let fake: FakeUnleash;

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

  const applicable = (scenarios as readonly Scenario[]).filter((s) => appliesTo(s, capabilities));
  const evaluatesLocally = capabilities.includes('localEval');

  for (const s of applicable) {
    const gap = knownGaps[s.id];
    const runner = gap ? it.fails : it;

    runner(`${s.id} — ${s.description}${gap ? ' [KNOWN GAP]' : ''}`, async () => {
      const d = await evaluate(client, s);

      // the end result the app receives.
      expect(d.value).toEqual(s.expect.value);
      if (s.expect.variant) expect(d.variant).toBe(s.expect.variant);

      // error semantics (this provider evaluates locally, so it owns them).
      if (evaluatesLocally) {
        if (s.expect.errorCode) expect(d.errorCode).toBe(s.expect.errorCode);
        else expect(d.errorCode).toBeUndefined();
      }
    });
  }
});
