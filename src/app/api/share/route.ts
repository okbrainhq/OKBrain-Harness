import { NextResponse } from "next/server";
import { createSharedLink, getSharedLink, getSharedLinkByResource } from "@/lib/db";
import { getSession } from "@/lib/auth";
import crypto from "crypto";

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { type, resourceId } = await request.json();

    if (!type || !resourceId || !['conversation', 'document', 'snapshot'].includes(type)) {
      return NextResponse.json({ error: "Invalid type or resourceId" }, { status: 400 });
    }

    // Check if shared link already exists
    let sharedLink = await getSharedLinkByResource(session.userId, type, resourceId);

    if (!sharedLink) {
      let id: string;
      do {
        id = crypto.randomBytes(5).toString("hex");
      } while (await getSharedLink(id));
      sharedLink = await createSharedLink(session.userId, type, resourceId, id);
    }

    // Build share URL from APP_BASE_URL if configured, otherwise fall back to request headers
    let url: string;
    const appBaseUrl = process.env.APP_BASE_URL?.trim();
    if (appBaseUrl) {
      url = `${appBaseUrl.replace(/\/+$/, '')}/s/${sharedLink.id}`;
    } else {
      const protocol = request.headers.get("x-forwarded-proto") || "http";
      const host = request.headers.get("host");
      url = `${protocol}://${host}/s/${sharedLink.id}`;
    }

    return NextResponse.json({
      success: true,
      id: sharedLink.id,
      url
    });
  } catch (error) {
    console.error("Error creating shared link:", error);
    return NextResponse.json(
      { error: "Failed to create shared link" },
      { status: 500 }
    );
  }
}
