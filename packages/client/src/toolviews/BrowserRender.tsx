/**
 * Browser Rendering output: the rendered text, captioned with the page it came
 * from. A screenshot is not rendered here — `cloudflare_browser_screenshot`
 * returns an image block that the host shows as it shows any image in a tool
 * result — so this view has no image branch.
 *
 * The `<figure>` is the scroll container, and it is deliberately not a
 * landmark. A `<section>` with a name is a `region`, and tool views repeat: a
 * conversation that renders the same page twice would ship two landmarks with
 * one name, which the assembled scan catches as `landmark-unique`. A figure
 * takes a name, groups its content and stays out of the landmark map.
 *
 * `aria-label` is not on the `<pre>`: that maps to the `generic` role, which
 * ARIA prohibits naming — axe reports it for review and assistive technology
 * may drop the name entirely. The name comes from the caption by reference, so
 * the page it came from is stated once. `tabIndex` keeps the overflow
 * reachable by keyboard (SC 2.1.1).
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
    <figure className="cf-render" tabIndex={0} aria-labelledby={captionId}>
      <figcaption id={captionId} className="cf-render__caption">
        {en.toolView.renderHeading(url)}
      </figcaption>
      <pre className="cf-render__body">{body}</pre>
    </figure>
  )
}
