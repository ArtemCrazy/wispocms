export type ArticleSelection = { target: string; fragment: string };

/** Read only a selection contained in the current article, never another panel. */
export function articleSelection(
  root: HTMLElement,
  selection: Selection | null,
): ArticleSelection | null {
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1)
    return null;
  const range = selection.getRangeAt(0);
  if (
    !root.contains(range.startContainer) ||
    !root.contains(range.endContainer)
  )
    return null;
  const container = (node: Node) =>
    (node.nodeType === 1
      ? (node as Element)
      : node.parentElement
    )?.closest<HTMLElement>("[data-ai-target]");
  const start = container(range.startContainer),
    end = container(range.endContainer);
  if (!start || !end || !root.contains(start) || !root.contains(end))
    return null;
  const copy = range.cloneContents();
  copy.querySelectorAll("button").forEach((button) => button.remove());
  const walker = root.ownerDocument.createTreeWalker(copy, 4);
  const parts: string[] = [];
  while (walker.nextNode()) parts.push(walker.currentNode.textContent ?? "");
  const fragment = parts.join("\n").trim();
  if (!fragment || fragment.length > 12000) return null;
  return {
    target: start === end ? (start.dataset.aiTarget ?? "") : "",
    fragment,
  };
}
