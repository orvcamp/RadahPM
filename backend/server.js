// backend/server.js

require("dotenv").config();
const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const projectRoutes = require("./routes/projects");
const phaseRoutes = require("./routes/phases");
const taskRoutes = require("./routes/tasks");
const documentRoutes = require("./routes/documents");
const budgetRoutes = require("./routes/budget");

const app = express();
const PORT = process.env.PORT || 4000;

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
app.use(express.json());

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
