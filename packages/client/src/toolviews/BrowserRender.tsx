/**
 * Browser Rendering output: the rendered text, captioned with the page it came
 * from. A screenshot is not rendered here — `cloudflare_browser_screenshot`
 * returns an image block that the host shows as it shows any image in a tool
 * result — so this view has no image branch.
 */
import { en } from '../locales/en.ts'

/** Props for the render view. */
export interface BrowserRenderProps {
  readonly url: string
  /** Rendered body: markdown, HTML, or serialized structured data. */
  readonly body: string
}

export function BrowserRender({ url, body }: BrowserRenderProps): React.JSX.Element {
  return (
    <figure className="cf-render">
      <figcaption>{en.toolView.renderHeading(url)}</figcaption>
      <pre className="cf-render__body" tabIndex={0} aria-label={en.toolView.renderHeading(url)}>
        {body}
      </pre>
    </figure>
  )
}
