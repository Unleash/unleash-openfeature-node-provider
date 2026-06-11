import type { EvaluationContext, EvaluationContextValue, Logger } from '@openfeature/server-sdk';
import type { Context } from 'unleash-client';

type Properties = NonNullable<Context['properties']>;

const STRING_FIELDS = ['userId', 'sessionId', 'remoteAddress', 'environment', 'appName'] as const;

/**
 * Translates an OpenFeature evaluation context into an Unleash context.
 *
 * - `targetingKey` maps to `userId` and takes precedence over an explicit `userId` key.
 * - Well-known Unleash fields (`userId`, `sessionId`, `remoteAddress`, `environment`,
 *   `appName`, `currentTime`) map to their Unleash counterparts.
 * - All other keys land in `properties` for strategy/constraint evaluation. Strings and
 *   numbers pass through, booleans and dates are stringified, nested structures are
 *   dropped (Unleash constraints cannot evaluate them).
 */
export function translateContext(evaluationContext: EvaluationContext, logger?: Logger): Context {
  const { targetingKey, ...rest } = evaluationContext;
  const context: Context = {};
  const properties: Properties = {};

  for (const [key, value] of Object.entries(rest)) {
    if (value === undefined || value === null) {
      continue;
    }

    if ((STRING_FIELDS as readonly string[]).includes(key)) {
      const stringValue = toStringValue(value);
      if (stringValue === undefined) {
        logger?.debug(`UnleashProvider: dropping context field '${key}': cannot convert to string`);
      } else {
        context[key] = stringValue;
      }
      continue;
    }

    if (key === 'currentTime') {
      const date = toDate(value);
      if (date === undefined) {
        logger?.debug(`UnleashProvider: dropping context field 'currentTime': not a valid date`);
      } else {
        context.currentTime = date;
      }
      continue;
    }

    const property = toProperty(value);
    if (property === undefined) {
      logger?.debug(
        `UnleashProvider: dropping context property '${key}': nested structures cannot be used in Unleash constraints`,
      );
    } else {
      properties[key] = property;
    }
  }

  if (targetingKey !== undefined) {
    context.userId = targetingKey;
  }
  if (Object.keys(properties).length > 0) {
    context.properties = properties;
  }
  return context;
}

function toStringValue(value: EvaluationContextValue): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  return undefined;
}

function toDate(value: EvaluationContextValue): Date | undefined {
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  return undefined;
}

function toProperty(value: EvaluationContextValue): string | number | undefined {
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  return undefined;
}
