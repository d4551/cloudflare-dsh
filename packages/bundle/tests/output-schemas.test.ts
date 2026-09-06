import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import * as aiTools from '../src/tools/ai.ts'
import * as dataTools from '../src/tools/data.ts'
import * as metaTools from '../src/tools/meta.ts'
import * as webTools from '../src/tools/web.ts'
import { envelope, makeHarness } from './harness.ts'

type OutputSchema = ToolDefinition['output']['schema']

/** Nothing here calls Cloudflare; tools are read, not run. */
const unreachable = async () => envelope(null)

/** Every registered tool with its compiled output schema, across all four plugins. */
const TOOLS: [string, OutputSchema][] = [
  makeHarness(aiTools, unreachable),
  makeHarness(dataTools, unreachable),
  makeHarness(webTools, unreachable),
  makeHarness(metaTools, unreachable),
].flatMap((h) => h.names().map((name): [string, OutputSchema] => [name, h.tool(name).output.schema]))

/** The declared properties of an object node; no other node kind has any. */
function propertiesOf(schema: OutputSchema): [string, OutputSchema][] {
  return 'properties' in schema && schema.properties !== undefined ? Object.entries(schema.properties) : []
}

describe('every tool declares a typed output object', () => {
  it('covers all 33 tools', () => {
    expect(TOOLS).toHaveLength(33)
  })

  // The canonical value is a programmatic API under PTC, so generated code
  // reads named fields from it. A closed root means a field the model reads
  // is one the tool declared; a description on each means the generated SDK
  // documents it; a required list covering every property means no field is
  // sometimes absent.
  it.each(TOOLS)('%s: a closed object whose every property is described and required', (_name, schema) => {
    expect(schema).toMatchObject({ type: 'object', additionalProperties: false })
    const properties = propertiesOf(schema)
    expect(properties.length).toBeGreaterThan(0)
    for (const [key, property] of properties) {
      expect(property, key).toHaveProperty('description', expect.stringMatching(/\S/))
    }
    expect(schema).toHaveProperty(
      'required',
      properties.map(([key]) => key),
    )
  })
})

describe('the registry refuses a value the declared output does not admit', () => {
  // The schema is not documentation: the registry validates every returned
  // value against it, so an API response of the wrong shape becomes a tool
  // error the model can read instead of a malformed value it cannot.
  it('a model catalogue of scalars is an invalid output, not a value', async () => {
    const h = makeHarness(aiTools, async () => envelope([1]))
    await expect(h.execute('cloudflare_ai_models_search', {})).resolves.toMatchObject({
      isError: true,
      error: {
        message:
          'tool "cloudflare_ai_models_search" returned invalid output: "value.models[0]" must be an object',
        info: { name: 'ToolOutputError', code: 'INVALID_TOOL_OUTPUT' },
      },
    })
  })

  it('a queue pull whose messages are not a list is an invalid output, not a value', async () => {
    const h = makeHarness(dataTools, async () => envelope({ messages: 'x' }))
    await expect(h.execute('cloudflare_queue_pull', { queueId: 'q' })).resolves.toMatchObject({
      isError: true,
      error: {
        message: 'tool "cloudflare_queue_pull" returned invalid output: "value.messages" must be an array',
        info: { name: 'ToolOutputError', code: 'INVALID_TOOL_OUTPUT' },
      },
    })
  })
})
