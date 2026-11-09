import { describe, expect, it } from "vitest";
import { DEFAULT_DB_NAME, databaseNameFromUri, resolveDatabaseName } from "@/lib/mongodb";

describe("resolveDatabaseName", () => {
  it("uses the database named in the connection string", () => {
    expect(resolveDatabaseName("mongodb+srv://u:p@cluster.l6a04mp.mongodb.net/shared_db?retryWrites=true")).toBe(
      "shared_db",
    );
  });

  it("falls back to repost_bingo (not the driver's 'test') when the string has no database", () => {
    expect(DEFAULT_DB_NAME).toBe("repost_bingo");
    expect(resolveDatabaseName("mongodb+srv://u:p@cluster.l6a04mp.mongodb.net")).toBe("repost_bingo");
    expect(resolveDatabaseName("mongodb+srv://u:p@cluster.l6a04mp.mongodb.net/?retryWrites=true")).toBe("repost_bingo");
  });
});

describe("databaseNameFromUri", () => {
  it.each<[string, string | null]>([
    ["mongodb+srv://user:pass@cluster0.ab1cd.mongodb.net/repost_bingo?retryWrites=true&w=majority", "repost_bingo"],
    ["mongodb://user:pass@host1:27017,host2:27017/repost_bingo?replicaSet=rs0", "repost_bingo"],
    ["mongodb://localhost:27017/repost_bingo", "repost_bingo"],
    ["mongodb://user:p%40ss%2Fword@localhost/shared", "shared"],
    ["mongodb+srv://user:pass@cluster0.ab1cd.mongodb.net/?retryWrites=true", null],
    ["mongodb+srv://user:pass@cluster0.ab1cd.mongodb.net", null],
    ["mongodb://localhost:27017/", null],
    ["postgres://localhost/repost_bingo", null],
  ])("%s -> %s", (uri, expected) => {
    expect(databaseNameFromUri(uri)).toBe(expected);
  });
});
