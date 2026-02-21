import { Client, Users, Databases, Query } from 'node-appwrite';

export default async ({ req, res, log, error }) => {
  // my enviroment variables
  const endpoint = process.env.APPWRITE_FUNCTION_API_ENDPOINT;
  const projectId = process.env.APPWRITE_FUNCTION_PROJECT_ID;
  const apiKey = process.env.APPWRITE_API_KEY;
  const databaseId = process.env.APPWRITE_DATABASE_ID;
  const usersTableId = process.env.APPWRITE_USERS_TABLE_ID;

  log('=== ENVIRONMENT CHECK ===');
  log(`Endpoint: ${endpoint || 'MISSING'}`);
  log(`Project ID: ${projectId || 'MISSING'}`);
  log(`API Key exists: ${!!apiKey}`);
  log(`API Key length: ${apiKey ? apiKey.length : 0}`);
  log(`Database ID: ${databaseId || 'MISSING'}`);
  log(`Users Table ID: ${usersTableId || 'MISSING'}`);

  if (!endpoint) {
    return res.json(
      { success: false, error: 'Missing APPWRITE_FUNCTION_API_ENDPOINT' },
      500
    );
  }
  if (!projectId) {
    return res.json(
      { success: false, error: 'Missing APPWRITE_FUNCTION_PROJECT_ID' },
      500
    );
  }
  if (!apiKey) {
    return res.json({ success: false, error: 'Missing APPWRITE_API_KEY' }, 500);
  }
  if (!databaseId) {
    return res.json(
      { success: false, error: 'Missing APPWRITE_DATABASE_ID' },
      500
    );
  }
  if (!usersTableId) {
    return res.json(
      { success: false, error: 'Missing APPWRITE_USERS_TABLE_ID' },
      500
    );
  }

  const client = new Client()
    .setEndpoint(endpoint)
    .setProject(projectId)
    .setKey(apiKey);

  const users = new Users(client);
  const databases = new Databases(client);

  try {
    log('Starting user sync...');

    let authTest;
    try {
      authTest = await users.list([], 1, 0);
      log(`Auth API connected - total users: ${authTest.total}`);
    } catch (authError) {
      error(`Cannot connect to Auth API: ${authError.message}`);
      return res.json(
        {
          success: false,
          error: `Auth connection failed: ${authError.message}`,
        },
        500
      );
    }

    let allAuthUsers = [];
    let offset = 0;
    const limit = 100;

    log('Fetching all auth users...');
    while (true) {
      const response = await users.list([], limit, offset);
      allAuthUsers = allAuthUsers.concat(response.users);
      log(`Fetched ${response.users.length} users at offset ${offset}`);

      if (response.users.length < limit) break;
      offset += limit;
    }

    log(`Total auth users: ${allAuthUsers.length}`);

    if (allAuthUsers.length > 0) {
      log(`Auth user IDs: ${allAuthUsers.map((u) => u.$id).join(', ')}`);
    }

    if (allAuthUsers.length === 0) {
      error('SAFETY GUARD: Got 0 auth users - aborting');
      return res.json(
        {
          success: false,
          error: 'Got 0 auth users - API key may lack users.read permission',
          authUsers: 0,
          dbDocuments: 0,
          orphansDeleted: 0,
          missingCreated: 0,
        },
        403
      );
    }

    const authUserIds = new Set(allAuthUsers.map((u) => u.$id));

    let allDocs = [];
    offset = 0;

    log('Fetching all database documents...');
    while (true) {
      const response = await databases.listDocuments(databaseId, usersTableId, [
        Query.limit(limit),
        Query.offset(offset),
      ]);
      allDocs = allDocs.concat(response.documents);
      log(`Fetched ${response.documents.length} documents at offset ${offset}`);

      if (response.documents.length < limit) break;
      offset += limit;
    }

    log(`Total database documents: ${allDocs.length}`);

    const orphanedDocs = allDocs.filter((doc) => !authUserIds.has(doc.$id));
    log(`Found ${orphanedDocs.length} orphaned documents`);

    let deletedCount = 0;
    for (const doc of orphanedDocs) {
      try {
        await databases.deleteDocument(databaseId, usersTableId, doc.$id);
        log(`Deleted orphan: ${doc.email}`);
        deletedCount++;
      } catch (delError) {
        error(`Failed to delete ${doc.$id}: ${delError.message}`);
      }
    }

    const dbDocIds = new Set(allDocs.map((doc) => doc.$id));
    const missingUsers = allAuthUsers.filter((u) => !dbDocIds.has(u.$id));
    log(`Found ${missingUsers.length} missing users`);

    let createdCount = 0;
    for (const authUser of missingUsers) {
      try {
        await databases.createDocument(databaseId, usersTableId, authUser.$id, {
          userId: authUser.$id,
          email: authUser.email,
          name: authUser.name || 'Unknown',
          plan: 'free',
          status: 'active',
          lastActive: new Date().toISOString(),
          hasJournalAccess: false,
          hasStrategiesAccess: false,
          hasBotAccess: false,
          hasAnalyticsAccess: false,
        });
        log(`Created: ${authUser.email}`);
        createdCount++;
      } catch (createError) {
        error(`Failed to create for ${authUser.email}: ${createError.message}`);
      }
    }

    const summary = {
      success: true,
      authUsers: allAuthUsers.length,
      dbDocuments: allDocs.length,
      orphansDeleted: deletedCount,
      missingCreated: createdCount,
      timestamp: new Date().toISOString(),
    };

    log('SYNC COMPLETED SUCCESSFULLY');
    log(`Auth Users: ${summary.authUsers}`);
    log(`DB Documents: ${summary.dbDocuments}`);
    log(`Orphans Deleted: ${summary.orphansDeleted}`);
    log(`Missing Created: ${summary.missingCreated}`);

    return res.json(summary);
  } catch (err) {
    error('SYNC FAILED');
    error(`Error: ${err.message}`);
    error(`Stack: ${err.stack}`);

    return res.json(
      {
        success: false,
        error: err.message,
        stack: err.stack,
      },
      500
    );
  }
};
