/**
 * The accessibility tree of a rendered page.
 *
 * Rendered as a real nested list so the structure is navigable by the same
 * assistive technology it describes — a flat JSON dump would show the data
 * without conveying the hierarchy.
 */
import { en } from '../locales/en.ts'

/** One accessibility node, as Browser Rendering returns it. */
export interface AxNode {
  readonly role?: string
  readonly name?: string
  readonly children?: readonly AxNode[]
}

/** Props for the tree view. */
export interface AccessibilityTreeProps {
  readonly url: string
  readonly tree: AxNode
}

/** Describe one node for display. */
export function describeNode(node: AxNode): string {
  const role = node.role ?? 'unknown'
  const name = node.name
  return name === undefined || name === '' ? role : `${role}: ${name}`
}

/** Count every node in the tree, including the root. */
export function countNodes(node: AxNode): number {
  return 1 + (node.children ?? []).reduce((total, child) => total + countNodes(child), 0)
}

function TreeNode({ node }: { readonly node: AxNode }): React.JSX.Element {
  const children = node.children ?? []
  return (
    <li>
      {describeNode(node)}
      {children.length > 0 && (
        <ul>
          {children.map((child, index) => (
            // Accessibility nodes carry no stable id, so position is the key.
            // eslint-disable-next-line react/no-array-index-key
            <TreeNode key={index} node={child} />
          ))}
        </ul>
      )}
    </li>
  )
}

export function AccessibilityTree({ url, tree }: AccessibilityTreeProps): React.JSX.Element {
  return (
    <section className="cf-axtree" aria-label={en.toolView.treeHeading(url)}>
      <ul>
        <TreeNode node={tree} />
      </ul>
    </section>
  )
}
