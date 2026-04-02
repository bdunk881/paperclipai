import React, { createContext, useContext, useState, useCallback } from "react";

export type OnboardingStep = "welcome" | "templates" | "configure" | "success";

export interface OnboardingState {
  completed: boolean;
  step: OnboardingStep;
  selectedTemplateId?: string;
  configValues?: Record<string, unknown>;
  lastRunId?: string;
}

interface OnboardingContextValue {
  state: OnboardingState;
  setStep: (step: OnboardingStep) => void;
  selectTemplate: (templateId: string) => void;
  setConfigValues: (values: Record<string, unknown>) => void;
  setLastRunId: (runId: string) => void;
  completeOnboarding: () => void;
  resetOnboarding: () => void;
}

const STORAGE_KEY = "autoflow_onboarding";

function loadState(): OnboardingState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as OnboardingState;
  } catch {
    // ignore corrupt storage
  }
  return { completed: false, step: "welcome" };
}

function saveState(state: OnboardingState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore storage errors
  }
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<OnboardingState>(loadState);

  const update = useCallback((patch: Partial<OnboardingState>) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      saveState(next);
      return next;
    });
  }, []);

  const setStep = useCallback((step: OnboardingStep) => update({ step }), [update]);

  const selectTemplate = useCallback(
    (selectedTemplateId: string) => update({ selectedTemplateId, step: "configure" }),
    [update]
  );

  const setConfigValues = useCallback(
    (configValues: Record<string, unknown>) => update({ configValues }),
    [update]
  );

  const setLastRunId = useCallback(
    (lastRunId: string) => update({ lastRunId, step: "success" }),
    [update]
  );

  const completeOnboarding = useCallback(() => update({ completed: true }), [update]);

  const resetOnboarding = useCallback(
    () =>
      setState(() => {
        const fresh: OnboardingState = { completed: false, step: "welcome" };
        saveState(fresh);
        return fresh;
      }),
    []
  );

  return (
    <OnboardingContext.Provider
      value={{
        state,
        setStep,
        selectTemplate,
        setConfigValues,
        setLastRunId,
        completeOnboarding,
        resetOnboarding,
      }}
    >
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding(): OnboardingContextValue {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error("useOnboarding must be used within OnboardingProvider");
  return ctx;
}
