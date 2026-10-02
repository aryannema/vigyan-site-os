import type { Metadata } from 'next';
import CTASection from '@/components/site/CTASection';
import Eyebrow from '@/components/site/Eyebrow';
import LeadForm from '@/components/site/LeadForm';
import { siteConfig } from '@/config/site';
import { getSectionContent } from '@/lib/getContent';
import {
  HeadingContent,
  TextContent,
} from '@/lib/content-schema';
import { isFeatureEnabled } from '@/lib/feature-flags';
import { getWhatsAppNumber, formatWhatsAppNumber } from '@/lib/whatsapp-number';

// Contact details, edited rarely.
export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Contact Us',
  description: 'Get in touch with YourSite — questions, projects and partnerships.',
  alternates: { canonical: '/contact' },
};

// --- Default (Fallback) Content ---
const fallbackHeaderHeading: HeadingContent = {
  text: "Let's build your ",
  highlight: "your next project."
};
const fallbackHeaderDescription: TextContent = {
  text: "Tell us what you need and we'll get back to you within one working day."
};
const fallbackHeaderQuote: TextContent = {
  text: "Real people, real answers."
};
const fallbackInfoEmail = {
  label: "Email",
  value: siteConfig.links.contact.email
};
const fallbackInfoLocation = {
  label: "Location",
  value: siteConfig.links.contact.locationLabel
};
const fallbackFormConfig = {
  title: "Start your project",
  description: "Share your requirements and we’ll respond with a roadmap."
};
const fallbackFormSubmit = {
  label: "Submit Inquiry",
  successTitle: "Message Sent!",
  successMessage: "Thank you! Your message has been received."
};

export default async function ContactPage() {
  const whatsappLive = await isFeatureEnabled('whatsapp_live');
  const whatsappNumber = await getWhatsAppNumber();
  const headerHeading = await getSectionContent('contact-header-heading', fallbackHeaderHeading);
  const headerDescription = await getSectionContent('contact-header-description', fallbackHeaderDescription);
  const headerQuote = await getSectionContent('contact-header-quote', fallbackHeaderQuote);
  const infoEmail = await getSectionContent('contact-info-email', fallbackInfoEmail);
  const infoLocation = await getSectionContent('contact-info-location', fallbackInfoLocation);
  const formConfig = await getSectionContent('contact-form-config', fallbackFormConfig);
  const formSubmit = await getSectionContent('contact-form-submit', fallbackFormSubmit);

  // Every row carries an href. These were inert <span>s: on the primary
  // contact page the email was not a mailto:, the WhatsApp number was not a
  // wa.me link, the location was not a map link, and the voice line was not
  // listed at all -- so a visitor on a phone could read the details but not
  // act on any of them. `tel:` in particular existed nowhere on the site;
  // ContactLinks.tsx builds one but is imported by nothing.
  const phone = siteConfig.links.contact.phone;
  const info: { label: string; value: string; href?: string }[] = [
    { ...infoEmail, href: infoEmail.value ? `mailto:${infoEmail.value}` : undefined },
    ...(phone
      ? [{ label: 'Phone', value: phone, href: `tel:${phone.replace(/[^\d+]/g, '')}` }]
      : []),
    ...(whatsappLive
      ? [{
          label: 'WhatsApp',
          value: formatWhatsAppNumber(whatsappNumber),
          href: whatsappNumber ? `https://wa.me/${whatsappNumber}` : undefined,
        }]
      : []),
    { ...infoLocation, href: siteConfig.links.contact.locationUrl || undefined },
  ].filter((i) => i.value);

  return (
    <div>
      <section className="mx-auto w-full max-w-[1200px] px-6 pb-16 pt-16 md:pt-20">
        <div className="grid items-start gap-12 lg:grid-cols-2 lg:gap-14">
          <div>
            <Eyebrow>Let&apos;s build</Eyebrow>
            <h1 className="mt-4 text-[clamp(2.5rem,5.5vw,3rem)] font-extrabold leading-[1.08] tracking-[-0.03em] text-ink">
              {headerHeading.text}
              <span className="text-saffron-ink">{headerHeading.highlight}</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-body">
              {headerDescription.text}
            </p>

            <div className="mt-8 flex flex-col gap-3.5">
              {info.map((item) => (
                <div key={item.label} className="flex items-center gap-3">
                  <span className="inline-flex items-center rounded-full border border-hairline bg-sand px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.06em] text-body">
                    {item.label}
                  </span>
                  {item.href ? (
                    <a
                      href={item.href}
                      className="font-mono text-sm text-body underline-offset-4 hover:text-saffron-ink hover:underline"
                      {...(item.href.startsWith('http')
                        ? { target: '_blank', rel: 'noopener noreferrer' }
                        : {})}
                    >
                      {item.value}
                    </a>
                  ) : (
                    <span className="font-mono text-sm text-body">{item.value}</span>
                  )}
                </div>
              ))}
            </div>

            <p className="mt-8 border-l-2 border-saffron-500 pl-4 text-sm italic text-muted">
              &ldquo;{headerQuote.text}&rdquo;
            </p>
          </div>

          <LeadForm config={formConfig} submitConfig={formSubmit} whatsappLive={whatsappLive} senderNumber={formatWhatsAppNumber(whatsappNumber)} />
        </div>
      </section>

      <CTASection />
    </div>
  );
}
