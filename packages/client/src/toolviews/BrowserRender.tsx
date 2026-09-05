/**
 * Browser Rendering output.
 *
 * A screenshot gets a meaningful `alt` naming the page it shows, and — because
 * an image alone is not an accessible representation of a page — the source URL
 * is always available as text alongside it (SC 1.1.1).
 */
import { en } from '../locales/en.ts'

/** Props for the render view. */
export interface BrowserRenderProps {
  readonly url: string
  readonly format: string
  /** Rendered body: text for markdown and content, a data URI for screenshots. */
  readonly body: string
}

/** Whether a rendered body should be shown as an image. */
export function isImageFormat(format: string): boolean {
  return format === 'screenshot'
}

export function BrowserRender({ url, format, body }: BrowserRenderProps): React.JSX.Element {
  return (
    <figure className="cf-render">
      <figcaption>{en.toolView.renderHeading(url)}</figcaption>
      {isImageFormat(format) ? (
        <img className="cf-render__image" src={body} alt={en.toolView.screenshotAlt(url)} />
      ) : (
        <pre className="cf-render__body" tabIndex={0} aria-label={en.toolView.renderHeading(url)}>
          {body}
        </pre>
      )}
    </figure>
  )
}
