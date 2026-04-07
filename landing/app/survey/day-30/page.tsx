import type { Metadata } from "next";
import SurveyForm, { type SurveyQuestion } from "../../../components/SurveyForm";

export const metadata: Metadata = {
  title: "AutoFlow Beta — 30-Day Review",
  description: "Share your 30-day experience with AutoFlow to help us improve.",
};

const questions: SurveyQuestion[] = [
  {
    key: "continue_likelihood",
    label: "How likely are you to continue using AutoFlow?",
    type: "nps",
    required: true,
  },
  {
    key: "completed_workflow",
    label: "Have you completed your first workflow?",
    type: "yes-no",
    required: true,
  },
  {
    key: "primary_use_case",
    label: "Which use case is your primary focus?",
    type: "dropdown",
    required: true,
    options: [
      "Form automation",
      "Email sequences",
      "Data sync",
      "Reporting",
      "Other",
    ],
  },
  {
    key: "onboarding_satisfaction",
    label: "On a scale of 1–5, how satisfied are you with the onboarding experience?",
    type: "scale-5",
    required: true,
  },
  {
    key: "build_next",
    label: "What would you like to build next with AutoFlow?",
    type: "text-long",
    required: false,
  },
  {
    key: "premium_interest",
    label: "Are you interested in exploring premium features or upgrading your plan?",
    type: "yes-no-maybe",
    required: false,
  },
];

export default function Day30SurveyPage() {
  return (
    <SurveyForm
      surveyId="day-30"
      title="AutoFlow Beta — 30-Day Review"
      subtitle="You've been using AutoFlow for a month. Help us understand your experience."
      estimatedTime="~3 min"
      questions={questions}
      confirmationMessage="Thank you! We'll use this to make AutoFlow even better."
    />
  );
}
