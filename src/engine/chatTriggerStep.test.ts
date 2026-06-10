/**
 * HEL-678: chat trigger — unit tests.
 *
 * Hoists the chat payload (`{ message, sessionId, userId }`) to first-class
 * context, falls back to top-level `chat*` keys, and surfaces safe nulls when
 * the payload is absent or not an object.
 */

import { handleChatTrigger } from "./chatTriggerStep";

describe("handleChatTrigger (HEL-678)", () => {
  it("hoists the chat payload fields", () => {
    const out = handleChatTrigger({ chat: { message: "hi", sessionId: "s1", userId: "u1" } });
    expect(out).toMatchObject({ chatMessage: "hi", chatSessionId: "s1", chatUserId: "u1" });
    expect(out.chat).toMatchObject({ message: "hi" });
  });

  it("falls back to top-level chat* context keys", () => {
    const out = handleChatTrigger({ chatMessage: "yo", chatSessionId: "s2" });
    expect(out.chatMessage).toBe("yo");
    expect(out.chatSessionId).toBe("s2");
    expect(out.chatUserId).toBeNull();
  });

  it("surfaces safe nulls when there is no payload", () => {
    const out = handleChatTrigger({});
    expect(out).toEqual({ chat: {}, chatMessage: null, chatSessionId: null, chatUserId: null });
  });

  it("ignores a non-object chat value", () => {
    const out = handleChatTrigger({ chat: "nope" });
    expect(out.chat).toEqual({});
    expect(out.chatMessage).toBeNull();
  });
});
