function adminEmails() {
  return String(process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

function isAdminUser(user) {
  const role = user?.role;
  const email = String(user?.email || "").toLowerCase();
  return role === "admin" || (email && adminEmails().includes(email));
}

function requireOperator(req, res, next) {
  const role = req.user?.role;
  const allowedByRole = role === "admin" || role === "operator";
  const allowedByEmail = isAdminUser(req.user);

  if (!allowedByRole && !allowedByEmail) {
    return res.status(403).json({ error: "forbidden" });
  }
  return next();
}

function requireAdmin(req, res, next) {
  if (!isAdminUser(req.user)) {
    return res.status(403).json({ error: "forbidden" });
  }
  return next();
}

module.exports = { isAdminUser, requireOperator, requireAdmin };
