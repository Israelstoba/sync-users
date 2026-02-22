import { Client, Users, Databases } from 'node-appwrite';

export default async ({ req, res, log, error }) => {
  const endpoint =
    process.env.APPWRITE_FUNCTION_API_ENDPOINT ||
    'https://fra.cloud.appwrite.io/v1';
  const projectId =
    process.env.APPWRITE_FUNCTION_PROJECT_ID || '6983cd5e0013a04126e6';
  const apiKey = process.env.APPWRITE_API_KEY;
  const databaseId = process.env.APPWRITE_DATABASE_ID;
  const usersTableId = process.env.APPWRITE_USERS_TABLE_ID;

  const payload = JSON.parse(req.bodyRaw || '{}');
  const userId = payload.userId;

  log(`Delete request for user: ${userId}`);

  if (!userId) {
    return res.json({ success: false, error: 'Missing userId' }, 400);
  }

  if (!apiKey || !databaseId || !usersTableId) {
    return res.json({ success: false, error: 'Missing env variables' }, 500);
  }

  const client = new Client()
    .setEndpoint(endpoint)
    .setProject(projectId)
    .setKey(apiKey);

  const users = new Users(client);
  const databases = new Databases(client);

  let authDeleted = false;
  let dbDeleted = false;
  let authError = null;
  let dbError = null;

  try {
    try {
      await users.delete(userId);
      authDeleted = true;
      log(`Deleted auth user: ${userId}`);
    } catch (err) {
      authError = err.message;
      if (err.code === 404) {
        log(`Auth user already deleted: ${userId}`);
        authDeleted = true;
      } else {
        error(`Failed to delete auth: ${err.message}`);
      }
    }

    try {
      await databases.deleteDocument(databaseId, usersTableId, userId);
      dbDeleted = true;
      log(`Deleted database doc: ${userId}`);
    } catch (err) {
      dbError = err.message;
      if (err.code === 404) {
        log(`DB doc already deleted: ${userId}`);
        dbDeleted = true;
      } else {
        error(`Failed to delete DB: ${err.message}`);
      }
    }

    return res.json({
      success: authDeleted && dbDeleted,
      authDeleted,
      dbDeleted,
      authError,
      dbError,
      userId,
    });
  } catch (err) {
    error(`Unexpected error: ${err.message}`);
    return res.json({ success: false, error: err.message, userId }, 500);
  }
};
