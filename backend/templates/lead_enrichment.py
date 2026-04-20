"""
Template: Lead Enrichment

Accepts an inbound lead, enriches it with company firmographic data,
scores the lead against ICP criteria, and pushes qualified leads to a CRM.
"""

from .schemas import (
    ConfigField,
    FieldType,
    StepKind,
    TemplateCategory,
    WorkflowStep,
    WorkflowTemplate,
)

lead_enrichment = WorkflowTemplate(
    id="tpl-lead-enrich",
    name="Lead Enrichment",
    description=(
        "Enriches incoming leads with company data, scores them against your "
        "ideal customer profile, and syncs qualified leads to your CRM."
    ),
    category=TemplateCategory.sales,
    version="1.0.0",
    config_fields=[
        ConfigField(
            key="scoreThreshold",
            label="Minimum Lead Score",
            type=FieldType.number,
            required=True,
            default_value=70,
            description="Leads scoring at or above this value are synced to the CRM.",
        ),
        ConfigField(
            key="crmTarget",
            label="CRM Target",
            type=FieldType.string,
            required=True,
            options=["salesforce", "hubspot", "pipedrive"],
            description="CRM system to receive qualified leads.",
        ),
        ConfigField(
            key="icpDescription",
            label="Ideal Customer Profile",
            type=FieldType.string,
            required=False,
            default_value="B2B SaaS companies with 50–500 employees",
            description=(
                "Free-text description of your ideal customer used by the "
                "LLM scoring step."
            ),
        ),
    ],
    steps=[
        WorkflowStep(
            id="step_trigger",
            name="New Lead",
            kind=StepKind.trigger,
            description="Lead captured from a web form, inbound API, or ad platform.",
            input_keys=[],
            output_keys=["email", "name", "company"],
        ),
        WorkflowStep(
            id="step_enrich",
            name="Enrich Lead",
            kind=StepKind.transform,
            description=(
                "Looks up firmographic data for the company: headcount, revenue, "
                "industry, and technology stack."
            ),
            input_keys=["company", "email"],
            output_keys=["employees", "revenue", "industry", "techStack", "linkedinUrl"],
            action="enrichment.lookup",
        ),
        WorkflowStep(
            id="step_score",
            name="Score Lead",
            kind=StepKind.llm,
            description=(
                "Uses the LLM to evaluate how well the lead matches the ICP "
                "and assigns a 0–100 fit score."
            ),
            input_keys=["icpDescription", "employees", "revenue", "industry", "techStack"],
            output_keys=["leadScore", "fitReason"],
            prompt_template=(
                "You are a B2B sales qualification assistant.\n\n"
                "Ideal Customer Profile: {{icpDescription}}\n\n"
                "Lead details:\n"
                "- Industry: {{industry}}\n"
                "- Employees: {{employees}}\n"
                "- Revenue: {{revenue}}\n"
                "- Tech stack: {{techStack}}\n\n"
                "Score this lead from 0 to 100 based on how well it matches the ICP. "
                "Respond with a JSON object:\n"
                "- leadScore: integer 0-100\n"
                "- fitReason: one-sentence explanation of the score\n\n"
                "Respond ONLY with the JSON object."
            ),
        ),
        WorkflowStep(
            id="step_qualify",
            name="Qualify",
            kind=StepKind.condition,
            description=(
                "Passes only leads whose score meets or exceeds the configured "
                "threshold."
            ),
            input_keys=["leadScore"],
            output_keys=["qualified"],
            condition="leadScore >= scoreThreshold",
        ),
        WorkflowStep(
            id="step_crm_sync",
            name="Sync to CRM",
            kind=StepKind.action,
            description=(
                "Upserts the qualified lead record in the target CRM with "
                "enriched data and fit score."
            ),
            input_keys=[
                "name",
                "email",
                "company",
                "industry",
                "employees",
                "revenue",
                "leadScore",
                "fitReason",
                "linkedinUrl",
            ],
            output_keys=["crmId", "crmUrl"],
            action="crm.upsertLead",
        ),
        WorkflowStep(
            id="step_output",
            name="Done",
            kind=StepKind.output,
            description="Records the qualification outcome for analytics.",
            input_keys=["email", "leadScore", "qualified", "crmId"],
            output_keys=["event"],
            action="events.emit",
        ),
    ],
    sample_input={
        "email": "cto@acmecorp.com",
        "name": "Jane Smith",
        "company": "Acme Corp",
    },
    expected_output={
        "leadScore": 85,
        "qualified": True,
        "crmId": "lead_928",
        "fitReason": "Mid-market B2B SaaS company that matches ICP criteria.",
        "event": {"type": "lead.qualified"},
    },
)
