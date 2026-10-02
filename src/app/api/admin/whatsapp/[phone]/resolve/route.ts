import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(request: Request, { params }: { params: Promise<{ phone: string }> }) {
  const { phone } = await params;
  const phoneNumber = decodeURIComponent(phone);

  const { error } = await supabaseAdmin
    .from('whatsapp_conversations')
    .update({ mode: 'auto', escalation_reason: null, unresolved_turns: 0 })
    .eq('phone_number', phoneNumber);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ status: 'ok' });
}
