import { handleChatStream } from '@mastra/ai-sdk';
import { toAISdkV5Messages } from '@mastra/ai-sdk/ui';
import { createUIMessageStreamResponse } from 'ai';
import { NextResponse } from 'next/server';
import { mastra } from '@/mastra';

const THREAD_ID = 'hello-world-thread';
const RESOURCE_ID = 'hello-world-user';

export async function POST(req: Request) {
  const params = await req.json();
  const stream = await handleChatStream({
    mastra,
    agentId: 'weather-agent',
    params: {
      ...params,
      memory: {
        ...params.memory,
        thread: THREAD_ID,
        resource: RESOURCE_ID,
      },
    },
  });
  // Runtime-compatible cast: @mastra/ai-sdk@1.4.x and ai@6 ship structurally-divergent UIMessage types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createUIMessageStreamResponse({ stream: stream as any });
}

export async function GET() {
  const memory = await mastra.getAgentById('weather-agent').getMemory();
  let response = null;

  try {
    response = await memory?.recall({
      threadId: THREAD_ID,
      resourceId: RESOURCE_ID,
    });
  } catch {
    // No previous messages — first run.
  }

  return NextResponse.json(toAISdkV5Messages(response?.messages || []));
}
