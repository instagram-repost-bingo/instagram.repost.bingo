import { randomUUID } from "node:crypto";
import { MongoClient, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";

/** Starts a throwaway MongoDB for integration tests. Each test gets its own database. */
export async function startTestMongo() {
  const server = await MongoMemoryServer.create();
  const client = await MongoClient.connect(server.getUri());
  return {
    freshDb(): Db {
      return client.db(`test_${randomUUID().replaceAll("-", "")}`);
    },
    async stop() {
      await client.close();
      await server.stop();
    },
  };
}
