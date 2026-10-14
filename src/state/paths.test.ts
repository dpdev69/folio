import { describe, expect, it } from "vitest";
import { insideRoot, pathKey, samePath } from "./paths";

describe("path keys", () => {
  it("drops trailing and repeated slashes", () => {
    expect(pathKey("/Users/me/book/")).toBe("/Users/me/book");
    expect(pathKey("/Users//me///book")).toBe("/Users/me/book");
    expect(pathKey("/")).toBe("/");
  });

  it("reads /private/tmp and /tmp as the same place, and the same for /var and /etc", () => {
    expect(samePath("/private/tmp/repo", "/tmp/repo/")).toBe(true);
    expect(samePath("/private/var/folders/x", "/var/folders/x")).toBe(true);
    expect(pathKey("/private/tmp")).toBe("/tmp");
    expect(samePath("/private/tmpfiles/a", "/tmpfiles/a")).toBe(false);
  });

  it("makes Windows separators forward and ignores a Windows path's case", () => {
    expect(pathKey("C:\\Users\\Me\\Book\\")).toBe("c:/users/me/book");
    expect(samePath("c:/users/me/book", "C:\\Users\\ME\\Book")).toBe(true);
    expect(pathKey("C:\\")).toBe("c:/");
    expect(pathKey("\\\\server\\Share\\Book")).toBe("//server/share/book");
  });

  it("keeps a macOS or Linux path's case", () => {
    expect(samePath("/Users/me/Book", "/Users/me/book")).toBe(false);
  });

  it("says nothing is the same as a missing path", () => {
    expect(samePath(undefined, "/a")).toBe(false);
  });
});

describe("a file inside the book", () => {
  it("is named from the root, however the root was written", () => {
    expect(insideRoot("/private/tmp/repo/src/a.ts", "/tmp/repo/")).toBe("src/a.ts");
    expect(insideRoot("C:\\Work\\Repo\\src\\A.ts", "c:/work/repo")).toBe("src/A.ts");
  });

  it("is nothing when it is the root or lies outside it", () => {
    expect(insideRoot("/tmp/repo", "/private/tmp/repo")).toBeUndefined();
    expect(insideRoot("/tmp/repository/a.ts", "/tmp/repo")).toBeUndefined();
  });
});
