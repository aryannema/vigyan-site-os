import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { listMediaObjects } from './storage';
import { DeleteMediaButton } from './DeleteMediaButton';

export const dynamic = 'force-dynamic';

const GB = 1024 * 1024 * 1024;
const FREE_TIER_BYTES = 1 * GB;
const OVERAGE_PER_GB_PER_MONTH = 0.0213; // Supabase Storage, confirmed from supabase.com/docs/guides/storage/pricing

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export default async function MediaPage() {
  const objects = await listMediaObjects();
  const totalBytes = objects.reduce((sum, o) => sum + o.size, 0);
  const overageBytes = Math.max(0, totalBytes - FREE_TIER_BYTES);
  const estimatedMonthlyCost = (overageBytes / GB) * OVERAGE_PER_GB_PER_MONTH;

  return (
    <>
      <PageHeader
        title="Media library"
        description={
          `Bucket "post-images" on Supabase Storage (S3-compatible, public read, ` +
          `10MB/file limit). Backs both AI-generated images and local uploads from ` +
          `the blog editor — one storage location either way.`
        }
      />

      <div className="mb-6 rounded-card border border-hairline bg-sand p-4 text-sm">
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-muted">
          <span>
            <strong className="text-ink">{objects.length}</strong> files
          </span>
          <span>
            <strong className="text-ink">{formatBytes(totalBytes)}</strong> total (
            {formatBytes(FREE_TIER_BYTES)} free tier included)
          </span>
          <span>
            Est. overage cost:{' '}
            <strong className="text-ink">
              {estimatedMonthlyCost > 0
                ? `~$${estimatedMonthlyCost.toFixed(4)}/month`
                : '$0 (within free tier)'}
            </strong>
          </span>
        </div>
        <p className="mt-2 text-xs text-faint">
          Supabase Storage: 1GB free, then $0.0213/GB/month overage (Pro/Team plans include 100GB
          before overage applies). Source: supabase.com/docs/guides/storage/pricing, confirmed
          2026-08-11. Bandwidth/egress cost not shown here — not confirmed from that page.
        </p>
      </div>

      {objects.length === 0 ? (
        <EmptyState
          title="No media yet"
          description="Upload or AI-generate an image from the blog editor to see it here."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Preview</TableHead>
              <TableHead>File</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Size</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {objects.map((obj) => (
              <TableRow key={obj.name}>
                <TableCell>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={obj.url}
                    alt=""
                    className="h-12 w-12 rounded border border-hairline object-cover"
                  />
                </TableCell>
                <TableCell>
                  <a
                    href={obj.url}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-xs text-ink hover:underline"
                  >
                    {obj.name}
                  </a>
                </TableCell>
                <TableCell className="text-xs text-muted">{obj.mimetype}</TableCell>
                <TableCell className="text-xs text-muted">{formatBytes(obj.size)}</TableCell>
                <TableCell className="text-xs text-muted">
                  {new Date(obj.createdAt).toISOString().slice(0, 16).replace('T', ' ')}
                </TableCell>
                <TableCell className="text-right">
                  <DeleteMediaButton name={obj.name} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
