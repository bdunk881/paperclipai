import { Hero } from "@/components/sections/Hero";
import { ProblemSolution } from "@/components/sections/ProblemSolution";
import { HowItWorks } from "@/components/sections/HowItWorks";
import { Features } from "@/components/sections/Features";
import { BringYourLLM } from "@/components/sections/BringYourLLM";
import { Pricing } from "@/components/sections/Pricing";
import { ROICalculator } from "@/components/sections/ROICalculator";
import { CompetitorComparison } from "@/components/sections/CompetitorComparison";
import { SocialProof } from "@/components/sections/SocialProof";
import { FAQ } from "@/components/sections/FAQ";
import { FinalCTA } from "@/components/sections/FinalCTA";

export default function LandingPage() {
  return (
    <main>
      <Hero />
      <ProblemSolution />
      <HowItWorks />
      <Features />
      <BringYourLLM />
      <Pricing />
      <ROICalculator />
      <CompetitorComparison />
      <SocialProof />
      <FAQ />
      <FinalCTA />
    </main>
  );
}
