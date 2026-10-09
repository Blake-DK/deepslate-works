// docs/45: the launcher's Test section routes, and what lets an app's request reach them through the middleware: a
// launcher token. The routes themselves check the token's user is an admin (server/test-app.ts).
export const TEST_APP_PATH = /^\/api\/app\/test(\/(manifest|config\.zip|wake))?$/;
export const appTokenRequest = (pathname: string, authorization: string | null) => TEST_APP_PATH.test(pathname) && /^Bearer\s+\S{20,}$/i.test(authorization ?? "");
