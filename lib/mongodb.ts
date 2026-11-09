import "server-only";
import { attachDatabasePool } from "@vercel/functions";
import { MongoClient, type Db } from "mongodb";

// One client (and its connection pool) per server instance. Warm serverless
// invocations and dev hot reloads reuse it instead of opening new connections.
const globalForMongo = globalThis as typeof globalThis & {
  __repostBingoMongoClient?: MongoClient;
};

function requireUri(): string {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      "MONGODB_URI is not set. Copy .env.example to .env.local and add your Atlas connection string.",
    );
  }
  return uri;
}

export function getMongoClient(): MongoClient {
  if (!globalForMongo.__repostBingoMongoClient) {
    const client = new MongoClient(requireUri(), {
      appName: "repost.bingo website",
      maxPoolSize: 10,
      // Close idle sockets quickly; attachDatabasePool keeps the function alive until they are.
      maxIdleTimeMS: 5_000,
      // Fail fast so the page and API can show a friendly error instead of hanging.
      serverSelectionTimeoutMS: 5_000,
    });
    // On Vercel Fluid compute this releases idle pool connections cleanly before
    // the instance suspends. Outside Vercel it does nothing.
    attachDatabasePool(client);
    globalForMongo.__repostBingoMongoClient = client;
  }
  return globalForMongo.__repostBingoMongoClient;
}

/**
 * The shared database (the same one the bot uses), named in the MONGODB_URI
 * path, e.g. mongodb+srv://user:pass@cluster.mongodb.net/repost_bingo?retryWrites=true.
 * Without a name the driver would silently use "test", so that is an error here.
 */
export function getDb(): Db {
  const name = databaseNameFromUri(requireUri());
  if (!name) {
    throw new Error(
      "MONGODB_URI has no database name. Add it after the host, e.g. ...mongodb.net/repost_bingo?retryWrites=true, and use the same database as the bot.",
    );
  }
  return getMongoClient().db(name);
}

/** The database name from a mongodb:// or mongodb+srv:// connection string, if it has one. */
export function databaseNameFromUri(uri: string): string | null {
  const match = /^mongodb(?:\+srv)?:\/\/([^?#]*)/i.exec(uri.trim());
  if (!match) return null;
  // Credentials end at the last "@" (an "@" inside a password must be percent-encoded).
  const afterCredentials = match[1].slice(match[1].lastIndexOf("@") + 1);
  const slash = afterCredentials.indexOf("/");
  if (slash === -1) return null;
  const name = decodeURIComponent(afterCredentials.slice(slash + 1));
  return name === "" ? null : name;
}
