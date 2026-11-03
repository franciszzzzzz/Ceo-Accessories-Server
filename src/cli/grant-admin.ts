import { disconnectDatabase, connectDatabase } from "../config/database.js";
import { grantAdminByEmail } from "../modules/admin/admin.service.js";

async function main(): Promise<void> {
  const email = process.argv[2];
  if (!email) {
    process.stderr.write("Usage: npm run admin:grant -- <existing-user-email>\n");
    process.exitCode = 2;
    return;
  }

  try {
    await connectDatabase();
    const result = await grantAdminByEmail(email);
    process.stdout.write(result === "granted" ? "Admin role granted.\n" : "Account already has the admin role.\n");
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Admin role could not be granted."}\n`);
    process.exitCode = 1;
  } finally {
    await disconnectDatabase();
  }
}

void main();
