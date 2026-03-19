import { NextRequest, NextResponse } from "next/server";
import { createChatStream } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      messages: Array<{ role: "user" | "assistant"; content: string }>;
      stockContext?: string;
    };

    const { messages, stockContext } = body;

    if (!messages?.length) {
      return NextResponse.json({ error: "No messages provided" }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
    if (!apiKey || apiKey === "your_anthropic_api_key_here") {
      return new Response(
        `data: {"delta":"I'm TradeVision AI, but the ANTHROPIC_API_KEY is not configured. Please add it to your .env.local file to enable AI-powered analysis. In the meantime, I can tell you that configuring your API key will unlock real-time market analysis, buy/sell signal generation, and this chat interface!"}\ndata: [DONE]\n\n`,
        {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        }
      );
    }

    // Build streaming response
    const stream = createChatStream(messages, stockContext);

    const readableStream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        try {
          for await (const event of stream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              const data = JSON.stringify({ delta: event.delta.text });
              controller.enqueue(encoder.encode(`data: ${data}\n\n`));
            }
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : "Unknown error";
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ delta: `Error: ${errMsg}` })}\n\n`
            )
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readableStream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    console.error("Chat route error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
