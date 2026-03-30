import { NextResponse } from "next/server";
import { getApp, getAppSecrets, setAppSecret, deleteAppSecret } from "@/lib/db";
import { v4 as uuid } from "uuid";
import { getSession } from "@/lib/auth";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/apps/[id]/secrets - List secrets (keys + masked values)
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const app = await getApp(session.userId, id);
    if (!app) {
      return NextResponse.json({ error: "App not found" }, { status: 404 });
    }

    const secrets = await getAppSecrets(id);
    return NextResponse.json(secrets.map(s => ({
      key: s.key,
      value: s.value,
      created_at: s.created_at,
      updated_at: s.updated_at,
    })));
  } catch (error) {
    console.error("Error fetching app secrets:", error);
    return NextResponse.json({ error: "Failed to fetch secrets" }, { status: 500 });
  }
}

// POST /api/apps/[id]/secrets - Create or update a secret
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const app = await getApp(session.userId, id);
    if (!app) {
      return NextResponse.json({ error: "App not found" }, { status: 404 });
    }

    const { key, value } = await request.json();
    if (!key || typeof key !== 'string') {
      return NextResponse.json({ error: "Key is required" }, { status: 400 });
    }
    if (value === undefined || typeof value !== 'string') {
      return NextResponse.json({ error: "Value is required" }, { status: 400 });
    }

    // Validate key format: uppercase letters, numbers, underscores
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
      return NextResponse.json({ error: "Key must be uppercase letters, numbers, and underscores, starting with a letter" }, { status: 400 });
    }

    // Validate secret value: reject control characters (prevents systemd-run env injection) and enforce length limit
    if (value.length > 2000) {
      return NextResponse.json({ error: "Value must be 2000 characters or less" }, { status: 400 });
    }
    if (/[\x00-\x1f\x7f]/.test(value)) {
      return NextResponse.json({ error: "Value must not contain control characters (including newlines)" }, { status: 400 });
    }

    await setAppSecret(uuid(), id, key, value);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error setting app secret:", error);
    return NextResponse.json({ error: "Failed to set secret" }, { status: 500 });
  }
}

// DELETE /api/apps/[id]/secrets - Delete a secret
export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const app = await getApp(session.userId, id);
    if (!app) {
      return NextResponse.json({ error: "App not found" }, { status: 404 });
    }

    const { key } = await request.json();
    if (!key || typeof key !== 'string') {
      return NextResponse.json({ error: "Key is required" }, { status: 400 });
    }

    await deleteAppSecret(id, key);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting app secret:", error);
    return NextResponse.json({ error: "Failed to delete secret" }, { status: 500 });
  }
}
