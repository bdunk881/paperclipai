import { MfaSettingsCard } from "./security/MfaSettingsCard";

export function SettingsPage() {
  return (
    <>
      <h1 style={{ fontSize: "1.3rem", marginBottom: "1rem" }}>Settings</h1>
      <MfaSettingsCard />
    </>
  );
}
