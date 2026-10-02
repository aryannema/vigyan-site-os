import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { isValidPhone } from '@/lib/phone';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { firstName, lastName, email, phone, whatsappOptIn, message } = body;

    // 1. Basic Validation
    if (!firstName || !lastName || !email || !message) {
      return NextResponse.json(
        { error: 'First name, Last name, Email, and Message are required.' },
        { status: 400 }
      );
    }
    // The forms in front of this endpoint validate too, but this is the only
    // check that cannot be skipped -- BlueprintRequestForm posts raw FormData
    // here with no validation of its own, and anyone can POST directly.
    if (whatsappOptIn && !isValidPhone(phone)) {
      return NextResponse.json(
        { error: 'A valid WhatsApp number (including country code) is required to opt in.' },
        { status: 400 }
      );
    }
    // A phone is optional without the opt-in, but if one is given it must be
    // real -- an unusable number in the CRM is worse than a blank field,
    // because it looks like a reachable lead.
    if (phone && !isValidPhone(phone)) {
      return NextResponse.json(
        { error: 'That phone number is not valid. Include the country code, e.g. +91…' },
        { status: 400 }
      );
    }

    // 2. Data Preparation
    const contactData = {
      full_name: `${firstName} ${lastName}`.trim(),
      first_name: firstName,
      last_name: lastName,
      email: email,
      phone_number: phone || 'N/A',
      whatsapp_opt_in: Boolean(whatsappOptIn),
      message: message,
      created_at: new Date().toISOString(),
    };

    // 3. Supabase Integration using Admin client (bypasses RLS)
    const { error } = await supabaseAdmin
      .from('contact_inquiries')
      .insert([contactData]);

    if (error) {
      console.error('Supabase Insertion Error:', error);
      return NextResponse.json(
        { error: `Database Error: ${error.message}. Table 'contact_inquiries' might not exist or columns mismatch.` },
        { status: 500 }
      );
    }

    return NextResponse.json({ 
      success: true, 
      message: 'Your inquiry has been received. We will get back to you shortly.' 
    });

  } catch (error) {
    console.error('Contact API Internal Error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error. Please check server logs.' },
      { status: 500 }
    );
  }
}
