import {
  type FlagMetadata,
  ParseError,
  type ResolutionDetails,
  StandardResolutionReasons,
  TypeMismatchError,
} from '@openfeature/server-sdk';
import { PayloadType, type Variant } from 'unleash-client';

export type VariantValueType = 'string' | 'number' | 'object';

/**
 * Maps an Unleash variant to OpenFeature resolution details for the requested type.
 *
 * - Disabled feature -> default value, reason DISABLED.
 * - No variant assigned (or variant without payload) -> default value, reason DEFAULT.
 * - Payload type incompatible with the requested type -> TypeMismatchError.
 * - Assigned variant payload -> typed value, reason SPLIT (variant assignment is
 *   weighted/sticky), with the variant name in `variant`.
 *
 * Payload type compatibility: `string` and `csv` payloads resolve as strings,
 * `number` as numbers, `json` as objects.
 */
export function resolveVariantValue<T>(
  variant: Variant,
  expectedType: VariantValueType,
  defaultValue: T,
): ResolutionDetails<T> {
  const flagMetadata: FlagMetadata = {};
  if (variant.feature_enabled !== undefined) {
    flagMetadata.featureEnabled = variant.feature_enabled;
  }

  if (variant.feature_enabled === false) {
    return { value: defaultValue, reason: StandardResolutionReasons.DISABLED, flagMetadata };
  }

  if (!variant.enabled || variant.payload === undefined) {
    return { value: defaultValue, reason: StandardResolutionReasons.DEFAULT, flagMetadata };
  }

  const { payload } = variant;
  flagMetadata.payloadType = payload.type;

  return {
    value: parsePayload(variant.name, payload.type, payload.value, expectedType) as T,
    variant: variant.name,
    reason: StandardResolutionReasons.SPLIT,
    flagMetadata,
  };
}

function parsePayload(
  variantName: string,
  payloadType: PayloadType,
  payloadValue: string,
  expectedType: VariantValueType,
): unknown {
  switch (expectedType) {
    case 'string':
      if (payloadType !== PayloadType.STRING && payloadType !== PayloadType.CSV) {
        throw mismatch(variantName, payloadType, expectedType);
      }
      return payloadValue;
    case 'number': {
      if (payloadType !== PayloadType.NUMBER) {
        throw mismatch(variantName, payloadType, expectedType);
      }
      const parsed = Number(payloadValue);
      if (Number.isNaN(parsed)) {
        throw new TypeMismatchError(
          `Payload of variant '${variantName}' has type 'number' but value '${payloadValue}' is not a number`,
        );
      }
      return parsed;
    }
    case 'object':
      if (payloadType !== PayloadType.JSON) {
        throw mismatch(variantName, payloadType, expectedType);
      }
      try {
        return JSON.parse(payloadValue);
      } catch (error) {
        throw new ParseError(
          `Payload of variant '${variantName}' is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
  }
}

function mismatch(
  variantName: string,
  payloadType: PayloadType,
  expectedType: VariantValueType,
): TypeMismatchError {
  return new TypeMismatchError(
    `Payload of variant '${variantName}' has type '${payloadType}', which cannot be resolved as '${expectedType}'`,
  );
}
