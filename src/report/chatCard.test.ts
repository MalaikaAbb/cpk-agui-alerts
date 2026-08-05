import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { paginate, type ChatMessage } from "./chatCard.js";

const BUDGET = 28_000;

const bytes = (m: ChatMessage) => new TextEncoder().encode(JSON.stringify(m)).length;

/** A message with `sections` sections of `linesEach` lines apiece. */
function message(sections: number, linesEach: number, lineLength = 120): ChatMessage {
  return {
    text: "summary",
    cardsV2: [
      {
        cardId: "repo",
        card: {
          header: { title: "owner/repo", subtitle: "sub" },
          sections: Array.from({ length: sections }, (_, s) => ({
            header: `section ${s}`,
            widgets: [
              {
                textParagraph: {
                  text: Array.from({ length: linesEach }, (_, l) =>
                    `s${s}L${l}`.padEnd(lineLength, "x"),
                  ).join("<br>"),
                },
              },
            ],
          })),
        },
      },
    ],
  };
}

/** Every rendered line across a set of messages. */
function allLines(messages: ChatMessage[]): string[] {
  return messages.flatMap((m) =>
    m.cardsV2.flatMap((c) =>
      c.card.sections.flatMap((s) =>
        s.widgets.flatMap((w) =>
          ("textParagraph" in w ? w.textParagraph.text : w.decoratedText.text).split("<br>"),
        ),
      ),
    ),
  );
}

describe("paginate — small payloads", () => {
  test("a message under budget is returned as one message", () => {
    const result = paginate(message(2, 5));

    assert.equal(result.length, 1);
    assert.ok(bytes(result[0] as ChatMessage) <= BUDGET);
  });

  test("the fallback text is preserved on a single message", () => {
    assert.equal(paginate(message(1, 1))[0]?.text, "summary");
  });
});

describe("paginate — overflow", () => {
  const big = message(40, 20);
  const result = paginate(big);

  test("splits into multiple messages", () => {
    assert.ok(result.length > 1, `expected a split, got ${result.length}`);
  });

  test("every message is within budget", () => {
    for (const [i, m] of result.entries()) {
      assert.ok(bytes(m) <= BUDGET, `message ${i + 1} is ${bytes(m)} bytes`);
    }
  });

  // The whole point of paginating rather than trimming.
  test("nothing is dropped and nothing is duplicated", () => {
    const before = allLines([big]);
    const after = allLines(result);

    assert.deepEqual(after.slice().sort(), before.slice().sort());
    assert.equal(new Set(after).size, after.length, "no line appears twice");
  });

  test("only the first message carries the notification text", () => {
    assert.equal(result[0]?.text, "summary");
    for (const m of result.slice(1)) assert.equal(m.text, undefined);
  });

  test("continuation messages are numbered", () => {
    assert.match(result[1]?.cardsV2[0]?.card.header.subtitle ?? "", /continued 2\/\d+/);
  });
});

describe("paginate — a single oversized section", () => {
  // One section far larger than the budget must split at line boundaries
  // rather than being emitted over-budget or truncated.
  const huge = message(1, 900);
  const result = paginate(huge);

  test("splits across messages", () => {
    assert.ok(result.length > 1);
  });

  test("stays within budget", () => {
    for (const m of result) assert.ok(bytes(m) <= BUDGET);
  });

  test("preserves every line", () => {
    assert.deepEqual(allLines(result).sort(), allLines([huge]).sort());
  });
});

describe("paginate — message ceiling", () => {
  test("caps runaway payloads at 10 messages", () => {
    // Far more content than the cap allows; the remainder stays buffered.
    assert.ok(paginate(message(400, 40)).length <= 10);
  });
});
