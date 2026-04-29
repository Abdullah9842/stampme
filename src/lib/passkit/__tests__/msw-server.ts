import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

export const handlers = {
  authOk: http.post("https://api.pub1.passkit.io/auth/refresh", () =>
    HttpResponse.json({ token: "test-jwt", expiresIn: 3600 }),
  ),
};

export const server = setupServer(handlers.authOk);
