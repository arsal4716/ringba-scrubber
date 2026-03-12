"use strict";

/**
 * POST /api/auth/login
 * Body: { password: string }
 *
 * Password is set via ADMIN_PASSWORD env var.
 * Falls back to "admin123" if not set (change this in production!).
 */
const login = async (req, res) => {
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ error: "Password is required" });
  }

  const adminPassword = process.env.ADMIN_PASSWORD || "admin123";

  if (password !== adminPassword) {
    // Small delay to slow brute-force attempts
    await new Promise((r) => setTimeout(r, 500));
    return res.status(401).json({ error: "Incorrect password" });
  }

  res.json({ success: true });
};

module.exports = { login };
