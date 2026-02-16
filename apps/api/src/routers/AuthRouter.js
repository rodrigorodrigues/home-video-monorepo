import express from "express";
import { AUTH_USER, validateCredentials } from "../auth/user";
import * as defaultTokenService from "../auth/tokenService";
import { buildCookieOptions } from "../auth/cookiePolicy";
import { createAuthSessionService } from "../auth/authSessionService";
import config from "../config";
import crypto from "crypto";
import { getCookie } from "../common/Util";
import { ensureCsrf } from "../middleware/csrf";

const COOKIE_ACCESS = "access_token";
const COOKIE_REFRESH = "refresh_token";
const COOKIE_CSRF = "csrf_token";

export function createAuthRouter({
  refreshTokenStore,
  tokenService = defaultTokenService,
  authSessionService = createAuthSessionService({
    tokenService,
    refreshTokenStore,
  }),
}) {
  const router = express.Router();
  const cfg = config();

  router.post("/login", async (req, res) => {
    const { username, password } = req.body || {};
    const isValid = await validateCredentials({ username, password });
    if (!isValid) {
      return res.status(401).json({ message: "Invalid credentials" }).end();
    }

    const { accessToken, refreshToken, jti, refreshExpiresAtMs } =
      tokenService.issueTokens({
        userId: AUTH_USER.id,
        username: AUTH_USER.username,
      });

    refreshTokenStore.save({
      jti,
      userId: AUTH_USER.id,
      expiresAtMs: refreshExpiresAtMs,
    });

    const csrfToken = crypto.randomBytes(32).toString("hex");
    res.cookie(
      COOKIE_ACCESS,
      accessToken,
      buildCookieOptions({ isHttpOnly: true, cfg })
    );
    res.cookie(
      COOKIE_REFRESH,
      refreshToken,
      buildCookieOptions({ isHttpOnly: true, path: "/auth", cfg })
    );
    res.cookie(
      COOKIE_CSRF,
      csrfToken,
      buildCookieOptions({ isHttpOnly: false, cfg })
    );

    return res.status(200).json({ accessToken }).end();
  });

  router.post("/refresh", (req, res) => {
    const { refreshToken: refreshTokenBody } = req.body || {};
    const refreshToken =
      refreshTokenBody || getCookie(req, COOKIE_REFRESH);
    if (!refreshToken) {
      return res.status(400).json({ message: "Missing refresh token" }).end();
    }

    if (
      !refreshTokenBody &&
      !ensureCsrf({ req, res, cookieName: COOKIE_CSRF })
    ) {
      return;
    }

    const refreshResult = authSessionService.rotateRefreshSession({
      refreshToken,
      username: AUTH_USER.username,
    });
    if (!refreshResult.ok) {
      return res
        .status(refreshResult.status)
        .json({ message: refreshResult.message })
        .end();
    }

    const csrfToken = crypto.randomBytes(32).toString("hex");
    res.cookie(
      COOKIE_ACCESS,
      refreshResult.accessToken,
      buildCookieOptions({ isHttpOnly: true, cfg })
    );
    res.cookie(
      COOKIE_REFRESH,
      refreshResult.refreshToken,
      buildCookieOptions({ isHttpOnly: true, path: "/auth", cfg })
    );
    res.cookie(
      COOKIE_CSRF,
      csrfToken,
      buildCookieOptions({ isHttpOnly: false, cfg })
    );

    return res.status(200).json({ accessToken: refreshResult.accessToken }).end();
  });

  router.post("/logout", (req, res) => {
    const { refreshToken: refreshTokenBody } = req.body || {};
    const refreshToken =
      refreshTokenBody || getCookie(req, COOKIE_REFRESH);
    if (!refreshToken) {
      return res.status(400).json({ message: "Missing refresh token" }).end();
    }

    if (
      !refreshTokenBody &&
      !ensureCsrf({ req, res, cookieName: COOKIE_CSRF })
    ) {
      return;
    }

    authSessionService.revokeRefreshSession({ refreshToken });

    res.clearCookie(COOKIE_ACCESS, buildCookieOptions({ isHttpOnly: true, cfg }));
    res.clearCookie(
      COOKIE_REFRESH,
      buildCookieOptions({ isHttpOnly: true, path: "/auth", cfg })
    );
    res.clearCookie(COOKIE_CSRF, buildCookieOptions({ isHttpOnly: false, cfg }));
    return res.status(200).json({ message: "Logged out" }).end();
  });

  return router;
}
