'use client';

import { Node } from '@tiptap/react';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';

function MarkdownView({ node, updateAttributes, selected }: NodeViewProps) {
  return (
    <NodeViewWrapper
      className={`my-3 rounded-card border bg-sand/60 p-2 ${selected ? 'border-saffron-500' : 'border-hairline'}`}
      contentEditable={false}
    >
      <div className="mb-1 flex items-center justify-between text-xs text-muted">
        <span className="font-mono">Markdown — tables, math ($…$), mermaid, task lists, images, YouTube links</span>
        <span>preview shows the rendered result</span>
      </div>
      <textarea
        value={String(node.attrs.text ?? '')}
        onChange={(e) => updateAttributes({ text: e.target.value })}
        rows={Math.min(24, Math.max(6, String(node.attrs.text ?? '').split('\n').length + 1))}
        spellCheck={false}
        className="w-full rounded-card border border-hairline bg-surface p-2 font-mono text-xs text-ink"
      />
    </NodeViewWrapper>
  );
}

/** Editor-side node for a lossless `markdown` block; the text is edited raw. */
export const MarkdownNode = Node.create({
  name: 'markdownBlock',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return { text: { default: '' } };
  },

  parseHTML() {
    return [{ tag: 'div[data-markdown-block]' }];
  },

  renderHTML({ node }) {
    return ['div', { 'data-markdown-block': '' }, String(node.attrs.text ?? '')];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MarkdownView);
  },
});
