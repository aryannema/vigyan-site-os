import Link from 'next/link';
import { notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import ResolveButton from './ResolveButton';


export const dynamic = 'force-dynamic';
type Message = {
  id: string;
  direction: 'inbound' | 'outbound';
  body: string;
  model: string | null;
  confidence: number | null;
  escalated: boolean;
  escalation_reason: string | null;
  created_at: string;
};

async function getConversation(phone: string) {
  const { data: conversation } = await supabaseAdmin
    .from('whatsapp_conversations')
    .select('*')
    .eq('phone_number', phone)
    .maybeSingle();
  if (!conversation) return null;

  const { data: messages } = await supabaseAdmin
    .from('whatsapp_messages')
    .select('*')
    .eq('phone_number', phone)
    .order('created_at', { ascending: true });

  return { conversation, messages: (messages ?? []) as Message[] };
}

export default async function ConversationThreadPage({ params }: { params: Promise<{ phone: string }> }) {
  const { phone } = await params;
  const result = await getConversation(decodeURIComponent(phone));
  if (!result) notFound();
  const { conversation, messages } = result;

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/admin/whatsapp" className="text-xs text-muted hover:underline">
            ← All conversations
          </Link>
          <h1 className="text-2xl font-bold text-ink dark:text-white font-mono mt-1">
            {conversation.phone_number}
          </h1>
        </div>
        {conversation.mode === 'human' && <ResolveButton phoneNumber={conversation.phone_number} />}
      </div>

      {conversation.mode === 'human' && (
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="py-3 text-sm text-red-500">
            Escalated to human — reason: <span className="font-mono">{conversation.escalation_reason}</span>.
            The bot is silent on this conversation until marked resolved.
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                m.direction === 'outbound'
                  ? 'bg-brand-primary text-slate-950'
                  : 'bg-surface border border-hairline text-ink dark:text-white'
              }`}
            >
              <p className="whitespace-pre-wrap">{m.body}</p>
              <div className="mt-1.5 flex items-center gap-2 text-[10px] opacity-70">
                <span>{new Date(m.created_at).toLocaleString()}</span>
                {m.model && <Badge variant="outline" className="text-[10px]">{m.model}</Badge>}
                {m.confidence !== null && <span>conf {m.confidence.toFixed(2)}</span>}
                {m.escalated && <Badge variant="destructive" className="text-[10px]">escalated</Badge>}
              </div>
            </div>
          </div>
        ))}
        {messages.length === 0 && (
          <p className="text-center text-muted py-8">No messages in this conversation.</p>
        )}
      </div>
    </div>
  );
}
