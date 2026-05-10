import { describe, expect, it, vi } from 'vitest';
import { scrapeXMentions } from '../src/tools/scrape-x-mentions.js';

describe('scrape_x_mentions', () => {
  it('runs the literal-address query and returns mentions + payments', async () => {
    const actorClient = {
      runActor: vi.fn().mockResolvedValueOnce({
        result: [
          {
            user: { name: 'Alice', username: 'alice' },
            text: 'pump 0xabc to the moon',
            url: 'https://x.com/alice/status/1',
            createdAt: '2026-05-01T00:00:00Z',
            likeCount: 3,
            replyCount: 0,
          },
        ],
        payments: [
          {
            id: 'p1',
            status: 'settled' as const,
            amountUsdc: '0.04',
            payTo: '0xbee',
            ppeEvent: 'tweet-fetched',
            ts: '2026-05-01T00:00:00Z',
          },
        ],
      }),
    };

    const out = await scrapeXMentions({
      address: '0xabc',
      actorClient,
      actorId: 'apidojo/twitter-scraper-lite',
      linkedHandle: null,
      maxTweets: 25,
    });

    expect(out.address).toBe('0xabc');
    expect(out.literalMentions).toHaveLength(1);
    expect(out.literalMentions[0]).toEqual({
      author: 'Alice',
      handle: 'alice',
      text: 'pump 0xabc to the moon',
      url: 'https://x.com/alice/status/1',
      createdAt: '2026-05-01T00:00:00Z',
      likeCount: 3,
      replyCount: 0,
    });
    expect(out.authoredByLinkedHandle).toEqual([]);
    expect(out.facts).toEqual({ mentionCount: 1, linkedHandle: null });
    expect(out.payments).toHaveLength(1);
    expect(actorClient.runActor).toHaveBeenCalledTimes(1);
  });

  it('runs the from:handle query when linkedHandle is provided', async () => {
    const actorClient = {
      runActor: vi
        .fn()
        .mockResolvedValueOnce({ result: [], payments: [] })
        .mockResolvedValueOnce({
          result: [
            {
              user: { name: 'Dev', username: 'dev' },
              text: 'shipping a new contract today',
              url: 'https://x.com/dev/status/2',
              createdAt: '2026-05-02T00:00:00Z',
              likeCount: 0,
              replyCount: 0,
            },
          ],
          payments: [],
        }),
    };

    const out = await scrapeXMentions({
      address: '0xabc',
      actorClient,
      actorId: 'apidojo/twitter-scraper-lite',
      linkedHandle: 'dev',
      maxTweets: 25,
    });

    expect(actorClient.runActor).toHaveBeenCalledTimes(2);
    expect(out.authoredByLinkedHandle).toHaveLength(1);
    expect(out.facts.linkedHandle).toBe('dev');
  });

  it('emits ok=false on Actor failure and returns empty arrays', async () => {
    const actorClient = {
      runActor: vi.fn().mockRejectedValue(new Error('actor blew up')),
    };

    const out = await scrapeXMentions({
      address: '0xabc',
      actorClient,
      actorId: 'apidojo/twitter-scraper-lite',
      linkedHandle: null,
    });

    expect(out.literalMentions).toEqual([]);
    expect(out.authoredByLinkedHandle).toEqual([]);
    expect(out.payments).toEqual([]);
    expect(out.facts.mentionCount).toBe(0);
  });
});
