import express from "express";
import { AUTH_USER, validateCredentials } from "../auth/user";
import * as defaultTokenService from "../auth/tokenService";
import { createAuthCookieService } from "../auth/authCookieService";
import { generateCsrfToken } from "../auth/csrfToken";
import { createAuthLoginService } from "../auth/authLoginService";
import { createAuthSessionService } from "../auth/authSessionService";
import config from "../config";
import { getCookie } from "../common/Util";
import { ensureCsrf } from "../middleware/csrf";

const COOKIE_ACCESS = "access_token";
const COOKIE_REFRESH = "refresh_token";
const COOKIE_CSRF = "csrf_token";

export function createAuthRouter({
  refreshTokenStore,
  tokenService = defaultTokenService,
  csrfTokenGenerator = generateCsrfToken,
  authCookieService,
  authLoginService = createAuthLoginService({
    tokenService,
    refreshTokenStore,
  }),
  authSessionService = createAuthSessionService({
    tokenService,
    refreshTokenStore,
  }),
}) {
  const router = express.Router();
  const cfg = config();
  const cookies =
    authCookieService ||
    createAuthCookieService({
      cfg,
      cookieNames: {
        access: COOKIE_ACCESS,
        refresh: COOKIE_REFRESH,
        csrf: COOKIE_CSRF,
      },
    });

  router.post("/login", async (req, res) => {
    const { username, password } = req.body || {};
    const isValid = await validateCredentials({ username, password });
    if (!isValid) {
      return res.status(401).json({ message: "Invalid credentials" }).end();
    }

    const loginSession = authLoginService.createLoginSession({
      userId: AUTH_USER.id,
      username: AUTH_USER.username,
    });

    cookies.setAuthCookies({ res, session: loginSession });

    return res.status(200).json({ accessToken: loginSession.accessToken }).end();
  });

  router.post("/refresh", (req, res) => {
    const { refreshToken: refreshTokenBody } = req.body || {};
    const refreshToken = refreshTokenBody || getCookie(req, COOKIE_REFRESH);
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

    const session = {
      accessToken: refreshResult.accessToken,
      refreshToken: refreshResult.refreshToken,
      csrfToken: csrfTokenGenerator(),
    };
    cookies.setAuthCookies({ res, session });

    return res
      .status(200)
      .json({ accessToken: refreshResult.accessToken })
      .end();
  });

  router.post("/logout", (req, res) => {
    const { refreshToken: refreshTokenBody } = req.body || {};
    const refreshToken = refreshTokenBody || getCookie(req, COOKIE_REFRESH);
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

    cookies.clearAuthCookies(res);
    return res.status(200).json({ message: "Logged out" }).end();
  });

  return router;
}
