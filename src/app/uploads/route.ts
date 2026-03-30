import { NextResponse } from "next/server";

// Block directory listing / enumeration on /uploads/
export async function GET() {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
