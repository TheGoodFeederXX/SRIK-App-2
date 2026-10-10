# SRIK AI Knowledge Base

Canonical source of truth for the in-app assistant. `aiKnowledge.service.ts`
parses this file by `##` section, retrieves the sections relevant to the user's
role, page and question, and puts them in the system message. Both AI providers
(NVIDIA primary, Gemini fallback) receive the identical result.

**Editing rules**
- Every statement must be true of the application as it is today. If a feature
  is not verified in the codebase, do not describe it — omit it, or mark it
  `STATUS: unverified` so the assistant says it does not know.
- Keep `## ` headings stable: they are the retrieval unit.
- Each workflow section states Purpose, Who can use it, Steps, Expected result,
  Common problems — the assistant answers in that shape.
- When a feature changes, update its section in the same change.

**What this document is NOT.** It describes ONE school. If you find yourself
writing about separate sites, several schools sharing the app, or a paid plan,
you are describing the product this code was adapted from rather than SRIK.

---

## What this app is

Sistem Pengurusan Sekolah SRI Al-Khairiah is the school management system for
**Sekolah Rendah Islam Al-Khairiah (SRIK)**, a single primary school at Jalan
Pedu, 06300 Kuala Nerang, Kedah. It is not a product sold to other schools.

It keeps the everyday running of one school in one place: attendance,
assessments, report cards, fees, and announcements to families.

The school's own facts, which the assistant may state plainly:
- Name: Sekolah Rendah Islam Al-Khairiah; short name SRIK.
- Address: Jalan Pedu, 06300 Kuala Nerang, Kedah.
- Telephone: 010-511 9582. Email: srialkhairiah@gmail.com.
- Headmaster: Mohd Fadil Hadi bin Haji Ismail.
- Language: Bahasa Melayu. The assistant answers in Malay.
- Currency: Malaysian Ringgit, written RM.
- School week: **Sunday to Thursday.** Friday and Saturday are the weekend.
- School year: the calendar year (January to December), divided into three
  terms called **Penggal 1, Penggal 2 and Penggal 3**.
- Classes are named by year and stream, e.g. "4 Al-Junaidi", "4 Al-Busiri".

## Who uses the app

**There are exactly three roles.** The assistant must not invent others.

| Role | In short |
|---|---|
| ADMIN | The school office. Full access, including finance. |
| TEACHER | Teaches classes; records attendance, assessments and results. |
| GUARDIAN | A parent or guardian. Sees their own children only. |

Some staff may additionally hold an office role; the office decides that.

What a user can see is decided by the server from their signed-in identity,
never by what they ask the assistant. When a person asks about a child who is
not theirs, the correct answer is that they cannot see it — not a summary.

## Signing in

Purpose: get a user into their own dashboard.

Who: everyone.

Sign-in is by **email address and password only**. There is no Google sign-in
and no single sign-on; the assistant must not suggest them.

Steps:
1. Open the app.
2. Enter the email address and password.
3. Select Log Masuk.

Expected result: the dashboard for that person's role opens.

Common problems:
- A wrong email or password gives the same message either way, on purpose, so
  nobody can discover which accounts exist. Ask the office to reset it.
- The office creates guardian accounts. A parent cannot create their own; if a
  parent has no account yet, the office creates one.
- The assistant must never reveal or guess a password.

## Attendance

Purpose: record who was present.

Who: teachers record attendance for their classes; the office can review it.

Steps (teacher):
1. Open Attendance.
2. Select the class.
3. Select the date.
4. Mark each student.
5. Save.

Expected result: the record is saved and is visible to the office and to the
parents of those students.

Important:
- **A student with no record is "not recorded", not absent.** The app never
  assumes absence from a missing entry. If someone asks why a child looks
  absent, the answer is that the register has not been taken for that day.
- A correction to an earlier day requires a reason, and the reason is kept.
- Attendance is recorded on school days only: Sunday to Thursday.

Common problems:
- A class that is not listed usually means the teacher is not assigned to it —
  the office assigns classes.

## Assignments

Purpose: set work for a class and see it returned.

Who: teachers create assignments for their classes; students see their own;
parents see their children's.

Steps (teacher): open Assignments, choose the class and subject, set the title,
description and due date, and publish. Students then see it and can mark it
done.

Expected result: the assignment appears for the students of that class and for
their parents.

## Entering marks

Purpose: record what a student scored.

Who: teachers enter marks for the classes and subjects they are assigned to.

Steps (teacher):
1. Open Marks.
2. Select the class.
3. Select the subject.
4. Select the term.
5. Enter each student's marks.
6. Save.
7. Check the saved marks.
8. Submit when the sheet is complete.

Expected result: marks are stored as soon as they are saved. Submitting marks
them ready for the office to review.

The school's grade scale — the assistant must not invent another:

| Grade | Marks | Meaning |
|---|---|---|
| A | 80–100 | Cemerlang |
| B | 65–79 | Baik |
| C | 50–64 | Memuaskan |
| D | 35–49 | Perlu Usaha |
| E | 0–34 | Perlu Bimbingan |

There is no F on this school's scale.

A **blank mark is not zero.** A blank means nothing has been recorded yet. The
assistant must never describe a blank as a fail, and never calculate an average
that treats a blank as zero.

Common problems:
- A teacher can only enter marks for students in a class they are assigned to;
  anything else is refused by the server.
- Saving stores the work; it does not publish anything.

## Publishing report cards

Purpose: make sure marks are checked before families see them.

Who: **only the office can publish.** A teacher's sheet stops at Submitted even
if they try to set Published.

A PARENT or guardian cannot see a report card until it is published. This is the
usual reason a parent asks why they cannot see their child's result, so it is
worth saying plainly: the office publishes it, and until then nobody in the
family can see it.

The path a report card takes:

1. Teacher enters marks and saves — stored, not visible to families.
2. Teacher submits — status becomes Submitted.
3. The office reviews it.
4. The office publishes it — status becomes Published.
5. Only then can the student and their parents see it.

Steps (office): open Report Cards, select the class and term, review, publish.

Expected result: the family can now see the report card.

## Adding a student

Purpose: enrol a child.

Who: the office only.

Steps: open Students, add the student's details, choose the class, and save. The
office then creates the guardian's account and links it to the child.

Expected result: the student appears in their class register, and their guardian
can sign in and see them.

Common problems:
- A student's class is set by their enrolment, not stored on the student. When a
  child moves up a year, a new enrolment is created and the old one is closed;
  the earlier year stays readable.
- A guardian who cannot see their child is usually not yet linked. The office
  links them.

## Classes and subjects

Purpose: define what is taught, and by whom.

Who: the office.

There are seven classes across Years 1 to 6, and twenty subjects. Subjects are
known by the school's short codes — BM, BI, MT, SN, SJ, BA, AQ, TJ, HFZ, TF,
HD, FQ, TH, SR, AK, JW, KH, PJK, PSV, RBT.

Steps: open Classes, add or edit the class, assign subjects, and assign a
teacher to each class or subject.

Expected result: the class appears for its assigned teachers, and its students
see their subjects, assignments and timetable.

Common problems:
- A teacher who cannot see a class is usually not assigned to it.
- Class names are labels, not data. The year level is what the app uses.

## Timetable

Purpose: the week's lessons.

Who: the office builds and publishes it. Teachers, students and parents see
their own.

The week runs **Sunday to Thursday**. The school day is 07:30 to 14:30 and has
twelve slots, including a break and the Zohar prayer — these are part of the
day, not gaps in it.

A timetable that is still a draft is not in force; the office publishes it
before anyone should follow it. A teacher, student or parent sees their own week
and cannot browse anyone else's.

## Fees and payments

Purpose: record what is owed and what has been paid.

Who: the office records everything. **Parents do not pay in this app.** There is
no online payment, no card, and no payment gateway. The assistant must never tell
a parent to "pay now" through the app.

The school's fees: RM150 monthly, RM200 one-off registration, RM30 monthly PIBG.

Steps (office): open Fees, create the charge against a student, and record
payments as they are received at the office.

Steps (guardian): open Fees to see what is owed and what has been paid, and pay
at the office.

Important, and worth saying plainly:
- **A balance is never stored; it is worked out.** Outstanding is what was
  charged minus what was paid. If the two are corrected, the balance corrects
  itself.
- A payment is recorded once. Recording the same payment twice is prevented, so
  a duplicate cannot inflate what the family has paid.
- A receipt is only ever reversed, never deleted, so the history stays readable.
- One payment may cover several siblings at once.
- Discounts and refunds are recorded as their own entries.
- Money is shown in RM.
- Overdue amounts from a previous year are kept separate from this year's.

Common problems:
- A parent who cannot see the amount owed is usually not yet linked to the
  child; the office links them.
- If a parent believes they paid but the fee shows unpaid, do not ask them to
  pay again. Ask the office to check — the payment may have been recorded
  against the wrong child.

## Announcements

Purpose: tell families something.

Who: the office writes and publishes; teachers, students and parents read what
is addressed to them.

Important: **saving is not publishing.** A saved announcement is a draft and no
family can see it. Once published, it can only be withdrawn — it cannot be
quietly edited, because a notice a parent has already read should not change
underneath them.

## Messaging and notices

Purpose: communication inside the school.

Who: users message according to their permissions; the office posts notices.

The assistant must never read out or summarise another person's private
messages.

## The audit record

Purpose: a record of who changed what.

Who: the office can read it. **Nobody can edit or delete it** — not even the
office. Entries are written by the database itself, not by the app.

It records the person, what they did, and when. Passwords, tokens and keys are
never written to it.

## The assistant's limits

The assistant must never:
- Reveal, guess or reset a password.
- Name, describe or summarise a child the person asking is not entitled to see.
- Say a grade or a balance that the app itself would not show.
- Offer to change anything. It explains; people make the changes.
- Invent a class, a subject, a teacher or a rule that is not in this document.
- Never describe this school as having separate sites, several schools sharing
  one app, a paid plan, or online payments.

When the assistant does not know, the right answer is that it does not know and
that the school office can help — with the school's own contact details.

## Demo School

STATUS: verify before describing.

A demo mode has existed for trying the app without real data. The assistant
should not promise that demo data resets on a particular schedule unless it can
confirm it.
