// Site identity. Placeholder values — the site-bootstrap skill fills these in.
// Legal identity (registered name, tax ids, address) lives in the database
// (company_profile, Admin > Settings > Company), not here.
export const siteConfig = {
  name: "YourSite",
  shortName: "YS",
  // Mirrors BRAND_TAGLINE in src/lib/brand.ts and --vb-tagline in tokens.css.
  tagline: "Your tagline goes here.",
  description:
    "YourSite — one sentence describing what you offer and who it is for.",
  url: "https://www.example.com",

  // Colours are NOT repeated here — docs/brand/tokens.css is the single source.
  // Only asset PATHS live here, for metadata and JSON-LD. Components render the
  // logo through <BrandLogo> / <BrandMark> in src/components/brand/.
  branding: {
    logo: {
      /** Header lockup on a light ground. */
      nav: "/brand/logo-primary-ivory.svg?v=4",
      /** Mark alone, 48 px and up. */
      mark: "/brand/mark-ivory.svg?v=4",
      /** Square/PNG for structured data and link previews (never SVG). */
      square: "/icon-512.png",
      og: "/opengraph-image.png",
    }
  },

  links: {
    social: {
      linkedin: "https://example.com/linkedin",
      youtube: "https://example.com/youtube",
      x: "https://example.com/x",
      instagram: "https://example.com/instagram",
      facebook: "https://example.com/facebook",
      telegram: "https://example.com/telegram",
    },
    contact: {
      email: "hello@example.com",
      // Voice line: footer, schema.org telephone and tel: links.
      phone: "+919000000000",
      // The WhatsApp Business number the webhook is subscribed to. Every
      // visitor-facing WhatsApp link derives from it. Whether WhatsApp entry
      // points show at all is the 'whatsapp_live' feature flag (/admin/settings).
      whatsapp: "+919000000000",
      telegram: "https://example.com/telegram",
      calendly: "https://example.com/book",
      locationLabel: "Your City",
      locationUrl: "https://example.com/map",
    },
    internal: {
      home: "/",
      services: "/services",
      about: "/about",
      blog: "/blog",
      templates: "/templates",
      contact: "/contact",
      app: "/admin",
    }
  },

  // Downloadable templates listed on /templates.
  templates: [
    {
      id: "starter-kit",
      title: "Starter Kit",
      description: "A sample paid template — replace with your own.",
      category: "Blueprint",
      tier: "premium",
      price: "$49",
      link: "/checkout/starter-kit"
    },
    {
      id: "free-checklist",
      title: "Free Checklist",
      description: "A sample free download — replace with your own.",
      category: "Git",
      tier: "free",
      link: "https://example.com/checklist"
    },
    {
      id: "pro-pack",
      title: "Pro Pack",
      description: "Another sample premium template.",
      category: "Premium Template",
      tier: "premium",
      price: "$99",
      link: "/checkout/pro-pack"
    }
  ],

  // Fallback copy used where the CMS has no content yet.
  content: {
    founder: {
      name: "Founder Name",
      title: "Founder",
      yearsExperience: "10+",
      highlights: [
        "A highlight of the founder's experience",
        "Another highlight",
        "A third highlight",
      ]
    },
    coreOffers: [
      "Sample service one",
      "Sample service two",
      "Sample service three",
      "Sample service four",
    ],
    episodes: {
      title: "Build notes",
      description: "Field notes from building the business.",
      sourcePath: "content/episodes/",
    },
    valueProp: "One paragraph on the problem you solve and why customers choose you."
  }
} as const;

export type SiteConfig = typeof siteConfig;
