/**
 * OpenAI-compatible SSE events to harness `StreamChunk`s.
 *
 * This is a pure state machine with no I/O, no clock and no randomness, which
 * is deliberate: the adapter's whole contract lives here — block-index
 * allocation, argument accumulation, `usage`-before-`finish` ordering — so it
 * can be exercised exhaustively from arrays of fixture events. The I/O shell in
 * `adapter.ts` stays thin enough to hold no logic worth testing indirectly.
 *
 * Contract obligations implemented here:
 *  - block indices are allocated in first-seen order and reused for every
 *    delta of that block;
 *  - tool-call `arguments` stay raw JSON strings end to end, streamed as
 *    `argumentsDelta` fragments and re-joined at `block-end`;
 *  - `usage` is emitted before `finish`, and nothing is emitted after it.
 */
import type { ContentBlock, FinishReason, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'

/** One streamed tool call, as OpenAI-compatible providers send it. */
export interface WireToolCallDelta {
  readonly index: number
  readonly id?: string
  readonly type?: string
  readonly function?: { readonly name?: string; readonly arguments?: string }
}

/** The delta payload of one streamed choice. */
export interface WireDelta {
  readonly content?: string | null
  readonly reasoning_content?: string | null
  readonly tool_calls?: readonly WireToolCallDelta[]
}

/** One choice in a streamed chunk. */
export interface WireChoice {
  readonly delta?: WireDelta
  readonly finish_reason?: string | null
}

/** Token accounting as OpenAI-compatible providers report it. */
export interface WireUsage {
  readonly prompt_tokens?: number
  readonly completion_tokens?: number
  readonly total_tokens?: number
  readonly prompt_tokens_details?: { readonly cached_tokens?: number }
  readonly completion_tokens_details?: { readonly reasoning_tokens?: number }
}

/** One parsed SSE data payload. */
export interface WireChunk {
  readonly choices?: readonly WireChoice[]
  readonly usage?: WireUsage | null
}

/** Map a provider finish reason onto the harness vocabulary. */
export function mapFinishReason(reason: string): FinishReason {
  switch (reason) {
    case 'tool_calls':
      return { kind: 'tool-calls' }
    case 'length':
      return { kind: 'max-tokens' }
    default:
      return { kind: 'stop' }
  }
}

/**
 * Convert provider usage into harness `TokenUsage`.
 *
 * The harness requires disjoint counts: `inputTokens` is *uncached* input, with
 * cache reads reported separately, so cached tokens are subtracted out rather
 * than double-counted.
 */
export function mapUsage(usage: WireUsage): TokenUsage {
  const promptTokens = usage.prompt_tokens ?? 0
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0
  const reasoning = usage.completion_tokens_details?.reasoning_tokens
  const result: TokenUsage = {
    inputTokens: Math.max(promptTokens - cached, 0),
    outputTokens: usage.completion_tokens ?? 0,
  }
  const withTotal = usage.total_tokens === undefined ? result : { ...result, totalTokens: usage.total_tokens }
  const withCache = cached === 0 ? withTotal : { ...withTotal, cacheReadTokens: cached }
  return reasoning === undefined ? withCache : { ...withCache, reasoningTokens: reasoning }
}

/** A block currently open in the stream. */
interface OpenBlock {
  readonly index: number
  readonly type: 'text' | 'reasoning' | 'tool-call'
  text: string
  id: string
  name: string
}

/**
 * Accumulates wire events and emits harness chunks.
 *
 * One instance handles one model call; `push` is total over the wire
 * vocabulary and `end` closes whatever remains open.
 */
export class StreamTransducer {
  private nextIndex = 0
  private text: OpenBlock | undefined
  private reasoning: OpenBlock | undefined
  private readonly toolCalls = new Map<number, OpenBlock>()
  private finished = false

  /** Open a block, allocating the next index in first-seen order. */
  private open(type: OpenBlock['type']): OpenBlock {
    const block: OpenBlock = { index: this.nextIndex, type, text: '', id: '', name: '' }
    this.nextIndex += 1
    return block
  }

  /**
   * Materialise an open block as its finished content block.
   *
   * An exhaustive switch rather than a chain with a fallback: a block type that
   * is not handled should be a visible failure, not silently rendered as a
   * tool call.
   */
  private static finish(block: OpenBlock): ContentBlock {
    switch (block.type) {
      case 'text':
        return { type: 'text', text: block.text }
      case 'reasoning':
        return { type: 'reasoning', text: block.text }
      case 'tool-call':
        return {
          type: 'tool-call',
          id: block.id as ToolCallId,
          name: block.name,
          arguments: block.text,
        }
    }
  }

  /** Feed one parsed SSE payload, returning the chunks it produces. */
  push(chunk: WireChunk): StreamChunk[] {
    if (this.finished) return []
    const out: StreamChunk[] = []
    const choices = chunk.choices

    // A usage-only chunk carries no choices at all, so the absence is a real
    // state rather than something to paper over with an empty default.
    if (choices !== undefined) {
      for (const choice of choices) this.pushDelta(choice.delta, out)
    }
    if (chunk.usage !== undefined && chunk.usage !== null) {
      out.push({ type: 'usage', usage: mapUsage(chunk.usage) })
    }
    if (choices !== undefined) {
      for (const choice of choices) {
        const reason = choice.finish_reason
        if (reason === undefined || reason === null) continue
        out.push(...this.closeAll())
        out.push({ type: 'finish', reason: mapFinishReason(reason) })
        this.finished = true
        return out
      }
    }
    return out
  }

  /** Apply one delta payload. */
  private pushDelta(delta: WireDelta | undefined, out: StreamChunk[]): void {
    if (delta === undefined) return

    const reasoning = delta.reasoning_content
    if (reasoning !== undefined && reasoning !== null && reasoning !== '') {
      if (this.reasoning === undefined) {
        this.reasoning = this.open('reasoning')
        out.push({ type: 'block-start', index: this.reasoning.index, blockType: 'reasoning' })
      }
      this.reasoning.text += reasoning
      out.push({ type: 'reasoning-delta', index: this.reasoning.index, text: reasoning })
    }

    const content = delta.content
    if (content !== undefined && content !== null && content !== '') {
      if (this.text === undefined) {
        this.text = this.open('text')
        out.push({ type: 'block-start', index: this.text.index, blockType: 'text' })
      }
      this.text.text += content
      out.push({ type: 'text-delta', index: this.text.index, text: content })
    }

    for (const call of delta.tool_calls ?? []) {
      let block = this.toolCalls.get(call.index)
      if (block === undefined) {
        block = this.open('tool-call')
        this.toolCalls.set(call.index, block)
        out.push({ type: 'block-start', index: block.index, blockType: 'tool-call' })
      }
      if (call.id !== undefined) block.id = call.id
      if (call.function?.name !== undefined) block.name = call.function.name
      const args = call.function?.arguments
      if (args !== undefined) block.text += args
      out.push({
        type: 'tool-call-delta',
        index: block.index,
        id: block.id as ToolCallId,
        ...(block.name === '' ? {} : { name: block.name }),
        argumentsDelta: args ?? '',
      })
    }
  }

  /**
   * Close every open block, in index order.
   *
   * Only ever called at termination, so it does not reset the open-block state:
   * `finished` already makes every later call a no-op, and clearing here would
   * be work nothing can observe.
   */
  private closeAll(): StreamChunk[] {
    const open: OpenBlock[] = []
    if (this.reasoning !== undefined) open.push(this.reasoning)
    if (this.text !== undefined) open.push(this.text)
    open.push(...this.toolCalls.values())
    open.sort((a, b) => a.index - b.index)

    return open.map((block): StreamChunk => ({
      type: 'block-end',
      index: block.index,
      block: StreamTransducer.finish(block),
    }))
  }

  /**
   * Close the stream when the provider ended without a finish reason.
   *
   * Returns nothing when a finish was already emitted, so the contract that
   * nothing follows `finish` holds even on a truncated stream.
   */
  end(): StreamChunk[] {
    if (this.finished) return []
    this.finished = true
    return [...this.closeAll(), { type: 'finish', reason: { kind: 'stop' } }]
  }

  /** Whether a finish chunk has already been emitted. */
  get isFinished(): boolean {
    return this.finished
  }
}
