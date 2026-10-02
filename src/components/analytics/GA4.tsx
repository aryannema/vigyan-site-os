export default function GA4() {
  const ga4Id = process.env.NEXT_PUBLIC_GA4_ID;

  if (!ga4Id) {
    return null;
  }

  return (
    <>
      <script async src={`https://www.googletagmanager.com/gtag/js?id=${ga4Id}`} />
      <script
        dangerouslySetInnerHTML={{
          __html: `window.dataLayer = window.dataLayer || [];\nfunction gtag(){dataLayer.push(arguments);}\ngtag('js', new Date());\ngtag('config', '${ga4Id}');`,
        }}
      />
    </>
  );
}
