import Link from 'next/link';
import { AlertCircle, CheckCircle2, MessageSquare, MessageCircle } from 'lucide-react';

import { supabaseAdmin } from '@/lib/supabase';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { StatTile } from '@/components/ui/stat-tile';

import { PageHeader } from '../components/PageHeader';

export const dynamic = 'force-dynamic';
type Conversation = {
  phone_number: string;
  mode: 'auto' | 'human';
  last_inbound_at: string | null;
  escalation_reason: string | null;
  unresolved_turns: number;
  updated_at: string;
};

async function getConversations(): Promise<Conversation[]> {
  const { data, error } = await supabaseAdmin
    .from('whatsapp_conversations')
    .select('*')
    .order('updated_at', { ascending: false });
  if (error || !data) return [];
  return data as Conversation[];
}

function ModeBadge({ mode }: { mode: Conversation['mode'] }) {
  if (mode === 'human') {
    return <Badge variant="destructive">Needs reply</Badge>;
  }
  return <Badge variant="secondary">Auto</Badge>;
}

function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default async function WhatsAppCrmPage() {
  const conversations = await getConversations();
  const needsReply = conversations.filter((c) => c.mode === 'human').length;
  const autoHandled = conversations.length - needsReply;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="WhatsApp CRM"
        description={`${conversations.length} conversation${conversations.length === 1 ? '' : 's'}`}
        breadcrumbs={[{ label: 'CRM' }, { label: 'WhatsApp' }]}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile label="Total conversations" value={conversations.length} icon={MessageSquare} />
        <StatTile
          label="Needs a reply"
          value={needsReply}
          icon={AlertCircle}
          accent={needsReply > 0 ? 'destructive' : 'none'}
        />
        <StatTile label="Handled automatically" value={autoHandled} icon={CheckCircle2} accent="green" />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Phone</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last message</TableHead>
                <TableHead>Escalation reason</TableHead>
                <TableHead className="text-right">Turns</TableHead>
                <TableHead className="text-right">Open</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {conversations.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted">
                    No conversations yet.
                  </TableCell>
                </TableRow>
              )}
              {conversations.map((c) => (
                <TableRow key={c.phone_number}>
                  <TableCell className="font-mono">
                    <Link href={`/admin/whatsapp/${c.phone_number}`} className="text-saffron-ink hover:underline">
                      {c.phone_number}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <ModeBadge mode={c.mode} />
                  </TableCell>
                  <TableCell className="text-muted">{timeAgo(c.last_inbound_at)}</TableCell>
                  <TableCell className="text-xs text-muted">{c.escalation_reason || '—'}</TableCell>
                  <TableCell className="text-right">{c.unresolved_turns}</TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/admin/whatsapp/${c.phone_number}`}
                      className="inline-flex rounded-md p-1.5 text-muted transition hover:bg-well hover:text-saffron-ink"
                      aria-label={`Open conversation with ${c.phone_number}`}
                      title="Open conversation"
                    >
                      <MessageCircle className="h-4 w-4" />
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
