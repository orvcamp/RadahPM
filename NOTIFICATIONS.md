# In-App Notifications (the bell)

A bell appears at the top right of every page with an unread count. Click it for
the last 20 notifications; click one to jump straight to the relevant project tab.
"Mark all read" clears the badge.

## Events that notify
  📄 document.uploaded        a document was uploaded
  ❓ rfi.raised               an RFI was raised
  ✅ rfi.answered             an RFI was answered
  📐 submittal.returned       a submittal was returned (disposition in the title)
  📝 changeorder.submitted    a CO was submitted for decision
  ✅ changeorder.approved     a CO was approved
  ⛔ changeorder.rejected     a CO was rejected
  🧱 dailylog.filed           a daily log was filed

## Who gets notified
Project members, plus the organization's admin/staff (who can see every project
in their org). The person who performed the action is never notified of it.
Trade partners are excluded from change-order events, because they have no
access to change orders at all.

## Design decisions worth knowing
- NO EMAIL in v1. A busy project generates dozens of these a day; emailing them
  all is the fastest way to get a team to mute you. Email digests can come later,
  opt-in.
- Notifying can never break the action that caused it. Every emit is wrapped and
  failures are logged, not thrown — uploading a document still succeeds if the
  notification insert fails.
- Actor and project names are stored on the notification row, so the bell renders
  with no joins and still reads correctly if the source record is later deleted.
- The unread count polls once a minute. No websockets — this is a construction
  app, not a chat app.

## New + changed files
New: backend/db/migrations_phase3_notifications.sql
     backend/notify.js
     backend/routes/notifications.js
     frontend/src/components/NotificationBell.jsx
Changed: backend/db/migrate.js, backend/server.js (mount),
         backend/routes/{documents,rfis,submittals,changeorders,dailylogs}.js (emit),
         frontend/src/components/DashboardLayout.jsx (bell in the header),
         frontend/src/pages/ProjectDetailPage.jsx (honors ?tab= deep links)

No env vars.

## Deploy
git add . && git commit -m "In-app notifications (bell)" && git push
Log should show: Migration (notifications) complete.

## Test (needs two accounts)
1. Log in as your admin in one browser, and as a second user (a client or trade
   partner you added to the project) in a private window.
2. As the second user, upload a document to the project.
3. In the admin window, wait up to 60 seconds — the bell shows a red badge.
   Click it: "New document: <filename>". Click the notification → you land on
   the project's Documents tab and the badge clears by one.
4. Raise an RFI as the trade partner, then answer it as the admin — each side
   sees the other's event.
5. Approve a change order → confirm the trade partner does NOT get that one.
