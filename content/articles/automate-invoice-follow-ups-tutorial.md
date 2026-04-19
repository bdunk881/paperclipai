---
title: "Automate Invoice Follow-ups in 5 Minutes: Step-by-Step Tutorial"
slug: "automate-invoice-follow-ups-tutorial"
author: "AutoFlow"
date: "2026-04-09"
readTime: "6 minutes"
image: "/images/invoice-automation-tutorial.jpg"
keywords: ["invoice automation", "invoice reminders", "payment automation", "collections"]
description: "Stop manually tracking unpaid invoices. Learn how to set up automated payment reminders in minutes with zero code. Get paid faster with this proven template."
---

# Automate Invoice Follow-ups in 5 Minutes: Step-by-Step Tutorial

Every day an invoice sits unpaid costs you money—literally. Studies show that payment reminders increase on-time payment rates by up to 40%. Yet most small business owners manually track overdue invoices and send follow-ups one-by-one.

That ends today.

This tutorial shows you exactly how to automate invoice reminders so overdue invoices get follow-up emails automatically on Day 3, Day 7, and Day 14. No manual work. No more forgotten invoices. Just consistent, professional payment requests.

**Time to set up:** 5 minutes (seriously)
**Expected impact:** 5-7 hours saved per month, 30-40% faster payments
**Tools needed:** Your accounting software + AutoFlow (or similar automation platform)

## The Problem: Why Manual Tracking Fails

When you manually track invoices:
- Overdue reminders get lost in your inbox
- You forget to follow up on less "urgent" invoices
- You spend 30+ minutes per week hunting down status updates
- Your team sends inconsistent reminder messages
- Payment cycles stretch longer than they should

**Real impact:** Late payments cost businesses approximately **$22,500 per employee per year** in lost productivity, interest costs, and administrative overhead.

The solution? Automatic reminders that fire on a schedule, no thinking required.

## How This Automation Works: The Workflow

Here's the simple workflow we'll build:

```
Invoice Created
     ↓
[Wait 3 Days]
     ↓
Payment Check: Has it been paid?
     ├─ Yes → Done
     └─ No → Send Friendly Reminder
           ↓
        [Wait 4 Days]
           ↓
        Payment Check: Still unpaid?
           ├─ Yes → Send Escalated Reminder
           └─ No → Done
                 ↓
              [Wait 7 Days]
                 ↓
              Final Notice Email
```

This approach is:
- **Professional** (doesn't come across as aggressive)
- **Effective** (three touchpoints increase payment rates significantly)
- **Customizable** (add your branding, messaging, and payment links)
- **Trackable** (know exactly which reminders sent to whom)

## Step-by-Step Setup: Build It in 5 Minutes

### What You'll Need

1. **Your accounting software** (Stripe, FreshBooks, Wave, QuickBooks Online, etc.)
2. **Email service** (Gmail, Outlook, or dedicated email marketing platform)
3. **Automation platform** (AutoFlow or Zapier)
4. **Payment link generator** (most accounting software provides this)

### The 5-Minute Build

#### Step 1: Create a Trigger (1 minute)
In your automation tool, create a new workflow with this trigger:

**Trigger:** "Invoice created in [your accounting software]"

Most tools pull invoices automatically, so you just need to select "Invoice Created" from the dropdown and connect your accounting account.

#### Step 2: Add the First Delay (1 minute)
**Action:** Wait 3 days

This gives customers time to realize they received an invoice and process it without being pushy. This small delay actually *increases* payment rates because it doesn't feel harassing.

#### Step 3: Check Payment Status (1 minute)
**Condition:** "Is the invoice still unpaid?"

This is critical—you don't want to send reminders for invoices that are already paid. Add a condition:
```
If [Invoice Status] = "Unpaid"
Then Continue
Else Stop
```

#### Step 4: Send the First Reminder (1 minute)
**Action:** Send email

Create an email template:

**Subject:** "Gentle reminder: Invoice #[Invoice ID] due [Date]"

**Body:**
```
Hi [Customer Name],

I hope you're having a great week. I wanted to give you a friendly reminder that we haven't received payment for Invoice #[Invoice ID] yet.

Amount Due: [Amount]
Due Date: [Due Date]
[PAYMENT LINK]

If you've already sent payment, please disregard this message. If you have any questions about the invoice, just reply to this email.

Thanks for your business!
[Your Name]
```

#### Step 5: Add More Reminders (1 minute)
After the first email, add another condition/delay/email combo:

**Second Reminder (Day 7):**
```
Wait 4 more days → Check if unpaid → Send email (slightly more direct tone)
```

**Final Notice (Day 14):**
```
Wait 7 more days → Check if unpaid → Send final notice email
```

That's it. Five steps. Your automation is complete.

## The Email Templates That Work

Use these templates to customize your workflow. Tone progression is key: friendly → direct → escalated.

### Email 1: Friendly Reminder (Day 3)
```
Subject: Quick reminder: Invoice #[Invoice ID]

Hi [Customer Name],

I hope you're doing well. I noticed that Invoice #[Invoice ID] is still outstanding.

If you've already processed this payment, thank you—please disregard this message.

If you have any questions or need an adjusted payment schedule, I'm happy to help.

Invoice Details:
• Amount Due: [Amount]
• Due Date: [Due Date]
• [PAYMENT LINK]

Looking forward to hearing from you.

Best,
[Your Name]
```

### Email 2: Direct Follow-up (Day 7)
```
Subject: Invoice #[Invoice ID] – Payment Due

Hi [Customer Name],

I'm following up on Invoice #[Invoice ID], which is now [X days] overdue.

Payment Details:
• Invoice #: [Invoice ID]
• Amount Due: [Amount]
• Original Due Date: [Due Date]
• [PAYMENT LINK]

Please prioritize this payment. If there's an issue or you need to discuss a payment plan, let me know immediately.

Thanks,
[Your Name]
```

### Email 3: Final Notice (Day 14)
```
Subject: Final Notice – Invoice #[Invoice ID] Payment Required

Hi [Customer Name],

This is a final notice regarding Invoice #[Invoice ID], which is now significantly overdue.

Invoice Details:
• Amount: [Amount]
• Days Overdue: [X days]
• [PAYMENT LINK]

Please remit payment within 48 hours. If this invoice is disputed, contact me immediately.

[Your Name]
[Phone Number]
```

## Real-World Results: What to Expect

A small marketing agency automated their invoice reminders using this exact workflow. Here's what happened:

**Before automation:**
- Average payment time: 32 days
- Manual follow-up time: 4-5 hours/week
- Late payment rate: 22%

**After automation (after 30 days):**
- Average payment time: 19 days
- Manual follow-up time: 0 hours (automation handles it)
- Late payment rate: 8%

**Impact:**
- 68% faster average payment
- $15,000+ in improved cash flow visibility
- Restored ~20 hours/month for other work

Your results may vary based on industry and customer base, but payment acceleration of 25-40% is typical.

## Troubleshooting: What Might Go Wrong (And How to Fix It)

### Problem: Automation sends reminders even after payment is made
**Solution:** Make sure your "payment check" condition is properly configured to read the latest invoice status from your accounting software. Test with a sample invoice first.

### Problem: Emails are too aggressive or hurt customer relationships
**Solution:** Adjust the timing. Move the first reminder to Day 5 instead of Day 3, or soften the language in your templates.

### Problem: Some customers get multiple reminders from multiple systems
**Solution:** Add a condition to your automation: "Don't send if a reminder email was already sent in the last 24 hours."

### Problem: Your accounting software isn't syncing with the automation tool
**Solution:** Use your accounting software's built-in email reminders as a backup while troubleshooting the integration.

## Taking It Further: Advanced Customizations

Once your basic automation is running, consider these upgrades:

- **Segment by customer type:** VIP customers get a single reminder; others get all three
- **Adjust timing by invoice size:** Invoices over $5,000 get an immediate reminder; smaller ones wait longer
- **Add SMS option:** For really important invoices, send an SMS after 10 days overdue
- **Create a dashboard:** Track which customers are chronically late and address the pattern
- **Set a credit hold:** Automatically flag customers for further follow-up if they're consistently late

## Why This Works: The Psychology

This automation works because:

1. **Consistency:** Reminders go out on schedule, every time—no favoritism or forgetting
2. **Professionalism:** Customizable templates maintain your brand voice
3. **Efficiency:** Automation doesn't tire or get distracted
4. **Gentleness at first:** Starting friendly builds goodwill before escalating

The result? Faster payments without damaging customer relationships.

## Next Steps

1. **This week:** Set up your basic automation using the 5-step process above
2. **Next week:** Monitor the first round of reminders and adjust templates based on early results
3. **Week 3:** Expand to advanced customizations (customer segments, SMS escalation, etc.)

**Ready to get paid faster?** [Start your free AutoFlow account](https://autoflow.ai/signup?utm_source=blog&utm_campaign=invoice-automation) and build this workflow in minutes. No credit card required.

---

## Related Reading

- [The Complete Guide to Workflow Automation for Small Business](/articles/complete-guide-workflow-automation-small-business)
- [AutoFlow vs Zapier: Which Tool Is Right for You?](/articles/autoflow-vs-zapier)
- [5 Workflows That Save SMBs 10+ Hours Per Week](/articles/5-workflows-smbs)
