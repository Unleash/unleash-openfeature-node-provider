# Unleash OpenFeature Provider for Node.js

An [OpenFeature](https://openfeature.dev) provider backed by the official
[Unleash Node.js SDK](https://github.com/Unleash/unleash-node-sdk) (`unleash-client`),
for server-side Node.js applications.

Adheres to [OpenFeature specification **v0.8.0**](https://openfeature.dev/specification/)
via [`@openfeature/server-sdk`](https://www.npmjs.com/package/@openfeature/server-sdk) `>=1.14.0`
(the first release of the server SDK implementing spec v0.8.0). All required provider
behavior is implemented: typed flag resolution, evaluation context handling, lifecycle
(initialization/shutdown), and provider events. Of the spec's optional capabilities,
provider hooks and the tracking API (spec section 6) are not implemented — see
[Out of scope](#out-of-scope).

The provider constructs and owns the Unleash client: it is created and started when the
provider is initialized, and destroyed (with a final metrics flush) when OpenFeature shuts
down. Flags are evaluated locally by the Unleash SDK against the translated evaluation
context, so Unleash usage metrics keep working as usual.

## Installation

```sh
pnpm install @unleash/openfeature-node-provider @openfeature/server-sdk unleash-client
```

If you cloned without submodules, initialize the verifier harness:

```bash
git submodule update --init --recursive
```

The contract tests use the `verifier` submodule. To refresh it:

```bash
git submodule update --remote --merge verifier
```

## Usage

```ts
import { OpenFeature } from '@openfeature/server-sdk';
import { UnleashProvider } from '@unleash/openfeature-node-provider';

const provider = new UnleashProvider({
  // any UnleashConfig accepted by the Unleash Node SDK
  url: 'https://app.unleash-hosted.com/demo/api/',
  appName: 'my-app',
  customHeaders: { Authorization: '<your-api-token>' },
});

// Resolves once the Unleash client is ready and synchronized
await OpenFeature.setProviderAndWait(provider);

const client = OpenFeature.getClient();

const enabled = await client.getBooleanValue('my-flag', false, { targetingKey: 'user-123' });
const variantText = await client.getStringValue('my-copy-experiment', 'default text', {
  targetingKey: 'user-123',
  sessionId: 'session-1',
  region: 'EMEA', // custom keys become Unleash properties
});
```

The underlying Unleash client is available as an escape hatch via `provider.unleashClient`.

## Concept mapping

### Flag evaluation

| OpenFeature call | Unleash mechanism |
| --- | --- |
| `getBooleanValue` / `getBooleanDetails` | `isEnabled()` |
| `getStringValue` / `getStringDetails` | variant payload of type `string` or `csv` |
| `getNumberValue` / `getNumberDetails` | variant payload of type `number` |
| `getObjectValue` / `getObjectDetails` | variant payload of type `json` (parsed) |

If the variant payload type does not match the requested type, the evaluation returns the
default value with `errorCode: TYPE_MISMATCH`. A flag that does not exist in Unleash returns
the default value with `errorCode: FLAG_NOT_FOUND` (note that this differs from the raw
Unleash SDK, which treats unknown flags as disabled). Disabled flags resolve variant
evaluations to the default value with reason `DISABLED`; enabled flags without an assigned
variant (or without a payload) resolve to the default value with reason `DEFAULT`.

The assigned variant name is reported in `variant`, and `flagMetadata` carries
`featureEnabled` and `payloadType`.

### Evaluation context

| OpenFeature context key | Unleash context field |
| --- | --- |
| `targetingKey` | `userId` (takes precedence over an explicit `userId` key) |
| `userId`, `sessionId`, `remoteAddress`, `environment`, `appName` | same field |
| `currentTime` (Date or ISO string) | `currentTime` |
| any other key | `properties.<key>` |

Strings and numbers pass into `properties` unchanged; booleans and dates are stringified.
Nested objects and arrays are dropped (with a debug log), since Unleash constraints cannot
evaluate them.

#### Stickiness

Unleash resolves default stickiness for gradual rollouts and variant assignment internally,
falling back through `userId` → `sessionId` → random. The provider does not replicate or
alter this chain — it only fills in the fields. `targetingKey` fills `userId`; if you want
session-based stickiness, set `sessionId` in the evaluation context. A missing
`targetingKey` is never an error: evaluation falls through Unleash's normal chain and ends
at random stickiness. Custom stickiness on a custom context field works via `properties`.

### Events and lifecycle

| Unleash client state | OpenFeature provider event |
| --- | --- |
| ready + synchronized | `PROVIDER_READY` |
| configuration changed | `PROVIDER_CONFIGURATION_CHANGED` |
| fetch error while cached flags are served | `PROVIDER_STALE` |
| error before any flag data is available | `PROVIDER_ERROR` |
| recovery after an error | `PROVIDER_READY` |

`initialize()` rejects on the first Unleash error instead of waiting forever, so
`setProviderAndWait()` cannot hang on a misconfigured connection. The Unleash client keeps
retrying in the background and the provider recovers (emitting `PROVIDER_READY`) once a
fetch succeeds.

### Reasons

Unleash does not expose which strategy matched an evaluation, so reasons are best-effort:
`TARGETING_MATCH` for enabled flags, `DISABLED` for disabled ones, `SPLIT` for assigned
variants, `DEFAULT` when the default value is used, and `ERROR` alongside an error code.

## Out of scope

The OpenFeature tracking API is not implemented. Unleash impression data and usage metrics
are unaffected — they are handled by the underlying SDK.

## Development

```sh
pnpm install
pnpm test        # vitest: unit + offline integration tests (bootstrap data, no server)
pnpm run build   # tsup: ESM + CJS + type declarations
```

## License

Apache-2.0
