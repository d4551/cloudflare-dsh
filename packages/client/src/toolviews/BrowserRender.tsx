/**
 * Browser Rendering output: the rendered text, captioned with the page it came
 * from. A screenshot is not rendered here — `cloudflare_browser_screenshot`
 * returns an image block that the host shows as it shows any image in a tool
 * result — so this view has no image branch.
 *
 * The scroll container is a `<section>` rather than the `<pre>` itself. A
 * `<pre>` maps to the `generic` role, which ARIA prohibits `aria-label` on —
 * axe reports it for review and assistive technology may drop the name
 * altogether — and it takes its name from the caption by reference, so the
 * heading text exists once. `tabIndex` keeps the overflow reachable (SC 2.1.1).
 */
import { useId } from 'react'
import { en } from '../locales/en.ts'

/** Props for the render view. */
export interface BrowserRenderProps {
  readonly url: string
  /** Rendered body: markdown, HTML, or serialized structured data. */
  readonly body: string
}

export function BrowserRender({ url, body }: BrowserRenderProps): React.JSX.Element {
  const captionId = useId()
  return (
    <figure className="cf-render">
      <figcaption id={captionId}>{en.toolView.renderHeading(url)}</figcaption>
      <section className="cf-render__body" tabIndex={0} aria-labelledby={captionId}>
        <pre>{body}</pre>
      </section>
    </figure>
  )
}
