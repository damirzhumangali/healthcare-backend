function requireOperator(req, res, next) {
  const role = req.user?.role;
  const adminEmails = String(process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  const email = String(req.user?.email || "").toLowerCase();

  const allowedByRole = role === "admin" || role === "operator";
  const allowedByEmail = email && adminEmails.includes(email);

  if (!allowedByRole && !allowedByEmail) {
    return res.status(403).json({ error: "forbidden" });
  }
  return next();
}

module.exports = { requireOperator };
