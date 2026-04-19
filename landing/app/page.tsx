import { Hero } from "@/components/sections/Hero";
import { ProblemSolution } from "@/components/sections/ProblemSolution";
import { HowItWorks } from "@/components/sections/HowItWorks";
import { Features } from "@/components/sections/Features";
import type { Feature } from "@/components/sections/Features";
import { BringYourLLM } from "@/components/sections/BringYourLLM";
import { Pricing } from "@/components/sections/Pricing";
import { ROICalculator } from "@/components/sections/ROICalculator";
import { CompetitorComparison } from "@/components/sections/CompetitorComparison";
import { SocialProof } from "@/components/sections/SocialProof";
import type { Testimonial } from "@/components/sections/SocialProof";
import { FAQ } from "@/components/sections/FAQ";
import type { FaqItem } from "@/components/sections/FAQ";
import { FinalCTA } from "@/components/sections/FinalCTA";
import { getTestimonials, getFeatures, getFaqItems } from "@/lib/sanity";

export default async function LandingPage() {
  const [cmsTestimonials, cmsFeatures, cmsFaqItems] = await Promise.all([
    getTestimonials(),
    getFeatures(),
    getFaqItems(),
  ]);

  const testimonials: Testimonial[] | undefined = cmsTestimonials
    ? cmsTestimonials.map((t) => ({
        quote: t.quote,
        author: t.authorName,
        title: t.authorTitle,
        initials: t.authorName
          .split(" ")
          .map((n) => n[0])
          .join("")
          .toUpperCase(),
      }))
    : undefined;

  const features: Feature[] | undefined = cmsFeatures
    ? cmsFeatures.map((f) => ({
        title: f.title,
        description: f.description,
        icon: f.icon ?? "",
      }))
    : undefined;

  const faqItems: FaqItem[] | undefined = cmsFaqItems
    ? cmsFaqItems.map((f) => ({
        question: f.question,
        answer: f.answer,
      }))
    : undefined;

  return (
    <main>
      <Hero />
      <ProblemSolution />
      <HowItWorks />
      <Features features={features} />
      <BringYourLLM />
      <Pricing />
      <ROICalculator />
      <CompetitorComparison />
      <SocialProof testimonials={testimonials} />
      <FAQ items={faqItems} />
      <FinalCTA />
    </main>
  );
}
