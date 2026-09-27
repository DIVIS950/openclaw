import { NextResponse } from "next/server";
import { googleEnabled, handlers } from "@/auth";

const disabled = () => NextResponse.json({ error: "Google sign-in is not configured" }, { status: 404 });

export const GET = googleEnabled ? handlers.GET : disabled;
export const POST = googleEnabled ? handlers.POST : disabled;
