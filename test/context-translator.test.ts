import { describe, expect, it } from 'vitest';
import { translateContext } from '../src/context-translator';

describe('translateContext', () => {
  it('maps targetingKey to userId', () => {
    expect(translateContext({ targetingKey: 'user-1' })).toEqual({ userId: 'user-1' });
  });

  it('lets targetingKey take precedence over an explicit userId', () => {
    expect(translateContext({ targetingKey: 'user-1', userId: 'user-2' })).toEqual({ userId: 'user-1' });
  });

  it('uses an explicit userId when targetingKey is absent', () => {
    expect(translateContext({ userId: 'user-2' })).toEqual({ userId: 'user-2' });
  });

  it('maps well-known Unleash fields directly', () => {
    expect(
      translateContext({
        sessionId: 'session-1',
        remoteAddress: '127.0.0.1',
        environment: 'production',
        appName: 'my-app',
      }),
    ).toEqual({
      sessionId: 'session-1',
      remoteAddress: '127.0.0.1',
      environment: 'production',
      appName: 'my-app',
    });
  });

  it('passes currentTime through as a Date', () => {
    const now = new Date('2026-06-10T12:00:00Z');
    expect(translateContext({ currentTime: now })).toEqual({ currentTime: now });
  });

  it('parses currentTime from an ISO string', () => {
    expect(translateContext({ currentTime: '2026-06-10T12:00:00Z' })).toEqual({
      currentTime: new Date('2026-06-10T12:00:00Z'),
    });
  });

  it('drops an unparseable currentTime', () => {
    expect(translateContext({ currentTime: 'not a date' })).toEqual({});
  });

  it('puts custom keys into properties, preserving strings and numbers', () => {
    expect(translateContext({ region: 'EMEA', tenantCount: 3 })).toEqual({
      properties: { region: 'EMEA', tenantCount: 3 },
    });
  });

  it('stringifies booleans and dates in properties', () => {
    expect(translateContext({ beta: true, signupDate: new Date('2026-01-01T00:00:00Z') })).toEqual({
      properties: { beta: 'true', signupDate: '2026-01-01T00:00:00.000Z' },
    });
  });

  it('drops nested structures from properties', () => {
    expect(translateContext({ nested: { a: 1 }, list: ['a'], region: 'EMEA' })).toEqual({
      properties: { region: 'EMEA' },
    });
  });

  it('omits properties entirely when no custom keys survive', () => {
    expect(translateContext({ targetingKey: 'user-1', nested: { a: 1 } })).toEqual({ userId: 'user-1' });
  });

  it('ignores null and undefined values', () => {
    expect(
      translateContext({ userId: undefined, region: null } as never),
    ).toEqual({});
  });
});
