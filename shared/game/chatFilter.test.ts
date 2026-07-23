import { describe, expect, it } from "vitest";
import { containsProfanity, screenText } from "./chatFilter";

describe("clean text passes through untouched", () => {
  it.each([
    "hey where was everyone",
    "I saw red vent in electrical",
    "kim nerede",
    "ben taskları bitirdim, mavi şüpheli",
    "that was a classic play",
    "I got it, pass me the code",
    "the book was on the shelf",
    "he was in the class with us",
    "mass hit on the task bar",
    "sikke koleksiyonu topluyorum",
    "ağır siklet şampiyonu",
    "I love grapes",
    "we visited Scunthorpe last year",
  ])("leaves %j alone", (text) => {
    const result = screenText(text);
    expect(result.verdict).toBe("clean");
    expect(result.text).toBe(text);
  });
});

describe("plain profanity is masked, not dropped", () => {
  it("masks the offending token and keeps the rest readable", () => {
    const result = screenText("what the fuck was that");
    expect(result.verdict).toBe("masked");
    expect(result.text).toBe("what the **** was that");
    expect(result.matches).toContain("fuck");
  });

  it("preserves the original spacing", () => {
    expect(screenText("oh  shit   really").text).toBe("oh  ****   really");
  });
});

describe("evasions", () => {
  it.each([
    ["leetspeak", "sh1t"],
    ["punctuation", "f.u.c.k"],
    ["underscores", "f_u_c_k"],
    ["long repeats", "fuuuuuck"],
    ["short repeats", "fuuck"],
    ["mixed case", "FuCk"],
    ["symbols for letters", "$hit"],
  ])("catches %s: %j", (_label, text) => {
    expect(screenText(text).verdict).not.toBe("clean");
  });

  it("catches letters spaced apart", () => {
    expect(screenText("f u c k you").verdict).toBe("masked");
    expect(screenText("s h i t").verdict).toBe("masked");
  });

  it("catches a two-character split", () => {
    expect(screenText("fu ck off").verdict).toBe("masked");
  });

  it("never welds two ordinary words together", () => {
    // Both tokens are long enough that joining them would be a guess, not an
    // evasion — this is the rule that keeps "mass hit" out of the filter.
    expect(screenText("mass hit").verdict).toBe("clean");
    expect(screenText("class ic moment").verdict).toBe("clean");
  });
});

describe("slurs and harassment are blocked outright", () => {
  it("blocks a slur rather than masking it", () => {
    const result = screenText("you are a faggot");
    expect(result.verdict).toBe("blocked");
  });

  it("blocks slurs written with evasions", () => {
    expect(screenText("n1gger").verdict).toBe("blocked");
    expect(screenText("f a g g o t").verdict).toBe("blocked");
  });

  it("blocks multi-word harassment no single token would catch", () => {
    expect(screenText("just kill yourself").verdict).toBe("blocked");
    expect(screenText("kys").verdict).toBe("blocked");
  });

  it("blocking wins over masking in a mixed message", () => {
    expect(screenText("shit you faggot").verdict).toBe("blocked");
  });
});

describe("Turkish", () => {
  it.each(["siktir git", "orospu", "amk", "yarrak", "gerizekalı", "şerefsiz", "amcık"])(
    "flags %j",
    (text) => {
      expect(screenText(text).verdict).not.toBe("clean");
    },
  );

  it("folds Turkish letters, so diacritic spelling is caught too", () => {
    expect(screenText("şıktır").verdict).not.toBe("clean");
    expect(screenText("SİKTİR").verdict).not.toBe("clean");
  });

  it("treats Turkish slurs as blocking, not masking", () => {
    expect(screenText("orospu çocuğu").verdict).toBe("blocked");
    expect(screenText("ibne").verdict).toBe("blocked");
  });
});

describe("matches record the rule, never the player's text", () => {
  it("reports which root fired", () => {
    const result = screenText("f.u.c.k this");
    expect(result.matches).toEqual(["fuck"]);
  });

  it("deduplicates repeated hits", () => {
    const result = screenText("shit shit shit");
    expect(result.matches).toEqual(["shit"]);
  });
});

describe("containsProfanity (names)", () => {
  it("rejects anything the chat filter would mask or block", () => {
    expect(containsProfanity("shithead")).toBe(true);
    expect(containsProfanity("n1gger")).toBe(true);
    expect(containsProfanity("siktir")).toBe(true);
  });

  it("accepts ordinary names", () => {
    expect(containsProfanity("Ada")).toBe(false);
    expect(containsProfanity("Mehmet")).toBe(false);
    expect(containsProfanity("classic_gamer")).toBe(false);
  });
});

describe("edge cases", () => {
  it("handles an empty message", () => {
    expect(screenText("").verdict).toBe("clean");
  });

  it("handles a message that is only whitespace", () => {
    expect(screenText("   ").verdict).toBe("clean");
  });

  it("handles a message that is only punctuation", () => {
    expect(screenText("!!! ???").verdict).toBe("clean");
  });

  it("is not fooled by an already-masked message being re-screened", () => {
    const once = screenText("fuck off");
    expect(screenText(once.text).verdict).toBe("clean");
  });
});
