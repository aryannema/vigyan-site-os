import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Verify it's a standard Telegram message payload
    if (body.message) {
      const chat_id = body.message.chat.id;
      const user_name = body.message.from?.first_name || 'User';

      // ==========================================
      // 1. THE VOICE SCOPE (InfiniteTalk / Conformer)
      // ==========================================
      if (body.message.voice) {
        const file_id = body.message.voice.file_id;
        const duration = body.message.voice.duration;
        
        console.log(`[Telegram] Received Voice Memo from ${user_name}. Duration: ${duration}s. File ID: ${file_id}`);
        
        // Future Voice Processing Roadmap:
        // 1. Fetch file via: https://api.telegram.org/bot<TOKEN>/getFile?file_id=${file_id}
        // 2. Download the .ogg audio file.
        // 3. Pipe to IndicConformer API for transcription (STT).
        // 4. Send transcribed text to Gemma 4 (our lab) for semantic understanding.
        // 5. Pipe Gemma's response text to InfiniteTalk (TTS) to generate voice clone output.
        // 6. POST back to Telegram via `sendVoice` endpoint so the bot replies with spoken audio.

        return NextResponse.json({ status: 'Voice received, queued for agentic processing' });
      }

      // ==========================================
      // 2. THE TEXT SCOPE (Commands & Walled Garden)
      // ==========================================
      if (body.message.text) {
        const text = body.message.text;
        console.log(`[Telegram] Received Text from ${user_name}: ${text}`);

        if (text.startsWith('/start')) {
          // Future Action: 
          // 1. Insert chat_id into Supabase `leads` table.
          // 2. Reply with YourSite Walled Garden Blueprint PDF via `sendDocument` API.
          console.log(`[Telegram] Triggering Walled Garden onboarding for ${chat_id}`);
        }
      }
    }

    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    console.error('Telegram Webhook Error:', error);
    // Always return 200 to Telegram so it stops retrying the webhook
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 200 });
  }
}
