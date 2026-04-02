"""
Template: Invoice / PO Data Extraction

Parses invoice or purchase-order documents (PDF attachments or email bodies),
extracts structured fields using the LLM, validates totals, and routes the
record to an accounting system.
"""

from .schemas import (
    ConfigField,
    FieldType,
    StepKind,
    TemplateCategory,
    WorkflowStep,
    WorkflowTemplate,
)

invoice_extractor = WorkflowTemplate(
    id="tpl-invoice-extractor",
    name="Invoice / PO Data Extraction",
    description=(
        "Parses incoming invoices and purchase orders, extracts structured "
        "fields with the LLM, validates line-item totals, and pushes the "
        "record to your accounting system."
    ),
    category=TemplateCategory.custom,
    version="1.0.0",
    configFields=[
        ConfigField(
            key="accountingSystem",
            label="Accounting System",
            type=FieldType.string,
            required=True,
            options=["quickbooks", "xero", "netsuite", "sage"],
            description="Target accounting system to receive extracted records.",
        ),
        ConfigField(
            key="defaultCurrency",
            label="Default Currency",
            type=FieldType.string,
            required=False,
            defaultValue="USD",
            description="Currency assumed when none is detected in the document.",
        ),
        ConfigField(
            key="requireApprovalAbove",
            label="Approval Threshold",
            type=FieldType.number,
            required=False,
            defaultValue=5000,
            description=(
                "Invoice totals above this value are flagged for human approval "
                "before posting to the accounting system."
            ),
        ),
        ConfigField(
            key="notificationEmail",
            label="Notification Email",
            type=FieldType.string,
            required=True,
            description=(
                "Email address that receives alerts for flagged or failed invoices."
            ),
        ),
    ],
    steps=[
        WorkflowStep(
            id="step_trigger",
            name="Receive Document",
            kind=StepKind.trigger,
            description=(
                "Accepts an inbound document payload — a PDF attachment or "
                "forwarded email with invoice/PO content."
            ),
            inputKeys=[],
            outputKeys=["documentId", "rawText", "senderEmail", "receivedAt"],
        ),
        WorkflowStep(
            id="step_extract",
            name="Extract Structured Fields",
            kind=StepKind.llm,
            description=(
                "Uses the LLM to extract vendor, line items, totals, dates, "
                "and payment terms from the raw document text."
            ),
            inputKeys=["rawText", "defaultCurrency"],
            outputKeys=[
                "vendorName",
                "vendorEmail",
                "invoiceNumber",
                "invoiceDate",
                "dueDate",
                "currency",
                "lineItems",
                "subtotal",
                "taxAmount",
                "totalAmount",
                "paymentTerms",
            ],
            promptTemplate=(
                "You are a financial document parser.\n\n"
                "Document text:\n{{rawText}}\n\n"
                "Extract all invoice or purchase-order fields. "
                "Use '{{defaultCurrency}}' as the currency if none is stated.\n\n"
                "Respond with a JSON object:\n"
                "- vendorName: string\n"
                "- vendorEmail: string or null\n"
                "- invoiceNumber: string\n"
                "- invoiceDate: ISO 8601 date string\n"
                "- dueDate: ISO 8601 date string or null\n"
                "- currency: 3-letter currency code\n"
                "- lineItems: array of {description, quantity, unitPrice, amount}\n"
                "- subtotal: number\n"
                "- taxAmount: number\n"
                "- totalAmount: number\n"
                "- paymentTerms: string or null\n\n"
                "Respond ONLY with the JSON object."
            ),
        ),
        WorkflowStep(
            id="step_validate",
            name="Validate Totals",
            kind=StepKind.transform,
            description=(
                "Checks that line-item amounts sum to the extracted subtotal "
                "and that subtotal + tax equals totalAmount."
            ),
            inputKeys=["lineItems", "subtotal", "taxAmount", "totalAmount"],
            outputKeys=["validationPassed", "validationErrors"],
            action="finance.validateTotals",
        ),
        WorkflowStep(
            id="step_approval_gate",
            name="Approval Gate",
            kind=StepKind.condition,
            description=(
                "Flags invoices above the configured threshold for human review "
                "before they are posted."
            ),
            inputKeys=["totalAmount", "requireApprovalAbove"],
            outputKeys=["requiresApproval"],
            condition="totalAmount > requireApprovalAbove",
        ),
        WorkflowStep(
            id="step_post",
            name="Post to Accounting System",
            kind=StepKind.action,
            description=(
                "Creates the invoice or bill record in the configured accounting "
                "system. Skipped when human approval is required."
            ),
            inputKeys=[
                "accountingSystem",
                "vendorName",
                "vendorEmail",
                "invoiceNumber",
                "invoiceDate",
                "dueDate",
                "currency",
                "lineItems",
                "subtotal",
                "taxAmount",
                "totalAmount",
                "paymentTerms",
                "requiresApproval",
            ],
            outputKeys=["accountingRecordId", "posted"],
            action="finance.postRecord",
        ),
        WorkflowStep(
            id="step_output",
            name="Emit Result",
            kind=StepKind.output,
            description=(
                "Records the extraction outcome and sends a notification if the "
                "invoice was flagged or validation failed."
            ),
            inputKeys=[
                "documentId",
                "invoiceNumber",
                "totalAmount",
                "validationPassed",
                "requiresApproval",
                "accountingRecordId",
                "notificationEmail",
            ],
            outputKeys=["event"],
            action="events.emit",
        ),
    ],
    sampleInput={
        "documentId": "doc-00331",
        "rawText": (
            "INVOICE\nVendor: Acme Supplies Ltd\nvendor@acmesupplies.com\n"
            "Invoice #: INV-2024-0042\nDate: 2024-03-15\nDue: 2024-04-14\n"
            "Item: Cloud storage — 12 months  Qty: 1  Unit: $3,600.00  Total: $3,600.00\n"
            "Item: Setup fee  Qty: 1  Unit: $400.00  Total: $400.00\n"
            "Subtotal: $4,000.00  Tax (10%): $400.00  Total: $4,400.00\n"
            "Terms: Net 30"
        ),
        "senderEmail": "billing@acmesupplies.com",
        "receivedAt": "2024-03-15T09:00:00Z",
    },
    expectedOutput={
        "invoiceNumber": "INV-2024-0042",
        "totalAmount": 4400.0,
        "validationPassed": True,
        "requiresApproval": False,
        "posted": True,
        "event": {"type": "invoice.processed"},
    },
)
