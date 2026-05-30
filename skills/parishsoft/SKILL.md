---
name: parishsoft
description: Use this skill when an AutoFlow agent needs to read or write data in ParishSOFT — the parish + diocese management suite for Catholic parishes, schools, dioceses, and Catholic adjacent organizations. Pull families / members / sacraments / contributions / ministries / events, react to registration and giving events, push offertory + tuition revenue to QuickBooks, manage sacrament records (baptism, first communion, confirmation, marriage), automate registration + tuition cadences, and handle religious-ed enrollment. Covers ParishSOFT's API + auth, the Family / Member / Sacrament / Pledge / Ministry / Religious Education / School model, Catholic-parish-specific considerations (canon law record-keeping, sacrament certificate issuance, diocesan reporting, religious-ed safe-environment compliance), and the workflow shape AutoFlow customers reach for (new registration, sacrament prep, contribution tracking, school tuition + religious-ed billing).
---

# ParishSOFT — Catholic parish + diocese management

ParishSOFT (a Ministry Brands product) is the dominant parish + diocesan management suite for AutoFlow's Catholic-vertical SMBs — Catholic parishes (small/mid US Catholic parishes), parish schools, religious-education programs, dioceses, and Catholic adjacent organizations (e.g. Catholic-funded social-service agencies). Used by 6,500+ Catholic parishes in the US — significant penetration of the ~17,000 US Catholic parishes.

Use ParishSOFT when the customer is a **Catholic parish, Catholic school, or diocesan office**. For protestant churches → Planning Center. For Jewish congregations → ShulCloud. For mosques + temples → various.

## Catholic-context framing — distinct from Planning Center

Catholic parishes operate under specific structures that change how AutoFlow integrates:

- **Diocesan structure** — parishes report to dioceses; some workflows (sacrament records, annual report) flow upward.
- **Canon law record-keeping** — sacraments (baptism, confirmation, marriage, etc.) are perpetual canon-law records; copies issued for life events (marriage prep elsewhere requires baptism certificate, etc.).
- **Religious-education + parish schools** — most Catholic parishes run religious-ed programs (Sunday/weekday classes); many have parish schools (K-8). Tuition + enrollment workflows are central.
- **Multiple revenue streams** — offertory + envelope giving + online giving + capital campaigns + special collections (e.g. annual Catholic Appeal) + tuition.
- **Sacrament prep + scheduling** — formal preparation programs lead to sacrament celebrations; scheduling involves clergy + sponsors + family.
- **Safe environment / VIRTUS compliance** — Catholic dioceses require training + background checks for all adults working with children (post-2002 USCCB Charter for the Protection of Children + Young People); tracking compliance is non-negotiable.
- **Parish-school federal compliance** — schools often participate in federal programs (Title I, IDEA) requiring specific data reporting.

## When to reach for this skill

- **New registration** — family registers with the parish → welcome routine, ministry-interest survey, contribution-method enrollment.
- **Sacrament preparation** — baptism, first communion, confirmation, marriage prep registration → preparation tracking + scheduling.
- **Sacrament certificate request** — life-event needs (someone getting married out-of-parish needs baptism record) → records-search + certificate issuance.
- **Offertory + giving** — weekly contribution tracking, online giving, statement issuance.
- **Tuition (school)** — billing, autopay, financial-aid processing, payment plan management.
- **Religious-education enrollment** — annual registration, payment, class scheduling.
- **Ministry engagement** — sign up for ministries (lector, EMHC, choir, etc.); track participation.
- **Safe-environment compliance** — track VIRTUS training + background-check renewals for all adults working with minors.
- **Annual contribution statements** — IRS-compliant year-end statements.

## Authentication

ParishSOFT offers API access primarily through partner-program integration:

```
Authorization: Bearer <parishsoft-access-token>
```

OAuth or API-key auth depending on Ministry Brands product line (ParishSOFT Family Suite vs ParishSOFT Connect Now vs IconCMO post-merger). AutoFlow's connection record captures product + credentials.

Base URL varies by Ministry Brands subdivision; verify per current documentation at integration time.

Diocese-multi-parish setups: each parish is its own ParishSOFT instance typically, even within a diocese. AutoFlow connections pin per-parish.

## Core entity model

| Entity | What it is | Notes |
|---|---|---|
| Family | The household | Central organizing unit (vs Planning Center's Person-centric) |
| Member | An individual within a family | Includes children, sometimes deceased relatives |
| Registration | Active parish membership status | Vs visitor / transferred-out |
| Sacrament | Baptism, First Communion, Confirmation, Marriage, etc. record | Canon-law-perpetual |
| Sponsor / Godparent | Sacramental sponsor record | Required for baptism + confirmation |
| Marriage Record | The marriage register entry | Includes witnesses + ministers |
| Pledge | A giving commitment | Annual or capital campaign |
| Contribution | A gift recorded | Linked to family/envelope |
| Envelope | A numbered offering envelope | Pre-printed; family tracks via number |
| Ministry | A parish ministry / volunteer area | EMHC, lector, choir, ushers, RCIA, etc. |
| Religious Ed | Class / catechist / student record | For parish religious-education program |
| School | The parish school | Separate billing + enrollment from parish |
| Tuition Account | School tuition record per student | With payment plan |
| Event | A parish event (festival, dinner, retreat) | Calendar + registration |
| Safe Environment Record | VIRTUS training + background check tracking | Required for adults working with minors |

## Common AutoFlow workflows

### 1. New registration → onboarding

```
Webhook on family.registered → Routine fires →
  1. Send welcome packet via email:
       Mass schedule + reconciliation hours
       Parish bulletin signup
       Online giving enrollment link
       Ministry interest survey
       Religious-ed (if children) information
  2. Cron 2 weeks later: 
       Personal email from pastor (NOT auto-canned tone — pastoral
       relationship building)
       Invitation to "welcome to the parish" coffee event
  3. Track new-registrant retention (do they engage at 3, 6, 12 months?
     drop-off here often signals fit issues; pastor/staff can address).
```

### 2. Sacrament preparation routine

```
Triggered when family registers for baptism / first communion / confirmation
prep → Routine fires →
  1. For BAPTISM (typically infant in Catholic context):
       Verify parents are registered + practicing
       Schedule baptism class (parent prep) if first child
       Verify godparents meet canon-law requirements (baptized + confirmed
       Catholic, age 16+, practicing — godparent letter from THEIR parish
       required)
       Schedule baptism celebration date
       Track all paperwork
  2. For FIRST COMMUNION / CONFIRMATION (typically 2nd-grade and high-school):
       Multi-year prep — student in religious-ed program
       Sacrament-year requires retreat attendance + service hours +
       parent meetings
       Schedule sacrament Mass (often grouped — multiple students in
       one Mass)
  3. For MARRIAGE:
       Couple registers ≥6 months before wedding (canon law typical)
       Verify both parties are baptized (request baptism certificates
       from baptismal parish)
       Pre-Cana program enrollment
       FOCCUS or other pre-marriage inventory
       Diocesan paperwork
       Dispensations if needed (mixed marriage, etc.)
  4. Track preparation completion; sacrament can't proceed without
     all canonical requirements.
```

### 3. Sacrament certificate request

```
Triggered when someone requests a copy of their sacrament record
(commonly: getting married out-of-parish, applying for godparent
role, etc.) → Routine fires →
  1. Search parish records by name + DOB + sacrament date
  2. If found: generate the certificate per diocesan format
       Include parish seal + clergy signature requirement
       Surface to parish staff for final approval + mailing
  3. If not found:
       Check transferred-records (some parishes consolidate)
       Direct requester to ask diocese / archdiocese for archival lookup
  4. For sealed records (adoptions, etc.): direct to diocese for
     special handling.
  5. Sacrament records are canon-law-required documents; integrity
     matters — never auto-issue without staff verification.
```

### 4. Offertory + giving routines

```
Webhook on contribution.posted OR weekly cron →
  1. For weekly contributions:
       Acknowledge online giving with simple receipt (matches gift to envelope#)
       Track giving patterns — for chronically-attended-but-not-giving
       families, surface to stewardship office for relationship building
       (NEVER guilt-trip via automation; Catholic stewardship is
       relational + voluntary)
  2. For special collections (Mission Sunday, Catholic Appeal, etc.):
       Track participation rate
       Diocesan reporting on amounts collected
  3. Year-end (January 5):
       Generate annual contribution statements per IRS Pub 1771
       Surface to pastor + bookkeeper for review BEFORE distribution
       Email + mail per family preference.
```

### 5. School tuition + religious-ed billing

```
Monthly cron during school year →
  1. For each tuition account:
       Generate monthly invoice per agreed payment plan
       Apply financial-aid credits
       Process autopay if enrolled
       Track delinquency
  2. For delinquent accounts (>30 days):
       Friendly reminder + offer payment-plan adjustment
       For chronic delinquency: surface to principal/pastor for personal
       conversation (NEVER auto-block student from school via automation —
       pastoral + administrative judgment)
  3. Tuition is often subsidized by parishioner giving; the relationship
     between tuition AR + family giving is sensitive — surface signals,
     don't act unilaterally.
```

### 6. Safe-environment / VIRTUS compliance

```
Cron routine monthly →
  1. For each adult registered in ministries involving children
     (catechists, youth ministers, coaches, EMHC at school Masses, etc.):
       Check VIRTUS training completion date (typically 3-year renewal
       cycle, varies by diocese)
       Check background-check date (typically 5-year renewal)
       Check policy acknowledgment signature
  2. For expiring within 60 days:
       Email reminder + portal link to renew
  3. For expired:
       URGENT — surface to safe-environment coordinator
       Adult must be removed from minor-involving ministry until renewed
  4. NEVER bypass safe-environment requirements — USCCB Charter (2002)
     established this; violations risk diocesan canonical penalties
     + civil liability.
```

### 7. Annual contribution statement (year-end)

```
Cron routine January 5 →
  1. For each family with total giving in prior tax year > $0:
       Generate the annual contribution statement per IRS Pub 1771
       Itemize gifts; sum totals; standard "no goods or services" or
       quid pro quo language as applicable
       Include parish 501(c)(3) info + EIN
  2. Surface to pastor + bookkeeper for review BEFORE distribution
  3. Distribute per family communication preference (email + portal,
     mail).
  4. Catholic parishes are 501(c)(3) under group exemption typically
     issued to the diocese; verify language with diocesan policy.
```

## Catholic-parish-specific compliance

- **Canon law** governs sacramental records — perpetual retention, integrity, custody.
- **Safe Environment (post-USCCB Charter 2002)** — mandatory training + background checks for adults working with minors; failure has serious canonical + civil consequences.
- **Diocesan reporting** — many financial + sacramental statistics reported up to diocese annually.
- **501(c)(3)** — usually under group exemption issued to diocese; verify IRS Pub 1771 compliance.
- **Tax-deductibility for school tuition** — generally tuition for direct educational benefit is NOT tax-deductible; void out tuition payments from contribution statements (this is a common error).
- **Pastoral confidentiality** — sacrament-of-reconciliation conversations are absolutely privileged (seal of confession); routine pastoral conversations are typically privileged per diocesan policy.

## Idempotency

ParishSOFT's API has variable idempotency support. For routine-driven writes, dedupe via natural keys (family_id + event + date).

For Family + Member upserts, dedupe by mailing address + family head before creating.

## Webhooks

ParishSOFT publishes webhooks for major events (varies by Ministry Brands product):
- `family.registered`, `family.updated`
- `sacrament.recorded`
- `contribution.posted`
- `ministry.signup`
- `tuition.payment`

Signature verification: HMAC with per-subscription secret. Verify before processing.

## Rate limits

ParishSOFT / Ministry Brands publishes per-account rate limits. Typically conservative for periodic syncs; 429 with `Retry-After`. Heavy operations (year-end statements) off-peak.

## What this skill does NOT cover

- **Sacrament-of-reconciliation records** — most parishes don't keep records; absolutely privileged anyway.
- **Diocesan-level financial reporting infrastructure** — separate diocesan systems.
- **Parish website management** — separate platforms (Ministry Brands LiveStream / WeShare).
- **Live-streaming Mass** — separate platforms.
- **Religious vocations tracking** — diocesan-level processes outside parish scope.

## References

- API: https://www.parishsoft.com/ (Ministry Brands partner program)
- USCCB Charter for the Protection of Children + Young People: https://www.usccb.org/issues-and-action/child-and-youth-protection/charter
- IRS Pub 1771: https://www.irs.gov/pub/irs-pdf/p1771.pdf
- AutoFlow integration shape: `src/ticketSync/` (oauth2_pkce or api_key + secrets-store; per-parish credentials; safe-environment expiration tracking; sacrament-record integrity discipline)
