import { gitlabModelMappings } from "./gitlabModelMappings";
import { sha256 } from "@/utils/hash";

describe("gitlabModelMappings", () => {
  describe("gitlabModelMappings", () => {
    it("retains every alias and protocol from the verified 6.23.1 table without loading the old SDK (https://github.com/ItsDalk-Lane/Scribe/issues/8)", () => {
      expect(sha256(JSON.stringify(gitlabModelMappings))).toBe(
        "45e619d610476b520be7af8dda882ece256ffc6a2e76db7d58b8fcc9f4b8878d"
      );
      expect(Object.keys(gitlabModelMappings)).toHaveLength(44);
    });
  });
});
