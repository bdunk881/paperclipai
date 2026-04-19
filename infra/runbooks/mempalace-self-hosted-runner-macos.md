MemPalace Self-Hosted GitHub Actions Runner (macOS)

Purpose
- Register a macOS machine as a self-hosted runner for the repository bdunk881/autoflow-brand to enable the sync-mempalace workflow to access the local MemPalace ChromaDB store.

Prerequisites
- macOS runner host with network access to github.com and the ability to install services.
- GitHub token with repo scope available to register the runner (token will be used by the registration script).
- Access to the MemPalace store on the runner host (MEMPALACE_PALACE path) and the mempalace-store CLI installed if needed by the workflow.

Labeling
- The runner should be labeled self-hosted to match the workflow target (runs-on: self-hosted).

Registration steps (manual - as executed on the runner host)
- Go to bdunk881/autoflow-brand → Settings → Actions → Runners → New self-hosted runner → macOS.
- Copy the registration commands shown by GitHub and execute on the macOS host.
- Ensure the runner has access to the MemPalace store location and that mempalace-store CLI is available to the workflow.

Automation considerations
- Use the script infra/scripts/setup-self-hosted-runner-macos.sh to bootstrap the runner on a macOS host with environment variables provided (GH_TOKEN, REPO_URL, RUNNER_NAME, RUNNER_TARBALL_URL).
- After provisioning, verify that the runner appears online in GitHub under the repository's Runners page and that the sync-mempalace workflow can run on runs-on: self-hosted.

Security and operations
- Rotate the GitHub registration token as per org policy after provisioning a new runner.
- Monitor the runner's status; ensure it reports online and completes the MemPalace sync tasks as expected.
- If the runner is decommissioned, remove it from GitHub and shut down the service on the host.

Validation plan
- Trigger a test run of the sync-mempalace workflow and confirm it uses the local MemPalace store without errors.
- Confirm that MemPalace store access (MEMPALACE_PALACE path and mempalace-store CLI) works from the runner environment.

Owner and history
- This runbook is owned by DevOps/Infra. Capture changes in this ticket and attach relevant patch/script artifacts once available.
