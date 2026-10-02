'use client';

import { useState } from 'react';

export default function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can be unavailable (insecure context, permission denied) —
      // fail quietly rather than throwing in front of the admin.
    }
  };

  return (
    <button
      onClick={handleCopy}
      className="text-xs font-bold text-muted transition hover:text-saffron-ink"
      title={url}
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}
