const jwt = require("jsonwebtoken");

function requireJwt(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: "unauthorized" });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: "unauthorized" });
  }
}

function requireJwtFromQuery(req, res, next) {
  const token =
    (req.headers.authorization || "").startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : String(req.query.token || "");

  if (!token) return res.status(401).json({ error: "unauthorized" });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: "unauthorized" });
  }
}

module.exports = { requireJwt, requireJwtFromQuery };
