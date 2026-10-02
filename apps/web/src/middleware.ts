import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";

const { auth } = NextAuth(authConfig);

const PUBLIC = [/^\/login(\/admin|\/once\/[A-Za-z0-9_-]{1,80})?$/, /^\/branding\/[a-z]+-[0-9a-f]{12}\.(png|webp|svg)$/, /^\/join\/[^/]+(\/.*)?$/, /^\/api\/auth\//, /^\/api\/health$/, /^\/api\/version$/, /^\/api\/modpack\/(manifest|extras)$/, /^\/downloads\//, /^\/api\/launcher\//, /^\/api\/installer\/report$/, /^\/api\/play\/wake$/, /^\/api\/app\/(home|start|updates)$/, /^\/api\/polls\/[A-Za-z0-9_-]{1,40}\/vote$/, /^\/news-image\/[^/]+$/];

export default auth((req) => {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((re) => re.test(pathname))) return NextResponse.next();
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
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt|.*\\.(?:png|jpg|svg|webp|ico)$).*)"],
};
