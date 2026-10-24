import setupDatabase from "../src/test/global-setup-db";

export default async function globalSetup() {
  await setupDatabase();
}
