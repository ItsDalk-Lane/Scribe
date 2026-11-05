import { stripChatImageReceipts } from "./chatImagePersistence";

describe("chatImagePersistence", () => {
  describe("stripChatImageReceipts()", () => {
    it("keeps image embeds when reading a previously saved chat note", () => {
      const receipt = `<!-- scribe-image:${"a".repeat(64)} -->\n![[old-image.png]]\n<!-- /scribe-image -->`;
      expect(stripChatImageReceipts(`hello\n${receipt}`)).toBe("hello\n![[old-image.png]]");
    });
    it("keeps ordinary note contents unchanged", () => {
      expect(stripChatImageReceipts("hello ![[image.png]]")).toBe("hello ![[image.png]]");
    });
  });
});
