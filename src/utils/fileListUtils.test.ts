import { getFileIdentityKey } from "@/utils/fileListUtils";

describe("fileListUtils", () => {
  describe("getFileIdentityKey()", () => {
    it("differs for files that differ only in MIME type", () => {
      const pngFile = new File(["image"], "image", { type: "image/png", lastModified: 123 });
      const jpegFile = new File(["image"], "image", { type: "image/jpeg", lastModified: 123 });

      expect(getFileIdentityKey(pngFile)).not.toBe(getFileIdentityKey(jpegFile));
    });
  });
});
