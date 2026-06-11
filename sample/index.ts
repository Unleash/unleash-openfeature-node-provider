import { OpenFeature, ProviderEvents } from '@openfeature/server-sdk';
import { UnleashProvider } from '@unleash/openfeature-node-provider';

const UNLEASH_URL = process.env.UNLEASH_URL ?? 'http://localhost:4242/api';
const UNLEASH_API_TOKEN =
  process.env.UNLEASH_API_TOKEN ?? 'default:development.unleash-insecure-api-token';

async function main() {
  const provider = new UnleashProvider({
    url: UNLEASH_URL,
    appName: 'openfeature-sample',
    customHeaders: { Authorization: UNLEASH_API_TOKEN },
  });

  provider.events.addHandler(ProviderEvents.ConfigurationChanged, () => {
    console.log('[provider] flag configuration changed');
  });
  provider.events.addHandler(ProviderEvents.Stale, (details) => {
    console.warn('[provider] stale:', details?.message);
  });
  provider.events.addHandler(ProviderEvents.Error, (details) => {
    console.error('[provider] error:', details?.message);
  });

  await OpenFeature.setProviderAndWait(provider);
  console.log('[openfeature] provider ready\n');

  // Set a global evaluation context applied to every flag evaluation.
  OpenFeature.setContext({ targetingKey: 'user-123', email: 'user@example.com' });

  const client = OpenFeature.getClient();

  // Boolean flag — falls back to false when the flag is missing or disabled.
  const boolValue = await client.getBooleanValue('my-boolean-flag', false);
  console.log('my-boolean-flag:', boolValue);

  // String variant — falls back to 'control' when the flag is missing.
  const stringValue = await client.getStringValue('my-string-flag', 'control');
  console.log('my-string-flag:', stringValue);

  // Number variant — falls back to 0.
  const numberValue = await client.getNumberValue('my-number-flag', 0);
  console.log('my-number-flag:', numberValue);

  // Object variant — falls back to an empty object.
  const objectValue = await client.getObjectValue('my-object-flag', {});
  console.log('my-object-flag:', objectValue);

  // Per-call context overrides the global context for a single evaluation.
  const perCallValue = await client.getBooleanValue('my-boolean-flag', false, {
    targetingKey: 'user-456',
    email: 'other@example.com',
  });
  console.log('my-boolean-flag (user-456):', perCallValue);

  await OpenFeature.close();
  console.log('\n[openfeature] provider closed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
