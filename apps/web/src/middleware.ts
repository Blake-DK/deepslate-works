import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";
import { appTokenRequest } from "@/lib/test-app-paths";

const { auth } = NextAuth(authConfig);

const PUBLIC = [/^\/login(\/admin|\/once\/[A-Za-z0-9_-]{1,80})?$/, /^\/branding\/[a-z]+-[0-9a-f]{12}\.(png|webp|svg)$/, /^\/join\/[^/]+(\/.*)?$/, /^\/api\/auth\//, /^\/api\/health(\/live)?$/, /^\/api\/version$/, /^\/api\/modpack\/(manifest|extras)$/, /^\/downloads\//, /^\/api\/launcher\//, /^\/api\/installer\/report$/, /^\/api\/play\/wake$/, /^\/api\/app\/(home|start|updates)$/, /^\/api\/app\/head\/[0-9A-Fa-f-]{32,36}\.png$/, /^\/api\/polls\/[A-Za-z0-9_-]{1,40}\/vote$/, /^\/news-image\/[^/]+$/, /^\/brand\/fonts\/[A-Za-z-]+\.(ttf|txt)$/];

export default auth((req) => {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/_next/image")) return new NextResponse(null, { status: 404 }); // the optimiser is off (next.config.ts)
  if (PUBLIC.some((re) => re.test(pathname))) return NextResponse.next();
  // docs/45: the launcher's Test section. Only an app's request (a launcher token) goes through to the routes, which
  // check the token's user is an admin and answer anyone else as this middleware answers a path that does not exist.
  if (appTokenRequest(pathname, req.headers.get("authorization"))) return NextResponse.next();
  if (!req.auth?.user) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: { code: "unauthorized", message: "Sign in first" } }, { status: 401 });
    }
    const login = new URL("/login", req.nextUrl);
    if (pathname !== "/") login.searchParams.set("next", pathname + req.nextUrl.search); // e.g. /join?code=ABC123
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|favicon.ico|icon.svg|robots.txt|.*\\.(?:png|jpg|svg|webp|ico)$).*)"],
};
