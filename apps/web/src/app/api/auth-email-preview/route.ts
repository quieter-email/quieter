import { getAuthEmailPreview } from "@quietr/auth/email-placeholder";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const email = searchParams.get("email");

  if (!email) {
    return NextResponse.json({ message: "Email is required." }, { status: 400 });
  }

  const preview = getAuthEmailPreview(email);

  if (!preview) {
    return NextResponse.json({ message: "No preview found." }, { status: 404 });
  }

  return NextResponse.json(preview);
}
