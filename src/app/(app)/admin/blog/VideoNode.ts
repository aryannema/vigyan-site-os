import { Node, mergeAttributes } from '@tiptap/react';

/** Editor-side stand-in for a `video` block: shows the title, stores url/title/caption. */
export const VideoNode = Node.create({
  name: 'video',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      url: { default: '' },
      title: { default: '' },
      caption: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-video]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-video': '',
        class: 'my-3 rounded-card border border-hairline bg-sand px-4 py-3 text-sm text-body',
      }),
      `▶ Video: ${node.attrs.title} — ${node.attrs.url}`,
    ];
  },
});
