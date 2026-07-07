# Standard Construction Folder Template

Adds a "Set Up Standard Folders" button to the Documents tab (admin/staff).
One click builds a construction-standard filing structure for the project.
Idempotent — folders that already exist are left as-is, so clicking twice
never duplicates.

## Structure created
00 - Project Management  (Contacts & Directory, Meeting Minutes, Correspondence, Schedules)
01 - Preconstruction & Contracts  (Contracts & Agreements, Bonds & Insurance, Permits & Approvals, Proposals & Estimates)
02 - Drawings & Specifications  (Contract Drawings (For Construction), Shop Drawings, As-Builts, Specifications, Superseded)
03 - Submittals
04 - RFIs
05 - Change Management  (Change Orders, Potential Change Orders (PCOs), Construction Change Directives)
06 - Cost & Billing  (Budget, Pay Applications, Invoices, Lien Waivers)
07 - Field & Logs  (Daily Logs, Site Photos, Delivery Logs, Visitor Logs, Equipment Logs, Weather Logs)
08 - Safety  (Safety Plans, Incident Reports, Toolbox Talks & JHAs, Safety Inspections)
09 - Quality (QA-QC)  (Inspection Reports, Test Reports, Punch Lists, Deficiency Logs)
10 - Closeout  (Warranties, O&M Manuals, As-Built Record Set, Final Certificates & Permits, Training)

## Files (both changed)
backend/routes/documents.js  (new endpoint POST /projects/:projectId/folders/apply-template)
frontend/src/components/DocumentsTab.jsx  (Set Up Standard Folders button)

## Deploy
git add . && git commit -m "Standard construction folder template" && git push
No migration, no env vars.

## Use
Open a project → Documents tab → click "Set Up Standard Folders". The tree appears.
Then upload files into the matching folders. Run it on each project you want structured.
