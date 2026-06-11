import { ParseError, StandardResolutionReasons, TypeMismatchError } from '@openfeature/server-sdk';
import { PayloadType, type Variant } from 'unleash-client';
import { describe, expect, it } from 'vitest';
import { resolveVariantValue } from '../src/variant-resolver';

function variant(overrides: Partial<Variant>): Variant {
  return { name: 'my-variant', enabled: true, feature_enabled: true, ...overrides };
}

describe('resolveVariantValue', () => {
  it('returns the default with reason DISABLED when the feature is disabled', () => {
    const result = resolveVariantValue(
      variant({ name: 'disabled', enabled: false, feature_enabled: false }),
      'string',
      'fallback',
    );
    expect(result).toEqual({
      value: 'fallback',
      reason: StandardResolutionReasons.DISABLED,
      flagMetadata: { featureEnabled: false },
    });
  });

  it('returns the default with reason DEFAULT when no variant is assigned', () => {
    const result = resolveVariantValue(variant({ name: 'disabled', enabled: false }), 'string', 'fallback');
    expect(result.value).toBe('fallback');
    expect(result.reason).toBe(StandardResolutionReasons.DEFAULT);
    expect(result.variant).toBeUndefined();
  });

  it('returns the default with reason DEFAULT when the variant has no payload', () => {
    const result = resolveVariantValue(variant({}), 'string', 'fallback');
    expect(result.value).toBe('fallback');
    expect(result.reason).toBe(StandardResolutionReasons.DEFAULT);
    expect(result.variant).toBeUndefined();
  });

  it('resolves a string payload', () => {
    const result = resolveVariantValue(
      variant({ payload: { type: PayloadType.STRING, value: 'hello' } }),
      'string',
      'fallback',
    );
    expect(result).toEqual({
      value: 'hello',
      variant: 'my-variant',
      reason: StandardResolutionReasons.SPLIT,
      flagMetadata: { featureEnabled: true, payloadType: 'string' },
    });
  });

  it('resolves a csv payload as a string', () => {
    const result = resolveVariantValue(
      variant({ payload: { type: PayloadType.CSV, value: 'a,b,c' } }),
      'string',
      'fallback',
    );
    expect(result.value).toBe('a,b,c');
  });

  it('resolves a number payload', () => {
    const result = resolveVariantValue(
      variant({ payload: { type: PayloadType.NUMBER, value: '42.5' } }),
      'number',
      0,
    );
    expect(result.value).toBe(42.5);
    expect(result.reason).toBe(StandardResolutionReasons.SPLIT);
  });

  it('throws TypeMismatchError for a number payload that is not numeric', () => {
    expect(() =>
      resolveVariantValue(variant({ payload: { type: PayloadType.NUMBER, value: 'abc' } }), 'number', 0),
    ).toThrow(TypeMismatchError);
  });

  it('resolves a json payload as an object', () => {
    const result = resolveVariantValue(
      variant({ payload: { type: PayloadType.JSON, value: '{"a": 1}' } }),
      'object',
      {},
    );
    expect(result.value).toEqual({ a: 1 });
  });

  it('throws ParseError for an invalid json payload', () => {
    expect(() =>
      resolveVariantValue(variant({ payload: { type: PayloadType.JSON, value: '{nope' } }), 'object', {}),
    ).toThrow(ParseError);
  });

  it('throws TypeMismatchError when the payload type does not match the requested type', () => {
    const stringPayload = variant({ payload: { type: PayloadType.STRING, value: 'hello' } });
    expect(() => resolveVariantValue(stringPayload, 'number', 0)).toThrow(TypeMismatchError);
    expect(() => resolveVariantValue(stringPayload, 'object', {})).toThrow(TypeMismatchError);
    const jsonPayload = variant({ payload: { type: PayloadType.JSON, value: '{}' } });
    expect(() => resolveVariantValue(jsonPayload, 'string', '')).toThrow(TypeMismatchError);
  });
});
