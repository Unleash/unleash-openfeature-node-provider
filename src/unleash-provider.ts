import {
  GeneralError,
  OpenFeatureEventEmitter,
  ProviderEvents,
  ProviderNotReadyError,
  type EvaluationContext,
  type JsonValue,
  type Logger,
  type Provider,
  type ResolutionDetails,
} from '@openfeature/server-sdk';
import { Unleash, UnleashEvents, type UnleashConfig } from 'unleash-client';
import { translateContext } from './context-translator';
import { resolveVariantValue, type VariantValueType } from './variant-resolver';

export class UnleashProvider implements Provider {
  readonly metadata = { name: 'unleash-openfeature-node-provider' } as const;
  readonly runsOn = 'server' as const;
  readonly events = new OpenFeatureEventEmitter();

  private readonly config: UnleashConfig;
  private client?: Unleash;
  private hasData = false;
  private degraded = false;

  constructor(config: UnleashConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    this.client = this.createUnleashClient();
    this.setupListeners(this.client);
    await this.client.start();
  }

  setupListeners(client: Unleash): void {
    client.on(UnleashEvents.Error, (error: unknown) => this.onUnleashError(error));
    client.on(UnleashEvents.Synchronized, () => this.onUnleashSuccess());
    client.on(UnleashEvents.Unchanged, () => this.onUnleashSuccess());
    client.on(UnleashEvents.Changed, () => {
      this.onUnleashSuccess();
      this.events.emit(ProviderEvents.ConfigurationChanged, { message: 'Flag configuration changed' });
    });
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
    const client = this.requireClient();
    const enabled = client.isEnabled(flagKey, translateContext(context, logger));
    return {
      value: enabled
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
    const client = this.requireClient();
    const variant = client.getVariant(flagKey, translateContext(context, logger));
    return resolveVariantValue(variant, expectedType, defaultValue);
  }

  private requireClient(): Unleash {
    if (!this.client) {
      throw new GeneralError('Unleash provider is not initialized');
    }
    if (!this.client.isSynchronized()) {
      throw new ProviderNotReadyError('Unleash provider has not yet synchronized flag data');
    }
    return this.client;
  }

  /** Overridable seam for testing — returns a fully configured Unleash client. */
  protected createUnleashClient(): Unleash {
    return new Unleash({ ...this.config, disableAutoStart: true });
  }

  private onUnleashError(error: unknown): void {
    const err = toError(error);
    this.degraded = true;
    const message = err.message;
    if (this.hasData) {
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
