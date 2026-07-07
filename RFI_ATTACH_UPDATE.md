# RFI — attach files when raising (frontend-only update)

Adds an "+ Add Files" section to the New/Edit RFI modal so you can attach
supporting files at the moment you raise the RFI (files upload on save). The
per-row 📎 button for adding files later still works. Reuses the RFI attachment
endpoints already deployed — no backend change.

## File (replace the one you deployed)
frontend/src/components/RfisTab.jsx

## Deploy
Copy the file in (Replace), then:
git add . && git commit -m "RFI: attach files when raising" && git push
No migration, no env vars.

## Test
Project → RFIs → New RFI → fill it in → "+ Add Files" → pick a file → Create RFI.
You'll see "Uploading attachment…" then the RFI appears; click its 📎 to confirm
the file is attached (and it also shows in the Documents tab).
