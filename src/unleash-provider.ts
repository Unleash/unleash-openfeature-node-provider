import { once } from 'node:events';
import {
  FlagNotFoundError,
  GeneralError,
  OpenFeatureEventEmitter,
  ProviderEvents,
  StandardResolutionReasons,
  type EvaluationContext,
  type JsonValue,
  type Logger,
  type Provider,
  type ResolutionDetails,
} from '@openfeature/server-sdk';
import { Unleash, UnleashEvents, type UnleashConfig } from 'unleash-client';
import { translateContext } from './context-translator';
import { resolveVariantValue, type VariantValueType } from './variant-resolver';

/**
 * OpenFeature provider backed by the Unleash Node.js SDK.
 *
 * The provider constructs and owns the Unleash client: the client is created and
 * started in `initialize()` and destroyed (with a metrics flush) in `onClose()`.
 */
export class UnleashProvider implements Provider {
  readonly metadata = { name: 'unleash' } as const;
  readonly runsOn = 'server' as const;
  readonly events = new OpenFeatureEventEmitter();

  private readonly config: UnleashConfig;
  private client?: Unleash;
  /** The repository holds flag data (from a fetch, bootstrap, or backup file). */
  private hasData = false;
  /** A Stale/Error event has been emitted and not yet followed by Ready. */
  private degraded = false;

  constructor(config: UnleashConfig) {
    this.config = config;
  }

  set unleashClient(client:  Unleash) {
    this.client = client;
  }

  get unleashClient(): Unleash | undefined {
    return this.client;
  }

  async initialize(): Promise<void> {
    if (this.client) {
      return;
    }
    if (!this.client) {
        this.client = new Unleash({ ...this.config, disableAutoStart: true });
    }

    this.client.on(UnleashEvents.Error, (error: unknown) => this.onUnleashError(error));
    this.client.on(UnleashEvents.Synchronized, () => this.onUnleashSuccess());
    this.client.on(UnleashEvents.Unchanged, () => this.onUnleashSuccess());
    this.client.on(UnleashEvents.Changed, () => {
      this.onUnleashSuccess();
      this.events.emit(ProviderEvents.ConfigurationChanged, { message: 'Flag configuration changed' });
    });

    // Both events are emitted on a later tick than the one where start() resolves,
    // and the client refuses to evaluate flags until its internal ready flag is set,
    // so wait for the events rather than for start() alone. Unlike startUnleash(),
    // don't wait forever: reject on the first error so setProviderAndWait() cannot
    // hang. The client keeps polling, so a later successful fetch emits Ready and
    // recovers the provider.
    const abort = new AbortController();
    const started = Promise.all([
      once(this.client, UnleashEvents.Ready, { signal: abort.signal }),
      once(this.client, UnleashEvents.Synchronized, { signal: abort.signal }),
    ]);
    const failed = once(this.client, UnleashEvents.Error, { signal: abort.signal }).then(([error]) =>
      Promise.reject(toError(error)),
    );
    try {
      await this.client.start();
      await Promise.race([started, failed]);
    } finally {
      abort.abort();
    }
    this.hasData = true;
  }

  async onClose(): Promise<void> {
    const client = this.client;
    if (!client) {
      return;
    }
    this.client = undefined;
    await client.destroyWithFlush();
  }

  async resolveBooleanEvaluation(
    flagKey: string,
    _defaultValue: boolean,
    context: EvaluationContext,
    logger: Logger,
  ): Promise<ResolutionDetails<boolean>> {
    const client = this.requireClient(flagKey);
    const enabled = client.isEnabled(flagKey, translateContext(context, logger));
    return {
      value: enabled,
      reason: enabled ? StandardResolutionReasons.TARGETING_MATCH : StandardResolutionReasons.DISABLED,
    };
  }

  async resolveStringEvaluation(
    flagKey: string,
    defaultValue: string,
    context: EvaluationContext,
    logger: Logger,
  ): Promise<ResolutionDetails<string>> {
    return this.evaluateVariant(flagKey, 'string', defaultValue, context, logger);
  }

  async resolveNumberEvaluation(
    flagKey: string,
    defaultValue: number,
    context: EvaluationContext,
    logger: Logger,
  ): Promise<ResolutionDetails<number>> {
    return this.evaluateVariant(flagKey, 'number', defaultValue, context, logger);
  }

  async resolveObjectEvaluation<T extends JsonValue>(
    flagKey: string,
    defaultValue: T,
    context: EvaluationContext,
    logger: Logger,
  ): Promise<ResolutionDetails<T>> {
    return this.evaluateVariant(flagKey, 'object', defaultValue, context, logger);
  }

  private evaluateVariant<T>(
    flagKey: string,
    expectedType: VariantValueType,
    defaultValue: T,
    context: EvaluationContext,
    logger: Logger,
  ): ResolutionDetails<T> {
    const client = this.requireClient(flagKey);
    const variant = client.getVariant(flagKey, translateContext(context, logger));
    return resolveVariantValue(variant, expectedType, defaultValue);
  }

  /**
   * Returns the client, enforcing FLAG_NOT_FOUND semantics: Unleash itself treats
   * unknown flags as disabled, but OpenFeature callers should be able to tell
   * "missing" apart from "off".
   */
  private requireClient(flagKey: string): Unleash {
    if (!this.client) {
      throw new GeneralError('Unleash provider is not initialized');
    }
    if (this.client.getFeatureToggleDefinition(flagKey) === undefined) {
      throw new FlagNotFoundError(`Flag '${flagKey}' was not found in Unleash`);
    }
    return this.client;
  }

  private onUnleashError(error: unknown): void {
    this.degraded = true;
    const message = toError(error).message;
    if (this.hasData) {
      // Cached flags are still served while the client retries, so the provider
      // is stale rather than down.
      this.events.emit(ProviderEvents.Stale, { message });
    } else {
      this.events.emit(ProviderEvents.Error, { message });
    }
  }

  private onUnleashSuccess(): void {
    this.hasData = true;
    if (this.degraded) {
      this.degraded = false;
      this.events.emit(ProviderEvents.Ready, { message: 'Unleash client recovered' });
    }
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new GeneralError(String(error));
}
