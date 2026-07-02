import { EventEmitter } from 'node:events';
import {
  ErrorCode,
  OpenFeature,
  ProviderEvents,
  ProviderFatalError,
  StandardResolutionReasons,
} from '@openfeature/server-sdk';
import {
  InMemStorageProvider,
  PayloadType,
  Unleash,
  UnleashEvents,
  type UnleashConfig,
} from 'unleash-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { UnleashProvider, type UnleashProviderConfig } from '../src/unleash-provider';

type BootstrapFeatures = NonNullable<NonNullable<UnleashConfig['bootstrap']>['data']>;

const defaultStrategy = { name: 'default', parameters: {}, constraints: [] };

const features: BootstrapFeatures = [
  {
    name: 'bool-flag',
    enabled: true,
    strategies: [defaultStrategy],
  },
  {
    name: 'disabled-flag',
    enabled: false,
    strategies: [defaultStrategy],
  },
  {
    name: 'targeted-flag',
    enabled: true,
    strategies: [{ name: 'userWithId', parameters: { userIds: 'user-1' }, constraints: [] }],
  },
  {
    name: 'string-variant-flag',
    enabled: true,
    strategies: [defaultStrategy],
    variants: [
      { name: 'text', weight: 1000, payload: { type: PayloadType.STRING, value: 'hello' } },
    ],
  },
  {
    name: 'csv-variant-flag',
    enabled: true,
    strategies: [defaultStrategy],
    variants: [
      { name: 'list', weight: 1000, payload: { type: PayloadType.CSV, value: 'a,b,c' } },
    ],
  },
  {
    name: 'number-variant-flag',
    enabled: true,
    strategies: [defaultStrategy],
    variants: [
      { name: 'amount', weight: 1000, payload: { type: PayloadType.NUMBER, value: '42.5' } },
    ],
  },
  {
    name: 'json-variant-flag',
    enabled: true,
    strategies: [defaultStrategy],
    variants: [
      { name: 'config', weight: 1000, payload: { type: PayloadType.JSON, value: '{"a": 1}' } },
    ],
  },
  {
    name: 'no-variant-flag',
    enabled: true,
    strategies: [defaultStrategy],
  },
];

// Fully offline: bootstrap supplies the flags, refreshInterval 0 disables fetching.
const offlineConfig: UnleashConfig = {
  appName: 'openfeature-provider-test',
  url: 'http://localhost:9/api',
  refreshInterval: 0,
  disableMetrics: true,
  storageProvider: new InMemStorageProvider(),
  skipInstanceCountWarning: true,
  bootstrap: { data: features },
};

describe('UnleashProvider (end-to-end via OpenFeature SDK)', () => {
  const provider = new UnleashProvider(offlineConfig);
  const client = OpenFeature.getClient('unleash-test');

  beforeAll(async () => {
    await OpenFeature.setProviderAndWait('unleash-test', provider);
  });

  afterAll(async () => {
    await OpenFeature.close();
  });

  it('exposes the underlying Unleash client after initialization', () => {
    expect(provider.unleashClient).toBeDefined();
    expect(provider.unleashClient?.isSynchronized()).toBe(true);
  });

  it('resolves an enabled boolean flag', async () => {
    const details = await client.getBooleanDetails('bool-flag', false);
    expect(details.value).toBe(true);
    expect(details.reason).toBe(StandardResolutionReasons.TARGETING_MATCH);
  });

  it('resolves a disabled boolean flag', async () => {
    const details = await client.getBooleanDetails('disabled-flag', true);
    expect(details.value).toBe(false);
    expect(details.reason).toBe(StandardResolutionReasons.DISABLED);
  });

  it('returns FLAG_NOT_FOUND for an unknown flag', async () => {
    const details = await client.getBooleanDetails('no-such-flag', true);
    expect(details.value).toBe(true);
    expect(details.errorCode).toBe(ErrorCode.FLAG_NOT_FOUND);
    expect(details.reason).toBe(StandardResolutionReasons.ERROR);
  });

  it('applies targeting via targetingKey', async () => {
    const matched = await client.getBooleanDetails('targeted-flag', false, { targetingKey: 'user-1' });
    expect(matched.value).toBe(true);
    const unmatched = await client.getBooleanDetails('targeted-flag', false, { targetingKey: 'user-2' });
    expect(unmatched.value).toBe(false);
  });

  it('resolves a string variant payload', async () => {
    const details = await client.getStringDetails('string-variant-flag', 'fallback');
    expect(details.value).toBe('hello');
    expect(details.variant).toBe('text');
    expect(details.reason).toBe(StandardResolutionReasons.SPLIT);
    expect(details.flagMetadata).toEqual({ featureEnabled: true, payloadType: 'string' });
  });

  it('resolves a csv variant payload as a string', async () => {
    const details = await client.getStringDetails('csv-variant-flag', 'fallback');
    expect(details.value).toBe('a,b,c');
  });

  it('resolves a number variant payload', async () => {
    const details = await client.getNumberDetails('number-variant-flag', 0);
    expect(details.value).toBe(42.5);
    expect(details.variant).toBe('amount');
  });

  it('resolves a json variant payload as an object', async () => {
    const details = await client.getObjectDetails('json-variant-flag', {});
    expect(details.value).toEqual({ a: 1 });
    expect(details.variant).toBe('config');
  });

  it('returns TYPE_MISMATCH when the payload type does not match the requested type', async () => {
    const details = await client.getNumberDetails('string-variant-flag', 7);
    expect(details.value).toBe(7);
    expect(details.errorCode).toBe(ErrorCode.TYPE_MISMATCH);
    expect(details.reason).toBe(StandardResolutionReasons.ERROR);
  });

  it('returns the default with reason DEFAULT for an enabled flag without variants', async () => {
    const details = await client.getStringDetails('no-variant-flag', 'fallback');
    expect(details.value).toBe('fallback');
    expect(details.reason).toBe(StandardResolutionReasons.DEFAULT);
  });

  it('returns the default with reason DISABLED for variant evaluation of a disabled flag', async () => {
    const details = await client.getStringDetails('disabled-flag', 'fallback');
    expect(details.value).toBe('fallback');
    expect(details.reason).toBe(StandardResolutionReasons.DISABLED);
  });

  it('forwards configuration changes as PROVIDER_CONFIGURATION_CHANGED', async () => {
    const seen = new Promise<void>((resolve) => {
      client.addHandler(ProviderEvents.ConfigurationChanged, () => resolve());
    });
    provider.unleashClient?.emit(UnleashEvents.Changed);
    await seen;
  });

  it('emits PROVIDER_STALE on Unleash errors once flag data is present', async () => {
    const seen = new Promise<string | undefined>((resolve) => {
      client.addHandler(ProviderEvents.Stale, (details) => resolve(details?.message));
    });
    provider.unleashClient?.emit(UnleashEvents.Error, new Error('fetch failed'));
    await expect(seen).resolves.toBe('fetch failed');
  });

  it('emits PROVIDER_READY again when the client recovers', async () => {
    const seen = new Promise<void>((resolve) => {
      client.addHandler(ProviderEvents.Ready, () => resolve());
    });
    provider.unleashClient?.emit(UnleashEvents.Unchanged);
    await seen;
  });
});

// ---------------------------------------------------------------------------
// Minimal fake Unleash client for initialization edge-case tests.
// Extends EventEmitter so on/emit/once work identically to the real client.
// ---------------------------------------------------------------------------

class FakeUnleash extends EventEmitter {
  private _synchronized = false;

  isSynchronized(): boolean {
    return this._synchronized;
  }

  /**
   * Set the synchronized flag and schedule a Synchronized event via setImmediate.
   * setImmediate fires after all pending microtasks and nextTick callbacks, which
   * matches the timing of the real Unleash client (where Synchronized fires via
   * process.nextTick only after an internal storageProvider.set() await drains).
   * This ensures initialize()'s once(Synchronized) listener is registered before
   * the event fires.
   */
  markSynchronized(): void {
    this._synchronized = true;
    setImmediate(() => this.emit(UnleashEvents.Synchronized));
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async start(): Promise<void> {}

  async destroyWithFlush(): Promise<void> {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getFeatureToggleDefinition(_name: string): undefined {
    return undefined;
  }
}

const minimalConfig: UnleashProviderConfig = {
  appName: 'init-test',
  url: 'http://localhost:9/api',
  refreshInterval: 0,
  disableMetrics: true,
  storageProvider: new InMemStorageProvider(),
  skipInstanceCountWarning: true,
};

/** Provider subclass that injects a FakeUnleash instead of constructing a real one. */
class TestableProvider extends UnleashProvider {
  constructor(
    private readonly fakeClient: FakeUnleash,
    config: UnleashProviderConfig = minimalConfig,
  ) {
    super(config);
  }

  protected override createUnleashClient(): Unleash {
    return this.fakeClient as unknown as Unleash;
  }
}

describe('UnleashProvider — initialization edge cases', () => {
  afterEach(async () => {
    await OpenFeature.close();
  });

  it('resolves as soon as bootstrap data is present (isSynchronized immediately after start)', async () => {
    // offlineConfig supplies bootstrap; the real Unleash client sets synchronized
    // synchronously during loadBootstrap(), so isSynchronized() is true after start().
    const provider = new UnleashProvider({
      ...offlineConfig,
      appName: 'bootstrap-test',
      storageProvider: new InMemStorageProvider(),
    });
    await expect(provider.initialize()).resolves.toBeUndefined();
    expect(provider.unleashClient?.isSynchronized()).toBe(true);
    await provider.onClose();
  });

  it('does not reject on a transient error during start; resolves once Synchronized fires', async () => {
    const fakeClient = new FakeUnleash();
    fakeClient.start = async () => {
      // Emit a transient (non-fatal) error — isSynchronized() remains false.
      fakeClient.emit(UnleashEvents.Error, new Error('ECONNREFUSED'));
    };

    const provider = new TestableProvider(fakeClient);
    const initPromise = provider.initialize();

    // Yield so initialize() advances past start() and reaches once(Synchronized).
    await Promise.resolve();

    // Simulate a later successful fetch.
    fakeClient.markSynchronized();
    fakeClient.emit(UnleashEvents.Synchronized);

    await expect(initPromise).resolves.toBeUndefined();
  });

  it('emits STALE (not ERROR) on error after data is present, then READY on recovery', async () => {
    const fakeClient = new FakeUnleash();
    fakeClient.start = async () => {
      fakeClient.markSynchronized();
    };

    const provider = new TestableProvider(fakeClient);
    await provider.initialize();

    // Now data exists — an error should emit Stale, not Error.
    const stalePromise = new Promise<void>((resolve) => {
      provider.events.addHandler(ProviderEvents.Stale, () => resolve());
    });
    fakeClient.emit(UnleashEvents.Error, new Error('temporary network error'));
    await stalePromise;

    // Recovery via Unchanged should emit Ready.
    const readyPromise = new Promise<void>((resolve) => {
      provider.events.addHandler(ProviderEvents.Ready, () => resolve());
    });
    fakeClient.emit(UnleashEvents.Unchanged);
    await readyPromise;
  });

  it('rejects with PROVIDER_FATAL when initializationTimeoutMs is exceeded', async () => {
    // No bootstrap, refreshInterval 0 → fetch() is a no-op → never synchronizes.
    const provider = new UnleashProvider({
      ...minimalConfig,
      initializationTimeoutMs: 50,
    });

    await expect(provider.initialize()).rejects.toThrow(ProviderFatalError);
    await provider.onClose();
  });

  it('returns PROVIDER_NOT_READY when evaluated before initialization completes', async () => {
    const fakeClient = new FakeUnleash();
    let resolveStart!: () => void;
    // start() hangs until the test manually releases it.
    fakeClient.start = () => new Promise<void>((resolve) => { resolveStart = resolve; });

    const provider = new TestableProvider(fakeClient);

    // Non-awaited — provider status stays NOT_READY.
    void OpenFeature.setProvider('not-ready-scope', provider);
    const ofClient = OpenFeature.getClient('not-ready-scope');

    const details = await ofClient.getBooleanDetails('bool-flag', false);
    expect(details.errorCode).toBe(ErrorCode.PROVIDER_NOT_READY);

    // Let initialization complete so the process can exit cleanly.
    fakeClient.markSynchronized();
    resolveStart();
    fakeClient.emit(UnleashEvents.Synchronized);
  });

  it('does not emit PROVIDER_READY from the provider itself during initial initialization', async () => {
    const fakeClient = new FakeUnleash();
    fakeClient.start = async () => {
      fakeClient.markSynchronized();
    };

    const provider = new TestableProvider(fakeClient);
    let providerReadyCount = 0;
    provider.events.addHandler(ProviderEvents.Ready, () => { providerReadyCount++; });

    await provider.initialize();
    // Drain any queued microtasks / nextTick callbacks.
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(providerReadyCount).toBe(0);
  });
});
