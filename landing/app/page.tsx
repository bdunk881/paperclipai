import { Hero } from "@/components/sections/Hero";
import { ProblemSolution } from "@/components/sections/ProblemSolution";
import { HowItWorks } from "@/components/sections/HowItWorks";
import { Features } from "@/components/sections/Features";
import { BringYourLLM } from "@/components/sections/BringYourLLM";
import { Pricing } from "@/components/sections/Pricing";
import { SocialProof } from "@/components/sections/SocialProof";
import { FAQ } from "@/components/sections/FAQ";
import { BetaSignup } from "@/components/sections/BetaSignup";
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
      <SocialProof />
      <BetaSignup />
      <FAQ />
      <FinalCTA />
    </main>
  );
}
