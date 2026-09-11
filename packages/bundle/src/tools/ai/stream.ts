/**
 * The streaming refusal for `cloudflare_ai_run`.
 *
 * Its own module because both the tool that raises it and the plugin entry
 * that publishes it need it, and neither needs the other.
 */

/** Raised when cloudflare_ai_run is asked to stream, which its single JSON response cannot carry. */
export class AiRunStreamError extends TypeError {
  override readonly name = 'AiRunStreamError'
  constructor() {
    super(
      'cloudflare_ai_run returns one complete response; a streamed completion comes from the cloudflare-workers-ai model provider instead',
    )
  }
}
