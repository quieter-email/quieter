import { getAuthUserStatus } from "@quietr/auth/user-status";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const email = searchParams.get("email");

  if (!email) {
    return NextResponse.json({ message: "Email is required." }, { status: 400 });
  }

  return NextResponse.json(await getAuthUserStatus(email));
}
