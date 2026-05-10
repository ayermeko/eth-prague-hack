// services/rugcheck-mcp/src/tools/scrape-x-mentions.ts
import type { PaymentEvent } from '@rugsleuth/x402-client';
import type { ApifyActorClient } from '../apify-client.js';
import { emit } from '../events.js';

export interface ScrapeXMentionsInput {
  address: string;
  actorClient: ApifyActorClient;
  actorId: string;
  linkedHandle?: string | null;
  maxTweets?: number;
}

export interface XTweet {
  author: string;
  handle: string;
  text: string;
  url: string;
  createdAt: string;
  likeCount: number;
  replyCount: number;
}

export interface ScrapeXMentionsOutput {
  address: string;
  literalMentions: XTweet[];
  authoredByLinkedHandle: XTweet[];
  facts: { mentionCount: number; linkedHandle: string | null };
  payments: PaymentEvent[];
}

type RawTweet = {
  user?: { name?: string; username?: string };
  text?: string;
  url?: string;
  createdAt?: string;
  likeCount?: number;
  replyCount?: number;
};

function normalize(raw: RawTweet[]): XTweet[] {
  return raw
    .filter((t) => typeof t.text === 'string' && typeof t.url === 'string')
    .map((t) => ({
      author: t.user?.name ?? '',
      handle: t.user?.username ?? '',
      text: t.text ?? '',
      url: t.url ?? '',
      createdAt: t.createdAt ?? '',
      likeCount: typeof t.likeCount === 'number' ? t.likeCount : 0,
      replyCount: typeof t.replyCount === 'number' ? t.replyCount : 0,
    }));
}

export async function scrapeXMentions(
  input: ScrapeXMentionsInput,
): Promise<ScrapeXMentionsOutput> {
  const tool = 'scrape_x_mentions';
  const start = Date.now();
  const linkedHandle = input.linkedHandle ?? null;
  const maxTweets = input.maxTweets ?? 25;

  emit({
    kind: 'tool.start',
    tool,
    args: { address: input.address, linkedHandle, maxTweets },
  });

  try {
    const literalRun = await input.actorClient.runActor<RawTweet[]>({
      actorId: input.actorId,
      input: { searchTerms: [`"${input.address}"`], maxTweets },
    });

    let handleRun: { result: RawTweet[]; payments: PaymentEvent[] } | null = null;
    if (linkedHandle) {
      handleRun = await input.actorClient.runActor<RawTweet[]>({
        actorId: input.actorId,
        input: { searchTerms: [`from:${linkedHandle}`], maxTweets },
      });
    }

    const literal = normalize(literalRun.result ?? []);
    const authored = handleRun ? normalize(handleRun.result ?? []) : [];
    const payments = [...literalRun.payments, ...(handleRun?.payments ?? [])];

    for (const p of payments) {
      emit({
        kind: 'payment',
        tool,
        status: p.status,
        amountUsdc: p.amountUsdc,
        payTo: p.payTo,
        ppeEvent: p.ppeEvent,
        error: p.error,
      });
    }

    emit({ kind: 'tool.end', tool, ok: true, ms: Date.now() - start });
    return {
      address: input.address,
      literalMentions: literal,
      authoredByLinkedHandle: authored,
      facts: { mentionCount: literal.length, linkedHandle },
      payments,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ kind: 'tool.end', tool, ok: false, error: message, ms: Date.now() - start });
    return {
      address: input.address,
      literalMentions: [],
      authoredByLinkedHandle: [],
      facts: { mentionCount: 0, linkedHandle },
      payments: [],
    };
  }
}
