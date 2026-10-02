import { JSONSchemaType } from 'ajv';

// --- Shared Property Schemas ---

export const STYLE_SCHEMA = {
  type: "object",
  properties: {
    backgroundColor: { type: "string", pattern: "^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$", description: "Hex color code" },
    backgroundImage: { type: "string", format: "uri", description: "Background image URL" },
    backgroundOverlay: { type: "string", description: "CSS color with opacity, e.g. rgba(0,0,0,0.5)" },
    textColor: { type: "string", pattern: "^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$" },
    textAlign: { type: "string", enum: ["left", "center", "right"] },
    paddingTop: { type: "string", description: "CSS padding value, e.g. 4rem or 64px" },
    paddingBottom: { type: "string", description: "CSS padding value" },
    fontSize: { type: "string", description: "Base font size override for this region" }
  },
  additionalProperties: false
};

export const CTA_SCHEMA = {
  type: "object",
  required: ["label", "link"],
  properties: {
    label: { type: "string", maxLength: 40 },
    link: { type: "string", pattern: "^(/|https?://).*" },
    visible: { type: "boolean", default: true }
  },
  additionalProperties: false
};

export const HEADING_SCHEMA = {
  type: "object",
  required: ["text"],
  properties: {
    text: { type: "string", maxLength: 200 },
    highlight: { type: "string", maxLength: 100, description: "Part of the heading that gets accent color styling" }
  },
  additionalProperties: false
};

export const IMAGE_SCHEMA = {
  type: "object",
  required: ["src", "alt"],
  properties: {
    src: { type: "string", description: "Image URL or path" },
    alt: { type: "string", maxLength: 120 },
    width: { type: "integer", minimum: 1 },
    height: { type: "integer", minimum: 1 }
  },
  additionalProperties: false
};

// --- TypeScript Interfaces ---

export interface TextContent { text: string; }
export interface HeadingContent { text: string; highlight?: string; }
export interface CTAContent { label: string; link: string; visible?: boolean; }
export interface ImageContent { src: string; alt: string; width?: number; height?: number; }
export interface StyleContent {
  backgroundColor?: string;
  backgroundImage?: string;
  backgroundOverlay?: string;
  textColor?: string;
  textAlign?: "left" | "center" | "right";
  paddingTop?: string;
  paddingBottom?: string;
  fontSize?: string;
}

export interface ListContent { items: string[]; }
export interface DomainItem { category: string; clients: string; }
export interface DomainsContent { items: DomainItem[]; }
export interface MethodItem { title: string; description: string; iconType?: string; }
export interface MethodsContent { items: MethodItem[]; }
export interface WhyItem { title: string; description: string; iconType?: string; }
export interface WhyContent { items: WhyItem[]; }

export interface TemplateItem {
  id: string;
  title: string;
  description: string;
  category: string;
  tier: "free" | "premium";
  price?: string;
  link: string;
}
export interface TemplateGridContent { items: TemplateItem[]; }

export type SectionContent = any; 

// --- Granular Schema Definitions ---

export const CONTENT_SCHEMAS: Record<string, { description: string; schema: any }> = {
  // --- GLOBAL SECTIONS ---
  "global-header-logo-nav": {
    description: "Main wordmark logo used in the header for desktop",
    schema: IMAGE_SCHEMA
  },
  "global-header-logo-mark": {
    description: "Icon-only logo mark used in the header for mobile",
    schema: IMAGE_SCHEMA
  },
  "global-header-nav": {
    description: "Main navigation links in the header",
    schema: {
      type: "object",
      required: ["items"],
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            required: ["label", "href"],
            properties: {
              label: { type: "string", maxLength: 40 },
              href: { type: "string", pattern: "^(/|https?://).*" },
              icon: { type: "string", description: "Tabler icon name, e.g. IconHome" }
            },
            additionalProperties: false
          }
        }
      },
      additionalProperties: false
    }
  },
  "global-footer-links": {
    description: "Columns of links in the footer",
    schema: {
      type: "object",
      required: ["columns"],
      properties: {
        columns: {
          type: "array",
          items: {
            type: "object",
            required: ["title", "links"],
            properties: {
              title: { type: "string", maxLength: 40 },
              links: {
                type: "array",
                items: {
                  type: "object",
                  required: ["label", "href"],
                  properties: {
                    label: { type: "string", maxLength: 40 },
                    href: { type: "string", pattern: "^(/|https?://).*" }
                  },
                  additionalProperties: false
                }
              }
            },
            additionalProperties: false
          }
        }
      },
      additionalProperties: false
    }
  },
  "global-footer-social": {
    description: "Social media links configuration",
    schema: {
      type: "object",
      required: ["items"],
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            required: ["platform", "href"],
            properties: {
              platform: { type: "string", maxLength: 40 },
              href: { type: "string", pattern: "^(https?://).*" },
              iconKey: { type: "string", description: "SimpleIcon key, e.g. siX" },
              assetSrc: { type: "string", description: "Optional local asset path" },
              assetDarkSrc: { type: "string", description: "Optional dark-mode local asset path" },
              forceColor: { type: "string", description: "Hex color code" },
              badgeClass: { type: "string" }
            },
            additionalProperties: false
          }
        }
      },
      additionalProperties: false
    }
  },
  "global-footer-copyright": {
    description: "Copyright text displayed in the footer",
    schema: { type: "object", required: ["text"], properties: { text: { type: "string", maxLength: 100 } }, additionalProperties: false }
  },
  "cta-global-config": {
    description: "Default configuration for the shared CTA section component",
    schema: {
      type: "object",
      required: ["title", "description"],
      properties: {
        title: { type: "string", maxLength: 200 },
        description: { type: "string", maxLength: 600 },
        primaryLabel: { type: "string", maxLength: 40 },
        primaryHref: { type: "string", pattern: "^(/|https?://).*" },
        secondaryLabel: { type: "string", maxLength: 40 },
        secondaryHref: { type: "string", pattern: "^(/|https?://).*" }
      },
      additionalProperties: false
    }
  },

  // --- HOME PAGE SECTIONS ---
  "home-hero-tagline": {
    description: "Small uppercase tagline above the main hero heading",
    schema: { type: "object", required: ["text"], properties: { text: { type: "string", maxLength: 80 } }, additionalProperties: false }
  },
  "home-hero-heading": {
    description: "Main H1 headline on the home page hero",
    schema: HEADING_SCHEMA
  },
  "home-hero-description": {
    description: "Main descriptive paragraph in the home hero",
    schema: { type: "object", required: ["text"], properties: { text: { type: "string", maxLength: 500 } }, additionalProperties: false }
  },
  "home-hero-cta-primary": {
    description: "Primary call-to-action button in the home hero",
    schema: CTA_SCHEMA
  },
  "home-hero-cta-secondary": {
    description: "Secondary call-to-action button in the home hero",
    schema: CTA_SCHEMA
  },
  "home-hero-style": {
    description: "Visual styling for the home hero region",
    schema: STYLE_SCHEMA
  },
  "home-insights-heading": {
    description: "Title for the blog/insights carousel section",
    schema: { type: "object", required: ["text"], properties: { text: { type: "string", maxLength: 100 } }, additionalProperties: false }
  },
  "home-insights-subtitle": {
    description: "Subtitle for the blog/insights carousel section",
    schema: { type: "object", required: ["text"], properties: { text: { type: "string", maxLength: 200 } }, additionalProperties: false }
  },
  "home-insights-style": {
    description: "Visual styling for the home insights region",
    schema: STYLE_SCHEMA
  },
  "home-expertise-heading": {
    description: "Title for the 'What we build' expertise section",
    schema: { type: "object", required: ["text"], properties: { text: { type: "string", maxLength: 100 } }, additionalProperties: false }
  },
  "home-expertise-subtitle": {
    description: "Subtitle for the expertise section",
    schema: { type: "object", required: ["text"], properties: { text: { type: "string", maxLength: 200 } }, additionalProperties: false }
  },
  "home-expertise-items": {
    description: "List of core service offerings shown in the grid",
    schema: {
      type: "object",
      required: ["items"],
      properties: { items: { type: "array", items: { type: "string", maxLength: 80 } } },
      additionalProperties: false
    }
  },
  "home-expertise-style": {
    description: "Visual styling for the home expertise region",
    schema: STYLE_SCHEMA
  },
  "home-why-heading": {
    description: "Title for the 'Why YourSite' section",
    schema: { type: "object", required: ["text"], properties: { text: { type: "string", maxLength: 100 } }, additionalProperties: false }
  },
  "home-why-value-prop": {
    description: "The italicized value proposition quote in the Why section",
    schema: { type: "object", required: ["text"], properties: { text: { type: "string", maxLength: 300 } }, additionalProperties: false }
  },
  "home-why-items": {
    description: "Key features/benefits in the Why section",
    schema: {
      type: "object",
      required: ["items"],
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            required: ["title", "description"],
            properties: {
              title: { type: "string", maxLength: 100 },
              description: { type: "string", maxLength: 400 },
              iconType: { type: "string", enum: ["check", "bolt", "shield"] }
            },
            additionalProperties: false
          }
        }
      },
      additionalProperties: false
    }
  },
  "home-why-style": {
    description: "Visual styling for the home 'Why' region",
    schema: STYLE_SCHEMA
  },
  "home-pedigree-heading": {
    description: "Title for the founder's pedigree/experience section",
    schema: { type: "object", required: ["text"], properties: { text: { type: "string", maxLength: 100 } }, additionalProperties: false }
  },
  "home-pedigree-description": {
    description: "Detailed description of company heritage and client history",
    schema: { type: "object", required: ["text"], properties: { text: { type: "string", maxLength: 1000 } }, additionalProperties: false }
  },
  "home-pedigree-marquee": {
    description: "List of company names for the scrolling marquee",
    schema: {
      type: "object",
      required: ["items"],
      properties: { items: { type: "array", items: { type: "string", maxLength: 50 } } },
      additionalProperties: false
    }
  },

  // --- HOME PAGE: LIVE-SITE SECTIONS (Product / Platform / Research / Philosophy / CTA) ---
  "home-product-heading": {
    description: "Centered heading for the 'What we build' product section",
    schema: { type: "object", required: ["text"], properties: { text: { type: "string", maxLength: 120 } }, additionalProperties: false }
  },
  "home-product-subtitle": {
    description: "Sub-line under the product section heading",
    schema: { type: "object", required: ["text"], properties: { text: { type: "string", maxLength: 240 } }, additionalProperties: false }
  },
  "home-product-cards": {
    description: "The six numbered product capability cards (title + short description)",
    schema: {
      type: "object",
      required: ["items"],
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            required: ["title", "description"],
            properties: {
              title: { type: "string", maxLength: 80 },
              description: { type: "string", maxLength: 200 }
            },
            additionalProperties: false
          }
        }
      },
      additionalProperties: false
    }
  },
  "home-platform-eyebrow": {
    description: "Eyebrow label for the Platform / our lab section",
    schema: { type: "object", required: ["text"], properties: { text: { type: "string", maxLength: 60 } }, additionalProperties: false }
  },
  "home-platform-heading": {
    description: "Heading for the Platform section (use \\n for a line break)",
    schema: { type: "object", required: ["text"], properties: { text: { type: "string", maxLength: 160 } }, additionalProperties: false }
  },
  "home-platform-description": {
    description: "Descriptive paragraph for the Platform / VVC section",
    schema: { type: "object", required: ["text"], properties: { text: { type: "string", maxLength: 600 } }, additionalProperties: false }
  },
  "home-platform-cta-primary": {
    description: "Primary CTA button in the Platform section",
    schema: CTA_SCHEMA
  },
  "home-platform-cta-secondary": {
    description: "Secondary CTA button in the Platform section",
    schema: CTA_SCHEMA
  },
  "home-platform-cards": {
    description: "The four VVC capability cards (title + short description)",
    schema: {
      type: "object",
      required: ["items"],
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            required: ["title", "description"],
            properties: {
              title: { type: "string", maxLength: 80 },
              description: { type: "string", maxLength: 200 }
            },
            additionalProperties: false
          }
        }
      },
      additionalProperties: false
    }
  },
  "home-research-eyebrow": {
    description: "Eyebrow label for the Research / Growth metrics section",
    schema: { type: "object", required: ["text"], properties: { text: { type: "string", maxLength: 60 } }, additionalProperties: false }
  },
  "home-research-heading": {
    description: "Heading for the Research / metrics section",
    schema: { type: "object", required: ["text"], properties: { text: { type: "string", maxLength: 120 } }, additionalProperties: false }
  },
  "home-research-metrics": {
    description: "The four headline metrics (value + label)",
    schema: {
      type: "object",
      required: ["items"],
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            required: ["value", "label"],
            properties: {
              value: { type: "string", maxLength: 12 },
              label: { type: "string", maxLength: 80 }
            },
            additionalProperties: false
          }
        }
      },
      additionalProperties: false
    }
  },
  "home-research-lineage": {
    description: "The mono trusted-lineage line under the metrics",
    schema: { type: "object", required: ["text"], properties: { text: { type: "string", maxLength: 300 } }, additionalProperties: false }
  },
  "home-philosophy-eyebrow": {
    description: "Eyebrow label for the Philosophy / One team section",
    schema: { type: "object", required: ["text"], properties: { text: { type: "string", maxLength: 60 } }, additionalProperties: false }
  },
  "home-philosophy-deva": {
    description: "The large Devanagari phrase (use \\n for a line break)",
    schema: { type: "object", required: ["text"], properties: { text: { type: "string", maxLength: 80 } }, additionalProperties: false }
  },
  "home-philosophy-title": {
    description: "The bold philosophy statement; 'highlight' is rendered in saffron before the text",
    schema: HEADING_SCHEMA
  },
  "home-philosophy-body": {
    description: "Supporting paragraph for the Philosophy section",
    schema: { type: "object", required: ["text"], properties: { text: { type: "string", maxLength: 600 } }, additionalProperties: false }
  },
  "home-philosophy-cta": {
    description: "CTA link in the Philosophy section",
    schema: CTA_SCHEMA
  },
  "home-cta-title": {
    description: "Heading for the closing call-to-action band",
    schema: { type: "object", required: ["text"], properties: { text: { type: "string", maxLength: 120 } }, additionalProperties: false }
  },
  "home-cta-description": {
    description: "Sub-line for the closing call-to-action band",
    schema: { type: "object", required: ["text"], properties: { text: { type: "string", maxLength: 240 } }, additionalProperties: false }
  },
  "home-cta-primary": {
    description: "Primary CTA button in the closing band",
    schema: CTA_SCHEMA
  },
  "home-cta-secondary": {
    description: "Secondary CTA button in the closing band",
    schema: CTA_SCHEMA
  },

  // --- ABOUT PAGE SECTIONS ---
  "about-header-heading": {
    description: "Main headline on the about page header",
    schema: HEADING_SCHEMA
  },
  "about-header-description": {
    description: "Main description on the about page header",
    schema: { type: "object", required: ["text"], properties: { text: { type: "string", maxLength: 600 } }, additionalProperties: false }
  },
  "about-header-founder": {
    description: "Founder profile information and link",
    schema: {
      type: "object",
      required: ["initials", "name", "role", "link"],
      properties: {
        initials: { type: "string", maxLength: 5 },
        name: { type: "string", maxLength: 100 },
        role: { type: "string", maxLength: 100 },
        link: { type: "string", pattern: "^https?://.*" }
      },
      additionalProperties: false
    }
  },
  "about-header-style": {
    description: "Visual styling for the about header region",
    schema: STYLE_SCHEMA
  },
  "about-pedigree-title": {
    description: "Headline for the pedigree section on about page",
    schema: { type: "object", required: ["text"], properties: { text: { type: "string", maxLength: 300 } }, additionalProperties: false }
  },
  "about-pedigree-description": {
    description: "Supporting text for the pedigree section",
    schema: { type: "object", required: ["text"], properties: { text: { type: "string", maxLength: 600 } }, additionalProperties: false }
  },
  "about-pedigree-companies": {
    description: "List of top-tier integrators/companies the founder worked with",
    schema: {
      type: "object",
      required: ["items"],
      properties: { items: { type: "array", items: { type: "string", maxLength: 50 } } },
      additionalProperties: false
    }
  },
  "about-pedigree-domains": {
    description: "Grid of industry domains and specific clients",
    schema: {
      type: "object",
      required: ["items"],
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            required: ["category", "clients"],
            properties: {
              category: { type: "string", maxLength: 100 },
              clients: { type: "string", maxLength: 300 }
            },
            additionalProperties: false
          }
        }
      },
      additionalProperties: false
    }
  },
  "about-pedigree-style": {
    description: "Visual styling for the about pedigree region",
    schema: STYLE_SCHEMA
  },
  "about-methodologies-items": {
    description: "Core methodologies/frameworks cards",
    schema: {
      type: "object",
      required: ["items"],
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            required: ["title", "description"],
            properties: {
              title: { type: "string", maxLength: 100 },
              description: { type: "string", maxLength: 1200 },
              iconType: { type: "string", enum: ["governance", "vvc"] }
            },
            additionalProperties: false
          }
        }
      },
      additionalProperties: false
    }
  },
  "about-methodologies-style": {
    description: "Visual styling for the about methodologies region",
    schema: STYLE_SCHEMA
  },

  // --- SERVICES PAGE SECTIONS ---
  "services-header-title": {
    description: "Main title on the services page",
    schema: { type: "object", required: ["text"], properties: { text: { type: "string", maxLength: 150 } }, additionalProperties: false }
  },
  "services-header-description": {
    description: "Main description on the services page",
    schema: { type: "object", required: ["text"], properties: { text: { type: "string", maxLength: 600 } }, additionalProperties: false }
  },
  "services-header-style": {
    description: "Visual styling for the services header region",
    schema: STYLE_SCHEMA
  },
  "services-expertise-items": {
    description: "List of expertise offerings shown in the grid on services page",
    schema: {
      type: "object",
      required: ["items"],
      properties: { items: { type: "array", items: { type: "string", maxLength: 100 } } },
      additionalProperties: false
    }
  },
  "services-segments-enterprise": {
    description: "Enterprise segment offering details",
    schema: {
      type: "object",
      required: ["title", "points"],
      properties: {
        title: { type: "string", maxLength: 100 },
        points: { type: "array", items: { type: "string", maxLength: 200 } }
      },
      additionalProperties: false
    }
  },
  "services-segments-founders": {
    description: "Founder/Startup segment offering details",
    schema: {
      type: "object",
      required: ["title", "points"],
      properties: {
        title: { type: "string", maxLength: 100 },
        points: { type: "array", items: { type: "string", maxLength: 200 } }
      },
      additionalProperties: false
    }
  },
  "services-segments-style": {
    description: "Visual styling for the services segments region",
    schema: STYLE_SCHEMA
  },

  // --- CONTACT PAGE SECTIONS ---
  "contact-header-heading": {
    description: "Main headline on the contact page",
    schema: HEADING_SCHEMA
  },
  "contact-header-description": {
    description: "Supporting text on the contact page header",
    schema: { type: "object", required: ["text"], properties: { text: { type: "string", maxLength: 600 } }, additionalProperties: false }
  },
  "contact-header-style": {
    description: "Visual styling for the contact header region",
    schema: STYLE_SCHEMA
  },
  "contact-header-quote": {
    description: "The italicized quote at the bottom of contact info",
    schema: { type: "object", required: ["text"], properties: { text: { type: "string", maxLength: 200 } }, additionalProperties: false }
  },
  "contact-info-email": {
    description: "Email address display configuration",
    schema: { type: "object", required: ["label", "value"], properties: { label: { type: "string" }, value: { type: "string" } }, additionalProperties: false }
  },
  "contact-info-location": {
    description: "Location/Hub display configuration",
    schema: { type: "object", required: ["label", "value"], properties: { label: { type: "string" }, value: { type: "string" } }, additionalProperties: false }
  },
  "contact-form-config": {
    description: "Configuration for the lead capture form heading and intro",
    schema: {
      type: "object",
      required: ["title", "description"],
      properties: {
        title: { type: "string", maxLength: 100 },
        description: { type: "string", maxLength: 300 }
      },
      additionalProperties: false
    }
  },
  "contact-form-submit": {
    description: "Configuration for the form submit button and success messages",
    schema: {
      type: "object",
      required: ["label", "successTitle", "successMessage"],
      properties: {
        label: { type: "string", maxLength: 40 },
        successTitle: { type: "string", maxLength: 80 },
        successMessage: { type: "string", maxLength: 400 }
      },
      additionalProperties: false
    }
  },

  // --- BLOG PAGE SECTIONS ---
  "blog-header-title": {
    description: "Main title for the blog list page",
    schema: { type: "object", required: ["text"], properties: { text: { type: "string", maxLength: 150 } }, additionalProperties: false }
  },
  "blog-header-subtitle": {
    description: "Supporting description for the blog list page",
    schema: { type: "object", required: ["text"], properties: { text: { type: "string", maxLength: 400 } }, additionalProperties: false }
  },
  "blog-header-style": {
    description: "Visual styling for the blog header region",
    schema: STYLE_SCHEMA
  },

  // --- TEMPLATES PAGE SECTIONS ---
  "template-header-title": {
    description: "Main headline on the templates page",
    schema: HEADING_SCHEMA
  },
  "template-header-subtitle": {
    description: "Supporting description for the templates page",
    schema: { type: "object", required: ["text"], properties: { text: { type: "string", maxLength: 400 } }, additionalProperties: false }
  },
  "template-header-style": {
    description: "Visual styling for the template header region",
    schema: STYLE_SCHEMA
  },
  "template-grid-items": {
    description: "Grid of architecture and engineering templates",
    schema: {
      type: "object",
      required: ["items"],
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "title", "description", "category", "tier", "link"],
            properties: {
              id: { type: "string" },
              title: { type: "string", maxLength: 100 },
              description: { type: "string", maxLength: 300 },
              category: { type: "string" },
              tier: { type: "string", enum: ["free", "premium"] },
              price: { type: "string" },
              link: { type: "string" }
            },
            additionalProperties: false
          }
        }
      },
      additionalProperties: false
    }
  }
};
