import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashAutopart216vUpload } from "@/server/purchasing/backorder-import";
import { AUTOPART_216V_HEADER } from "@/domain/autopart-216v-fixture";

describe("hashAutopart216vUpload", () => {
  const textA = `${AUTOPART_216V_HEADER}\n"SB1","ACC","Name","","PART","Desc","","REF","2","1.00","2.00"\n`;
  const textB = `${AUTOPART_216V_HEADER}\n"SB1","ACC","Name","","PART","Desc","","REF","9","1.00","9.00"\n`;

  it("hashes raw upload bytes, not filename or report date", () => {
    const bytes = Buffer.from(textA, "utf8");
    const fromBytes = hashAutopart216vUpload({ bytes, text: textA });
    const fromText = hashAutopart216vUpload({ bytes: null, text: textA });
    expect(fromBytes).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(fromText).toBe(createHash("sha256").update(textA).digest("hex"));
    expect(fromBytes).toBe(fromText);
  });

  it("changes when outstanding quantities change", () => {
    expect(hashAutopart216vUpload({ bytes: null, text: textA })).not.toBe(
      hashAutopart216vUpload({ bytes: null, text: textB }),
    );
  });
});
