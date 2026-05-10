const jwt = require("jsonwebtoken");
const AUTH_COOKIE_NAME = process.env.AUTH_COOKIE_NAME || "healthassist_token";

function readCookieToken(req) {
  const raw = String(req.headers.cookie || "");
  if (!raw) return "";

  for (const part of raw.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === AUTH_COOKIE_NAME) {
      return decodeURIComponent(rest.join("="));
    }
  }

  return "";
}

function readAuthorizationToken(req) {
  const auth = req.headers.authorization || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : "";
}

function verifyRequestToken(req, res, next, token) {
  if (!token) return res.status(401).json({ error: "unauthorized" });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    return next();
  } catch {
    return res.status(401).json({ error: "unauthorized" });
  }
}

function requireJwt(req, res, next) {
  return verifyRequestToken(req, res, next, readAuthorizationToken(req) || readCookieToken(req));
}

function requireJwtFromQuery(req, res, next) {
  return verifyRequestToken(
    req,
    res,
    next,
    readAuthorizationToken(req) || String(req.query.token || "") || readCookieToken(req)
  );
}

module.exports = { requireJwt, requireJwtFromQuery };
