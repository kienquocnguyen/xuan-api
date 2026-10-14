# Data Model (conceptual)

This document covers **what business data XuanCreative has** and **how the business concepts relate**.

| Need | Read |
|---|---|
| Business concepts, their meaning, status and relationships | **This document** |
| How we design PostgreSQL schemas (conventions, constraints, migrations) | `database.md` §1–§11 |
| The **actual, decided physical schema** (tables, columns, types, keys) | `database.md` §12, *Physical database map* |
| Where code lives | `architecture.md` |

**Conceptual means:**
- no columns and no types;
- a box here is a business concept, not necessarily a table;
- a concept becomes physical only when its slice designs it (then it appears in `database.md` §12).

**Three things this document never equates:**
- **Module ≠ table.** One module may own several tables (courses → courses, sections, lessons).
- **Role ≠ table.** "Admin" is a meaning a user can have. How that's stored is undecided (§4).
- **Concept ≠ decided schema.** Only `database.md` §12 is decided schema.

## 1. Status legend

| Status | Meaning |
|---|---|
| **CONFIRMED** | A real product capability the owner has stated. It will be built; its design happens in its slice |
| **LIKELY / NEEDS PRODUCT DESIGN** | Probably needed, or its shape depends on a product decision not yet made. Don't build or guess |
| **DEFERRED** | Not part of the product's current direction, or handled outside the system for now |

## 2. Domain map

```mermaid
erDiagram
    USER ||--o{ CONTENT_POST : "authors (every post has one author)"
    SERVICE ||--o{ SERVICE_APPLICATION : "is applied for"
    USER |o--o{ SERVICE_APPLICATION : "may submit (guests can apply too)"
    SERVICE_APPLICATION ||--o| APPOINTMENT : "creates, once accepted"
    USER ||--o{ ENROLLMENT : "registers"
    COURSE ||--o{ ENROLLMENT : "receives"
    COURSE ||--o{ COURSE_SECTION : "contains (likely: depends on course format)"
    COURSE_SECTION ||--o{ LESSON : "contains (likely)"
    USER ||--o{ ORDER : "places (deferred)"
    ORDER ||--o{ ENTITLEMENT : "grants (deferred)"
    ENTITLEMENT }o--|| COURSE : "gives access to (deferred; may merge with ENROLLMENT)"
    NEWSLETTER_SUBSCRIPTION }o--o| USER : "may link to (needs product confirmation)"
```

**Reading the map:**
- `||--o{` means "one to many": a user authors many posts, and each post has exactly one author.
- `}o--o|` / `|o--o{` mean "optional": a newsletter subscription may exist without an account; an application may come from a guest.
- `||--o|` means "zero or one" (0..1): a pending or rejected application has no appointment; an accepted, scheduled application has exactly one. The physical constraint is deferred to the application/booking slice.
- Labels carry the status when it isn't CONFIRMED.
- Authorization is not drawn as a box (§4).

## 3. Catalogue

| Concept | Business meaning | Status | Relates to | Owning module |
|---|---|---|---|---|
| **User / account** | A person who signs in, with reusable profile details so they don't re-enter them for every application or registration | CONFIRMED | authors posts; may submit service applications; registers in courses | Designed in the auth slice |
| **Role** (authorization concern) | What a user may do: customer, editor or admin. Xuân is an admin user; editors and customers are users too | CONFIRMED *as a concept*. **Persistence pending the auth slice** (§4) | qualifies a user | Auth slice |
| **Service offering** | An offer Xuân provides publicly, as shown on Work With Me and the homepage "Ways". Current examples: *Channel Kickstart Session* (a 90-minute 1:1 session) and *3-Month 1:1 Coaching* (a 12-week program). **A catalog entry, not an appointment** (§3.1) | CONFIRMED. **The first slice:** a public, read-only catalog | is applied for through service applications | `services` (first slice) |
| **Service application** | A person asking to work with Xuân on a specific offering. Reviewed before Xuân accepts the client (§3.1) | CONFIRMED future concept. **Persistence DEFERRED** to the application/booking slice | service offering; optionally a user; zero or one appointment (0..1) | — |
| **Appointment** | An actual, scheduled meeting, created only from an accepted application (§3.1) | CONFIRMED future concept. **Persistence and calendar integration DEFERRED** to the application/booking slice | service application | — |
| **Course** | A structured learning product a user can register for | CONFIRMED | receives enrollments; contains sections (likely) | — |
| **Course section / lesson** | The ordered parts of a course a learner works through | LIKELY: depends on the course format (self-paced vs live/cohort) | course | — |
| **Enrollment** | A user's registration in a course | CONFIRMED | user; course | — |
| **Content post** | An article/post published on the site. **Every post has an author user** | CONFIRMED as a future capability. Content types, rich-text representation, media, draft/publish state and publishing workflow are **designed in the content slice** | author user | — |
| **Newsletter subscription** ("Creator Notes") | An email-only list membership that may exist without an account | **NEEDS PRODUCT CONFIRMATION**: design intent only. If confirmed, it's introduced explicitly as a newsletter/email-subscription capability, never as a generic "subscribers" | optionally a user | — |
| **Building project** ("Đang xây") | Something Xuân is building, with a status | NEEDS PRODUCT DESIGN, and only if it ever becomes database-managed (it's static copy today) | — | — |
| **Order** | A record of a purchase | DEFERRED | user; entitlements | — |
| **Payment** | Money movement for an order | DEFERRED | order | — |
| **Entitlement** | A user's right to access paid content | DEFERRED until its relationship with enrollment is designed (they may turn out to be one concept) | order; course | — |
| **Inquiry** | A message sent through a contact form | DEFERRED while collaboration enquiries stay `mailto` | — | — |
| **External providers** | Email, payment, calendar or newsletter services we integrate with | Google Calendar / Meet and applicant email notifications: CONFIRMED future integrations of the application/booking slice (§3.1). The others: DEFERRED | appointments; applications | — |
| **Support / donation** ("Arabica") | Supporting Xuân | DEFERRED while it's handled externally | — | — |

### 3.1 Service offerings, applications and appointments

Working with Xuân is **application-based**. Nobody buys or books an offer directly: Xuân reviews each person first and may turn them down. For example, someone whose goal is mainly faceless-channel monetization or AI-generated video isn't a fit for Xuân's *Personal Brand through Content* work.

```
ServiceOffering ──► ServiceApplication ──(accepted)──► Appointment / calendar event
  what Xuân offers    someone asks to work with Xuân      an actual scheduled meeting
```

| Concept | Is | Isn't |
|---|---|---|
| **Service offering** | What Xuân offers publicly (the catalog) | A bookable time slot or a session with a fixed length |
| **Service application** | One person's request to work with Xuân on one offering, with a requested slot | An accepted client or a confirmed meeting |
| **Appointment** | A real meeting on Xuân's calendar, created after acceptance | The whole engagement (for 3-Month 1:1 Coaching, it's the **first** meeting only) |

**Conceptual flow:**

1. A visitor opens a service page and clicks apply / book.
2. They fill in an application: full name, phone, email, Facebook URL (optional), the Personal Brand or channel they're building, what they want Xuân's help with, and a requested available slot. Later, slots may come from Xuân's Google Calendar availability.
3. The application is **pending**. Xuân reviews it in the admin area.
4. **Rejected:** the status becomes rejected, with an optional rejection reason, and the applicant is notified by email.
5. **Accepted:** the status becomes accepted, and the selected time is reserved.
   - A Google Calendar event is created for Xuân. It's traceable back to the application or person through a stable reference, e.g. the internal application id.
   - A Google Meet link is created.
   - The applicant receives the invitation by email and can accept the Google Calendar invitation.

**Confirmed requirements** (for the application/booking slice to design):
- Users submit an application first; they never automatically purchase or book an offer.
- Xuân accepts or rejects each application; a rejection may carry an optional reason.
- Statuses include at least *pending*, *accepted* and *rejected*.
- Guests can apply. Logged-in users may later get their details prefilled.
- An accepted application creates/synchronizes a Google Calendar event with a Google Meet link and an attendee invitation.
- For **3-Month 1:1 Coaching**, the application schedules the first meeting / qualification conversation only. The 12-week delivery isn't modeled as one long appointment; ongoing work may happen through social channels and other tools.

**Deferred to that slice:** tables, columns, statuses as stored, the Google Calendar / Meet integration design, and email delivery.

**Design trigger (not solved here):** two applicants may see and request the same free slot. The slice must define how pending applications affect slot availability (e.g. temporary holds), so Xuân can never accept two people into the same slot.

## 4. Authorization (conceptual requirements)

**Confirmed:** there is one user/account identity, and a user can carry an authorization meaning of **customer**, **editor** or **admin**.

**Not decided, pending the auth slice:**
- whether a user has one role or several;
- whether a role is a column on users, or `roles`/`user_roles` tables exist;
- whether a richer permission system is ever justified.

Nothing here implies any of those storage choices.

### Two different authorization questions

| Kind | Question | Needs the specific record? |
|---|---|---|
| **Role-based** | "What category of user is this, and may that category do this action at all?" | No |
| **Resource ownership** | "Does *this* content record belong to *this* editor?" | Yes: load the record and compare its author with the current user |

Content therefore conceptually has an **author user**. The Nest mechanism (guards, policies, decorators) is designed in the auth and content slices, not here.

### Content permissions

| Action | Admin | Editor | Customer |
|---|---|---|---|
| Create a post | ✓ | ✓ (becomes its author) | ✗ |
| Edit own post | ✓ | ✓ | ✗ |
| Edit another user's post | ✓ | ✗ | ✗ |
| Delete a post | ✓ | ✗ | ✗ |
| **Publish** | ✓ | **OPEN product decision**: publish directly, or drafts for admin approval | ✗ |
| Manage users / system administration | ✓ | ✗ | ✗ |

## 5. Open product decisions affecting the model

- **Final catalog content.** The current offers are *Channel Kickstart Session* and *3-Month 1:1 Coaching*. Their slugs, exact titles and summaries for the seed are still the owner's to supply. Whether the UI needs structured display metadata (e.g. "90 minutes", "12 weeks") instead of copy in the summary is open.
- **Application/booking details** (§3.1): the final form fields, where available slots come from and how they're held, email content, and whether and when payment is involved.
- **Course format:** decides sections/lessons.
- **Content publishing workflow,** and whether editors may publish.
- **Newsletter (Creator Notes):** real capability or not.
- **Enrollment vs entitlement:** one concept or two (decided with orders).
- **Money:** currency, price units, formatting. That's why services carry **no price** in V1.
