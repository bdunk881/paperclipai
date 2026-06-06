import { heroSchema } from "./schemas/hero";
import { featureSchema } from "./schemas/features";
import { navigationSchema } from "./schemas/navigation";
import { pitchSchema } from "./schemas/pitch";
import { sectionIntroSchema } from "./schemas/sectionIntro";
import { finalCtaSchema } from "./schemas/finalCta";
import { footerSchema } from "./schemas/footer";
import { landingMetaSchema } from "./schemas/landingMeta";
import { pricingSchema } from "./schemas/pricing";
import { creditPackSchema } from "./schemas/creditPack";
import { testimonialSchema } from "./schemas/testimonials";
import { faqSchema } from "./schemas/faq";
import { blogPostSchema } from "./schemas/blogPost";
import { seoSchema } from "./schemas/objects/seo";
import { blogFaqSchema } from "./schemas/objects/blogFaq";
import { authorSchema } from "./schemas/author";
import { categorySchema } from "./schemas/category";
import { redirectSchema } from "./schemas/redirect";
import { siteSettingsSchema } from "./schemas/siteSettings";

export const schemaTypes = [
  // objects (referenced by documents below)
  seoSchema,
  blogFaqSchema,
  // documents
  heroSchema,
  featureSchema,
  navigationSchema,
  pitchSchema,
  sectionIntroSchema,
  finalCtaSchema,
  footerSchema,
  landingMetaSchema,
  pricingSchema,
  creditPackSchema,
  testimonialSchema,
  faqSchema,
  authorSchema,
  categorySchema,
  blogPostSchema,
  redirectSchema,
  siteSettingsSchema,
];
