import * as aiTools from '../src/tools/ai/index.ts'
import * as dataTools from '../src/tools/data/index.ts'
import * as metaTools from '../src/tools/meta.ts'
import * as webTools from '../src/tools/web.ts'
import { type JsonValue } from '../src/tools/_shared/json.ts'
import { PNG_1X1, envelope, makeHarness, type Harness } from './harness.ts'

export type Fetch = (request: Request) => Promise<Response>

/**
 * Every tool, with arguments that pass its schema and a response its output
 * schema admits. Shared by the suites that walk the whole registry, so a tool
 * added tomorrow is covered by both without either naming it twice.
 */
export const CASES: [string, (fetchImpl: Fetch) => Harness, Record<string, JsonValue>, () => Response][] = [
  ['cloudflare_ai_run', (f) => makeHarness(aiTools, f), { model: '@cf/m', input: {} }, () => envelope({})],
  ['cloudflare_ai_models_search', (f) => makeHarness(aiTools, f), {}, () => envelope([])],
  ['cloudflare_ai_model_schema', (f) => makeHarness(aiTools, f), { model: '@cf/m' }, () => envelope({})],
  ['cloudflare_aigateway_list', (f) => makeHarness(aiTools, f), {}, () => envelope([])],
  ['cloudflare_aigateway_get', (f) => makeHarness(aiTools, f), { gatewayId: 'g' }, () => envelope({})],
  ['cloudflare_aigateway_logs', (f) => makeHarness(aiTools, f), { gatewayId: 'g' }, () => envelope([])],
  [
    'cloudflare_aigateway_log_body',
    (f) => makeHarness(aiTools, f),
    { gatewayId: 'g', logId: 'l', part: 'request' },
    () => envelope({}),
  ],
  ['cloudflare_aigateway_routes', (f) => makeHarness(aiTools, f), { gatewayId: 'g' }, () => envelope([])],
  [
    'cloudflare_aigateway_cost',
    (f) => makeHarness(aiTools, f),
    { view: 'credit-balance' },
    () => envelope({}),
  ],
  [
    'cloudflare_aigateway_session_cost',
    (f) => makeHarness(aiTools, f),
    { gatewayId: 'g', sessionId: 's' },
    () => envelope([]),
  ],
  [
    'cloudflare_aisearch_search',
    (f) => makeHarness(aiTools, f),
    { instanceId: 'i', query: 'q' },
    () => envelope({}),
  ],
  [
    'cloudflare_aisearch_chat',
    (f) => makeHarness(aiTools, f),
    { instanceId: 'i', query: 'q' },
    () => envelope({}),
  ],
  ['cloudflare_aisearch_sync', (f) => makeHarness(aiTools, f), { instanceId: 'i' }, () => envelope({})],
  ['cloudflare_vectorize_index_list', (f) => makeHarness(aiTools, f), {}, () => envelope([])],
  [
    'cloudflare_vectorize_query',
    (f) => makeHarness(aiTools, f),
    { indexName: 'i', vector: [1] },
    () => envelope({}),
  ],
  [
    'cloudflare_vectorize_upsert',
    (f) => makeHarness(aiTools, f),
    { indexName: 'i', vectors: [{ id: 'a', values: [1] }] },
    () => envelope({}),
  ],
  [
    'cloudflare_vectorize_delete',
    (f) => makeHarness(aiTools, f),
    { indexName: 'i', ids: ['a'] },
    () => envelope({}),
  ],
  [
    'cloudflare_vectorize_get',
    (f) => makeHarness(aiTools, f),
    { indexName: 'i', ids: ['a'] },
    () => envelope({}),
  ],
  ['cloudflare_kv_namespace_list', (f) => makeHarness(dataTools, f), {}, () => envelope([])],
  ['cloudflare_kv_list_keys', (f) => makeHarness(dataTools, f), { namespaceId: 'n' }, () => envelope([])],
  [
    'cloudflare_kv_get',
    (f) => makeHarness(dataTools, f),
    { namespaceId: 'n', key: 'k' },
    () => new Response('v', { status: 200 }),
  ],
  [
    'cloudflare_kv_put',
    (f) => makeHarness(dataTools, f),
    { namespaceId: 'n', entries: [{ key: 'k', value: 'v' }] },
    () => envelope({ successful_key_count: 1, unsuccessful_keys: [] }),
  ],
  [
    'cloudflare_kv_delete',
    (f) => makeHarness(dataTools, f),
    { namespaceId: 'n', keys: ['k'] },
    () => envelope({ successful_key_count: 1, unsuccessful_keys: [] }),
  ],
  ['cloudflare_d1_list', (f) => makeHarness(dataTools, f), {}, () => envelope([])],
  [
    'cloudflare_d1_query',
    (f) => makeHarness(dataTools, f),
    { databaseId: 'd', sql: 'select 1' },
    () => envelope([]),
  ],
  ['cloudflare_queue_list', (f) => makeHarness(dataTools, f), {}, () => envelope([])],
  [
    'cloudflare_queue_send',
    (f) => makeHarness(dataTools, f),
    { queueId: 'q', body: 'x' },
    () => envelope(null),
  ],
  [
    'cloudflare_queue_pull',
    (f) => makeHarness(dataTools, f),
    { queueId: 'q' },
    () => envelope({ messages: [] }),
  ],
  [
    'cloudflare_queue_ack',
    (f) => makeHarness(dataTools, f),
    { queueId: 'q', acks: ['a'] },
    () => envelope(null),
  ],
  ['cloudflare_r2_bucket_list', (f) => makeHarness(dataTools, f), {}, () => envelope({ buckets: [] })],
  ['cloudflare_r2_bucket_create', (f) => makeHarness(dataTools, f), { name: 'b' }, () => envelope({})],
  [
    'cloudflare_browser_render',
    (f) => makeHarness(webTools, f),
    { url: 'https://x.test', format: 'markdown' },
    () => envelope('# x'),
  ],
  [
    'cloudflare_browser_screenshot',
    (f) => makeHarness(webTools, f),
    { url: 'https://x.test' },
    () => new Response(PNG_1X1, { status: 200, headers: { 'content-type': 'image/png' } }),
  ],
  [
    'cloudflare_browser_accessibility_tree',
    (f) => makeHarness(webTools, f),
    { url: 'https://x.test' },
    () => envelope({}),
  ],
  ['cloudflare_account_list', (f) => makeHarness(metaTools, f), {}, () => envelope([{ id: 'a', name: 'A' }])],
  [
    'cloudflare_api',
    (f) => makeHarness(metaTools, f),
    { method: 'GET', path: '/zones' },
    () => envelope(null),
  ],
]
