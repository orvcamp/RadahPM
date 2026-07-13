// backend/server.js

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const securityHeaders = require("./middleware/securityHeaders");
const { globalLimiter } = require("./middleware/rateLimit");

const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const projectRoutes = require("./routes/projects");
const phaseRoutes = require("./routes/phases");
const taskRoutes = require("./routes/tasks");
const documentRoutes = require("./routes/documents");
const budgetRoutes = require("./routes/budget");
const changeOrderRoutes = require("./routes/changeorders");
const dailyLogRoutes = require("./routes/dailylogs");
const platformRoutes = require("./routes/platform");
const myModulesRoutes = require("./routes/mymodules");
const rfiRoutes = require("./routes/rfis");
const submittalRoutes = require("./routes/submittals");
const scheduleRoutes = require("./routes/schedules");
const trashRoutes = require("./routes/trash");
const notificationRoutes = require("./routes/notifications");
const logRoutes = require("./routes/logs");
const reportRoutes = require("./routes/reports");
const billingRoutes = require("./routes/billing");
const propertyRoutes = require("./routes/properties"); // MangoDoe Facilities: Properties & Assets
const workOrderRoutes = require("./routes/workorders"); // MangoDoe Facilities: Work Orders & PM Schedules
const vendorRoutes = require("./routes/vendors"); // MangoDoe Facilities: Vendors & Contracts
const inspectionRoutes = require("./routes/inspections"); // MangoDoe Facilities: Inspections & Compliance
const timeEntryRoutes = require("./routes/timeentries"); // MangoDoe Projects: Time Tracking
const approvalRoutes = require("./routes/approvals"); // MangoDoe Projects: Approvals

const app = express();
const PORT = process.env.PORT || 4000;

// Railway terminates TLS and proxies to us. Trusting one proxy hop makes
// req.ip the real client address, which the rate limiter depends on.
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(securityHeaders);

// CORS: in production, set CORS_ORIGIN to your deployed frontend URL
// (e.g. https://radah-pm.vercel.app). Comma-separate multiple origins.
const allowedOrigins = (process.env.CORS_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((s) => s.trim());

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);
app.use(express.json({ limit: "1mb" }));

// Generous catch-all rate limit (auth endpoints have stricter limits of their own).
app.use("/api", globalLimiter);

// Health check — useful for Railway/Render deploy verification
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", service: "radah-pm-backend", time: new Date().toISOString() });
});

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api", phaseRoutes); // mounts /api/projects/:projectId/phases and /api/phases/:id
app.use("/api", taskRoutes); // mounts /api/projects/:projectId/tasks and /api/tasks/:id
app.use("/api", documentRoutes); // mounts /api/projects/:projectId/documents and /api/documents/:id
app.use("/api", budgetRoutes); // mounts /api/projects/:projectId/budget and /api/budget-*/:id
app.use("/api", changeOrderRoutes); // mounts /api/projects/:projectId/change-orders and /api/change-orders/:id
app.use("/api", dailyLogRoutes); // mounts /api/projects/:projectId/daily-logs and /api/daily-logs/:id
app.use("/api/platform", platformRoutes); // platform-admin org provisioning
app.use("/api", myModulesRoutes); // GET /api/my-modules
app.use("/api", rfiRoutes); // RFIs
app.use("/api", submittalRoutes); // Submittals
app.use("/api", scheduleRoutes); // Project schedule files
app.use("/api", trashRoutes); // Deleted Items (restore / purge)
app.use("/api", notificationRoutes); // In-app notifications
app.use("/api", logRoutes); // Project logs & registers
app.use("/api", reportRoutes); // Reports (status summary, budget vs actual, RFI/submittal logs, daily log rollup)
app.use("/api", billingRoutes); // Billing (pay applications, lien waivers)
app.use("/api", propertyRoutes); // Facilities: Properties (/api/properties) & Assets
app.use("/api", workOrderRoutes); // Facilities: Work Orders & PM Schedules
app.use("/api", vendorRoutes); // Facilities: Vendors (/api/vendors) & Vendor Contracts
app.use("/api", inspectionRoutes); // Facilities: Inspections & Compliance
app.use("/api", timeEntryRoutes); // Projects: Time Tracking
app.use("/api", approvalRoutes); // Projects: Approvals

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Not found." });
});

// Centralized error handler (catches anything thrown synchronously in routes)
app.use((err, req, res, next) => {
  console.error("[radah-pm] Unhandled error:", err);
  res.status(500).json({ error: "Something went wrong on our end." });
});

app.listen(PORT, () => {
  console.log(`[radah-pm] Backend listening on port ${PORT}`);
});
