import type { Metadata } from "next";
import SurveyForm, { type SurveyQuestion } from "../../../components/SurveyForm";

export const metadata: Metadata = {
  title: "AutoFlow Beta — Week 1 Feedback",
  description: "Share your experience after your first week with AutoFlow.",
};

const questions: SurveyQuestion[] = [
  {
    key: "nps",
    label: "How likely are you to recommend AutoFlow to a colleague?",
    type: "nps",
    required: true,
  },
  {
    key: "biggest_challenge",
    label: "What is the biggest challenge you've faced in your first week?",
    type: "text-long",
    required: true,
  },
  {
    key: "most_valuable_feature",
    label: "Which feature has been most valuable to you so far?",
    type: "text-short",
    required: true,
  },
  {
    key: "wished_feature",
    label: "Is there a feature you wish AutoFlow had?",
    type: "text-short",
    required: false,
  },
];

export default function Day7SurveyPage() {
  return (
    <SurveyForm
      surveyId="day-7"
      title="AutoFlow Beta — Week 1 Feedback"
      subtitle="Help us improve AutoFlow by sharing your experience after your first week."
      estimatedTime="~2 min"
      questions={questions}
      confirmationMessage="Thanks for your feedback! Your input directly shapes AutoFlow."
    />
  );
}
