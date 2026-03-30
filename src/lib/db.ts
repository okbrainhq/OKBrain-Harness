import { DbWrapper } from './db/db-types';
import { initializeSchema } from './db/db-schema';

const localModule = require('./db-local')
const dbWrapper: DbWrapper = localModule.dbWrapper
const resetLocalDb: (() => void) | undefined = localModule.resetDb

// Initialize database schema
let initPromise: Promise<void> | null = null
export async function ensureInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = initializeSchema(dbWrapper)
  }

  try {
    await initPromise
  } catch (error) {
    // If initialization fails, reset the promise so we can try again on the next request
    console.error('[DB] Initialization failed:', error)
    initPromise = null
    throw error
  }
}

// Reset database connection (useful for testing)
export function resetDb(): void {
  if (resetLocalDb) {
    resetLocalDb();
  }
  initPromise = null;
}

// Re-export all types
export * from './db/db-types';

// Import all operation modules
import * as userOps from './db/db-users';
import * as conversationOps from './db/db-conversations';
import * as folderOps from './db/db-folders';
import * as documentOps from './db/db-documents';
import * as eventOps from './db/db-events';
import * as attachmentOps from './db/db-attachments';
import * as snapshotOps from './db/db-snapshots';
import * as sharedLinkOps from './db/db-shared-links';
import * as memoryOps from './db/db-memory';
import * as factOps from './db/db-facts';
import * as factSheetOps from './db/db-fact-sheets';
import * as jobOps from './db/db-jobs';
import * as uploadOps from './db/db-uploads';
import * as conversationToolJobOps from './db/db-conversation-tool-jobs';
import * as toolCallLogOps from './db/db-tool-call-logs';
import * as chatYieldSessionOps from './db/db-chat-yield-sessions';
import * as chatEventOps from './db/db-chat-events';
import * as fileBrowserOps from './db/db-file-browsers';
import * as appOps from './db/db-apps';

// User operations
export async function createUser(id: string, email: string, passwordHashed: string) {
  return userOps.createUser(dbWrapper, ensureInitialized, id, email, passwordHashed);
}

export async function getUserById(id: string) {
  return userOps.getUserById(dbWrapper, ensureInitialized, id);
}

export async function getUserByEmail(email: string) {
  return userOps.getUserByEmail(dbWrapper, ensureInitialized, email);
}

// Conversation operations
export async function createConversation(
  userId: string,
  id: string,
  title: string,
  groundingEnabled: boolean = false,
  responseMode: 'quick' | 'detailed' = 'detailed',
  folderId: string | null = null,
  aiProvider: string = 'gemini',
  documentIds: string[] = [],
  appId: string | null = null
) {
  return conversationOps.createConversation(
    dbWrapper,
    ensureInitialized,
    userId,
    id,
    title,
    groundingEnabled,
    responseMode,
    folderId,
    aiProvider,
    documentIds,
    appId
  );
}

export async function getConversationsByAppId(userId: string, appId: string) {
  return conversationOps.getConversationsByAppId(dbWrapper, ensureInitialized, userId, appId);
}

export async function updateConversationGrounding(userId: string, id: string, groundingEnabled: boolean) {
  return conversationOps.updateConversationGrounding(dbWrapper, ensureInitialized, userId, id, groundingEnabled);
}

export async function updateConversationResponseMode(userId: string, id: string, responseMode: 'quick' | 'detailed') {
  return conversationOps.updateConversationResponseMode(dbWrapper, ensureInitialized, userId, id, responseMode);
}

export async function updateConversationAIProvider(userId: string, id: string, aiProvider: string) {
  return conversationOps.updateConversationAIProvider(dbWrapper, ensureInitialized, userId, id, aiProvider);
}

export async function getConversation(userId: string, id: string) {
  return conversationOps.getConversation(dbWrapper, ensureInitialized, userId, id);
}

export async function getConversationDocuments(userId: string, conversationId: string) {
  return conversationOps.getConversationDocuments(dbWrapper, ensureInitialized, userId, conversationId);
}

export async function getAllConversations(userId: string) {
  return conversationOps.getAllConversations(dbWrapper, ensureInitialized, userId);
}

export async function updateConversationTitle(userId: string, id: string, title: string) {
  return conversationOps.updateConversationTitle(dbWrapper, ensureInitialized, userId, id, title);
}

export async function updateConversationTimestamp(userId: string, id: string) {
  return conversationOps.updateConversationTimestamp(dbWrapper, ensureInitialized, userId, id);
}

export async function setConversationActiveJob(userId: string, id: string, jobId: string | null) {
  return conversationOps.setConversationActiveJob(dbWrapper, ensureInitialized, userId, id, jobId);
}

export async function trySetConversationActiveJob(userId: string, conversationId: string, jobId: string): Promise<boolean> {
  return conversationOps.trySetConversationActiveJob(dbWrapper, ensureInitialized, userId, conversationId, jobId);
}

export async function setConversationLoopState(conversationId: string, loopState: string | null, loopJobInput: string | null) {
  return conversationOps.setConversationLoopState(dbWrapper, ensureInitialized, conversationId, loopState, loopJobInput);
}

export async function getConversationsWithLoopState(loopState: string) {
  return conversationOps.getConversationsWithLoopState(dbWrapper, ensureInitialized, loopState);
}

export async function deleteConversation(userId: string, id: string) {
  return conversationOps.deleteConversation(dbWrapper, ensureInitialized, userId, id);
}

export async function moveConversationToFolder(userId: string, conversationId: string, folderId: string | null) {
  return conversationOps.moveConversationToFolder(
    dbWrapper,
    ensureInitialized,
    (uid, fid) => getFolder(uid, fid),
    userId,
    conversationId,
    folderId
  );
}

export async function getConversationsByFolder(userId: string, folderId: string | null) {
  return conversationOps.getConversationsByFolder(dbWrapper, ensureInitialized, userId, folderId);
}

export async function getRecentConversationsWithUserMessages(userId: string, excludeConversationId: string, sinceDate?: string) {
  return conversationOps.getRecentConversationsWithUserMessages(dbWrapper, ensureInitialized, userId, excludeConversationId, sinceDate);
}

// Message operations
export async function addMessage(
  userId: string,
  id: string,
  conversationId: string,
  role: "user" | "assistant" | "summary",
  content: string,
  model?: string,
  sources?: string,
  wasGrounded: boolean = false,
  thoughts?: string,
  thoughtSignature?: string,
  thinkingDuration?: number
) {
  return conversationOps.addMessage(
    dbWrapper,
    ensureInitialized,
    userId,
    id,
    conversationId,
    role,
    content,
    model,
    sources,
    wasGrounded,
    thoughts,
    thoughtSignature,
    thinkingDuration
  );
}

export async function getMessage(id: string) {
  return conversationOps.getMessage(dbWrapper, ensureInitialized, id);
}

export async function deleteMessage(userId: string, id: string) {
  return conversationOps.deleteMessage(dbWrapper, ensureInitialized, userId, id);
}

export async function updateMessageFeedback(userId: string, id: string, feedback: number | null) {
  return conversationOps.updateMessageFeedback(dbWrapper, ensureInitialized, userId, id, feedback);
}

export async function deleteConversationMessages(userId: string, conversationId: string) {
  return conversationOps.deleteConversationMessages(dbWrapper, ensureInitialized, userId, conversationId);
}

export async function getConversationMessages(userId: string, conversationId: string) {
  return conversationOps.getConversationMessages(dbWrapper, ensureInitialized, userId, conversationId);
}

export async function getSidebarItems(
  userId: string,
  type: 'uncategorized' | 'folder',
  folderId: string | null = null,
  limit: number = 50,
  offset: number = 0
) {
  return conversationOps.getSidebarItems(dbWrapper, ensureInitialized, userId, type, folderId, limit, offset);
}

// Folder operations
export async function createFolder(userId: string, id: string, name: string) {
  return folderOps.createFolder(dbWrapper, ensureInitialized, userId, id, name);
}

export async function ensureSharedFolder(userId: string) {
  return folderOps.ensureSharedFolder(dbWrapper, ensureInitialized, userId);
}

export async function getFolder(userId: string, id: string) {
  return folderOps.getFolder(dbWrapper, ensureInitialized, userId, id);
}

export async function getAllFolders(userId: string) {
  return folderOps.getAllFolders(dbWrapper, ensureInitialized, userId);
}

export async function updateFolderName(userId: string, id: string, name: string) {
  return folderOps.updateFolderName(dbWrapper, ensureInitialized, userId, id, name);
}

export async function deleteFolder(userId: string, id: string) {
  return folderOps.deleteFolder(dbWrapper, ensureInitialized, userId, id);
}

// Document operations
export async function createDocument(userId: string, id: string, title: string, content: string = '', folderId: string | null = null) {
  return documentOps.createDocument(dbWrapper, ensureInitialized, userId, id, title, content, folderId);
}

export async function getDocument(userId: string, id: string) {
  return documentOps.getDocument(dbWrapper, ensureInitialized, userId, id);
}

export async function getAllDocuments(userId: string) {
  return documentOps.getAllDocuments(dbWrapper, ensureInitialized, userId);
}

export async function updateDocumentTitle(userId: string, id: string, title: string) {
  return documentOps.updateDocumentTitle(dbWrapper, ensureInitialized, userId, id, title);
}

export async function updateDocumentContent(userId: string, id: string, content: string) {
  return documentOps.updateDocumentContent(dbWrapper, ensureInitialized, userId, id, content);
}

export async function updateDocument(userId: string, id: string, title: string, content: string) {
  return documentOps.updateDocument(dbWrapper, ensureInitialized, userId, id, title, content);
}

export async function deleteDocument(userId: string, id: string) {
  return documentOps.deleteDocument(dbWrapper, ensureInitialized, userId, id);
}

export async function moveDocumentToFolder(userId: string, documentId: string, folderId: string | null) {
  return documentOps.moveDocumentToFolder(
    dbWrapper,
    ensureInitialized,
    (uid, fid) => getFolder(uid, fid),
    userId,
    documentId,
    folderId
  );
}

export async function getDocumentsByFolder(userId: string, folderId: string | null) {
  return documentOps.getDocumentsByFolder(dbWrapper, ensureInitialized, userId, folderId);
}

export async function getDocumentConversations(userId: string, documentId: string) {
  return documentOps.getDocumentConversations(dbWrapper, ensureInitialized, userId, documentId);
}

export async function setConversationSourceSharedLink(conversationId: string, sharedLinkId: string) {
  return conversationOps.setConversationSourceSharedLink(dbWrapper, ensureInitialized, conversationId, sharedLinkId);
}

export async function searchConversations(userId: string, query: string) {
  return conversationOps.searchConversations(dbWrapper, ensureInitialized, userId, query);
}

export async function searchRecentConversationsByMessages(userId: string, query: string, afterTimestamp: string) {
  return conversationOps.searchRecentConversationsByMessages(dbWrapper, ensureInitialized, userId, query, afterTimestamp);
}

export async function searchDocuments(userId: string, query: string) {
  return documentOps.searchDocuments(dbWrapper, ensureInitialized, userId, query);
}

// File Browser operations
export async function createFileBrowser(userId: string, id: string, title: string, folderId: string | null = null) {
  return fileBrowserOps.createFileBrowser(dbWrapper, ensureInitialized, userId, id, title, folderId);
}

export async function getFileBrowser(userId: string, id: string) {
  return fileBrowserOps.getFileBrowser(dbWrapper, ensureInitialized, userId, id);
}

export async function updateFileBrowser(userId: string, id: string, title?: string, currentPath?: string) {
  return fileBrowserOps.updateFileBrowser(dbWrapper, ensureInitialized, userId, id, title, currentPath);
}

export async function deleteFileBrowser(userId: string, id: string) {
  return fileBrowserOps.deleteFileBrowser(dbWrapper, ensureInitialized, userId, id);
}

export async function moveFileBrowserToFolder(userId: string, fileBrowserId: string, folderId: string | null) {
  return fileBrowserOps.moveFileBrowserToFolder(
    dbWrapper,
    ensureInitialized,
    (uid, fid) => getFolder(uid, fid),
    userId,
    fileBrowserId,
    folderId
  );
}

export async function searchFileBrowsers(userId: string, query: string) {
  return fileBrowserOps.searchFileBrowsers(dbWrapper, ensureInitialized, userId, query);
}

// App operations
export async function createApp(userId: string, id: string, title: string, folderId: string | null = null) {
  return appOps.createApp(dbWrapper, ensureInitialized, userId, id, title, folderId);
}

export async function getApp(userId: string, id: string) {
  return appOps.getApp(dbWrapper, ensureInitialized, userId, id);
}

export async function getAppByTitle(userId: string, title: string) {
  return appOps.getAppByTitle(dbWrapper, ensureInitialized, userId, title);
}

export async function resolveApp(userId: string, identifier: string) {
  return appOps.resolveApp(dbWrapper, ensureInitialized, userId, identifier);
}

export async function updateApp(userId: string, id: string, title?: string, description?: string) {
  return appOps.updateApp(dbWrapper, ensureInitialized, userId, id, title, description);
}

export async function deleteApp(userId: string, id: string) {
  return appOps.deleteApp(dbWrapper, ensureInitialized, userId, id);
}

export async function moveAppToFolder(userId: string, appId: string, folderId: string | null) {
  return appOps.moveAppToFolder(
    dbWrapper, ensureInitialized,
    (uid, fid) => getFolder(uid, fid),
    userId, appId, folderId
  );
}

export async function searchApps(userId: string, query: string) {
  return appOps.searchApps(dbWrapper, ensureInitialized, userId, query);
}

export async function getAllApps(userId: string) {
  return appOps.getAllApps(dbWrapper, ensureInitialized, userId);
}

export async function getAppNames(userId: string, limit: number = 10) {
  return appOps.getAppNames(dbWrapper, ensureInitialized, userId, limit);
}

export async function getAppSecrets(appId: string) {
  return appOps.getAppSecrets(dbWrapper, ensureInitialized, appId);
}

export async function getAppSecretKeys(appId: string) {
  return appOps.getAppSecretKeys(dbWrapper, ensureInitialized, appId);
}

export async function setAppSecret(id: string, appId: string, key: string, value: string) {
  return appOps.setAppSecret(dbWrapper, ensureInitialized, id, appId, key, value);
}

export async function deleteAppSecret(appId: string, key: string) {
  return appOps.deleteAppSecret(dbWrapper, ensureInitialized, appId, key);
}

export async function getRecentRunAppCalls(userId: string, days: number = 7) {
  return appOps.getRecentRunAppCalls(dbWrapper, ensureInitialized, userId, days);
}

export async function getAppSecretsAsEnv(appId: string) {
  return appOps.getAppSecretsAsEnv(dbWrapper, ensureInitialized, appId);
}

// Event operations
export async function createEvent(
  userId: string,
  id: string,
  title: string,
  description: string,
  location: string,
  startDatetime: string,
  endDatetime: string | null = null,
  recurrenceType: string | null = null,
  recurrenceEndDate: string | null = null
) {
  return eventOps.createEvent(
    dbWrapper,
    ensureInitialized,
    userId,
    id,
    title,
    description,
    location,
    startDatetime,
    endDatetime,
    recurrenceType,
    recurrenceEndDate
  );
}

export async function getEvent(userId: string, id: string) {
  return eventOps.getEvent(dbWrapper, ensureInitialized, userId, id);
}

export async function getAllEvents(userId: string) {
  return eventOps.getAllEvents(dbWrapper, ensureInitialized, userId);
}

export async function updateEvent(
  userId: string,
  id: string,
  title: string,
  description: string,
  location: string,
  startDatetime: string,
  endDatetime: string | null,
  recurrenceType: string | null = null,
  recurrenceEndDate: string | null = null
) {
  return eventOps.updateEvent(
    dbWrapper,
    ensureInitialized,
    userId,
    id,
    title,
    description,
    location,
    startDatetime,
    endDatetime,
    recurrenceType,
    recurrenceEndDate
  );
}

export async function deleteEvent(userId: string, id: string) {
  return eventOps.deleteEvent(dbWrapper, ensureInitialized, userId, id);
}

export async function searchEvents(userId: string, searchQuery: string) {
  return eventOps.searchEvents(dbWrapper, ensureInitialized, userId, searchQuery);
}

export async function getEventsByDateRange(userId: string, startDate: string, endDate: string) {
  return eventOps.getEventsByDateRange(dbWrapper, ensureInitialized, userId, startDate, endDate);
}

export async function getUpcomingEvents(userId: string, limit: number = 5) {
  return eventOps.getUpcomingEvents(dbWrapper, ensureInitialized, userId, limit);
}

export async function getPastEvents(userId: string, limit: number = 10) {
  return eventOps.getPastEvents(dbWrapper, ensureInitialized, userId, limit);
}

// File attachment operations
export async function addFileAttachment(
  id: string,
  messageId: string,
  fileUri: string,
  fileName: string,
  mimeType: string,
  fileSize: number,
  uploadedAt: string
) {
  return attachmentOps.addFileAttachment(
    dbWrapper,
    ensureInitialized,
    id,
    messageId,
    fileUri,
    fileName,
    mimeType,
    fileSize,
    uploadedAt
  );
}

export async function getFileAttachment(id: string) {
  return attachmentOps.getFileAttachment(dbWrapper, ensureInitialized, id);
}

export async function getMessageFileAttachments(messageId: string) {
  return attachmentOps.getMessageFileAttachments(dbWrapper, ensureInitialized, messageId);
}

export async function getConversationFileAttachments(userId: string, conversationId: string) {
  return attachmentOps.getConversationFileAttachments(
    dbWrapper,
    ensureInitialized,
    (uid, cid) => getConversation(uid, cid),
    userId,
    conversationId
  );
}

export async function deleteFileAttachment(id: string) {
  return attachmentOps.deleteFileAttachment(dbWrapper, ensureInitialized, id);
}

// Snapshot operations
export async function createSnapshot(userId: string, documentId: string, id: string, message: string, title: string, content: string) {
  return snapshotOps.createSnapshot(dbWrapper, ensureInitialized, userId, documentId, id, message, title, content);
}

export async function getDocumentSnapshots(userId: string, documentId: string) {
  return snapshotOps.getDocumentSnapshots(
    dbWrapper,
    ensureInitialized,
    (uid, did) => getDocument(uid, did),
    userId,
    documentId
  );
}

export async function getDocumentSnapshot(userId: string, snapshotId: string) {
  return snapshotOps.getDocumentSnapshot(
    dbWrapper,
    ensureInitialized,
    (uid, did) => getDocument(uid, did),
    userId,
    snapshotId
  );
}

export async function getSnapshotById(snapshotId: string) {
  return snapshotOps.getSnapshotById(dbWrapper, ensureInitialized, snapshotId);
}

export async function deleteSnapshot(userId: string, snapshotId: string) {
  return snapshotOps.deleteSnapshot(
    dbWrapper,
    ensureInitialized,
    (uid, did) => getDocument(uid, did),
    userId,
    snapshotId
  );
}

// Shared link operations
export async function createSharedLink(userId: string, type: 'conversation' | 'document' | 'snapshot', resourceId: string, id: string) {
  return sharedLinkOps.createSharedLink(dbWrapper, ensureInitialized, userId, type, resourceId, id);
}

export async function getSharedLink(id: string) {
  return sharedLinkOps.getSharedLink(dbWrapper, ensureInitialized, id);
}

export async function getSharedLinkByResource(userId: string, type: 'conversation' | 'document' | 'snapshot', resourceId: string) {
  return sharedLinkOps.getSharedLinkByResource(dbWrapper, ensureInitialized, userId, type, resourceId);
}

// User memory operations
export async function getUserMemory(userId: string) {
  return memoryOps.getUserMemory(dbWrapper, ensureInitialized, userId);
}

export async function updateUserMemory(userId: string, memoryText: string) {
  return memoryOps.updateUserMemory(dbWrapper, ensureInitialized, userId, memoryText);
}

// Fact operations
export async function getUserFacts(userId: string) {
  return factOps.getUserFacts(dbWrapper, ensureInitialized, userId);
}

export async function getRecentFacts(userId: string, limit?: number) {
  return factOps.getRecentFacts(dbWrapper, ensureInitialized, userId, limit);
}

export async function addFact(userId: string, id: string, category: string, fact: string) {
  return factOps.addFact(dbWrapper, ensureInitialized, userId, id, category, fact);
}

export async function deleteFact(userId: string, factId: string) {
  return factOps.deleteFact(dbWrapper, ensureInitialized, userId, factId);
}

export async function updateFact(userId: string, factId: string, category: string, fact: string) {
  return factOps.updateFact(dbWrapper, ensureInitialized, userId, factId, category, fact);
}

export async function addFactExtraction(id: string, factId: string, conversationId: string) {
  return factOps.addFactExtraction(dbWrapper, ensureInitialized, id, factId, conversationId);
}

export async function updateConversationFactExtractedAt(conversationId: string) {
  return factOps.updateConversationFactExtractedAt(dbWrapper, ensureInitialized, conversationId);
}

export async function getRecentFactsByHours(userId: string, hours?: number) {
  return factOps.getRecentFactsByHours(dbWrapper, ensureInitialized, userId, hours);
}

export async function getUserIdsWithFacts() {
  return factOps.getUserIdsWithFacts(dbWrapper, ensureInitialized);
}

export async function getConversationsForFactExtraction() {
  return factOps.getConversationsForFactExtraction(dbWrapper, ensureInitialized);
}

export async function searchFactsByKeyword(userId: string, query: string, category?: string, limit?: number) {
  return factOps.searchFactsByKeyword(dbWrapper, ensureInitialized, userId, query, category, limit);
}

// Fact Sheet operations
export async function saveFactSheet(id: string, userId: string, factsJson: string, dedupLog: string | null, factCount: number, source: string) {
  return factSheetOps.saveFactSheet(dbWrapper, ensureInitialized, id, userId, factsJson, dedupLog, factCount, source);
}

export async function getLatestFactSheet(userId: string) {
  return factSheetOps.getLatestFactSheet(dbWrapper, ensureInitialized, userId);
}

export async function getLatestFactSheetBySource(userId: string, source: string) {
  return factSheetOps.getLatestFactSheetBySource(dbWrapper, ensureInitialized, userId, source);
}

export async function getLastFactSheetTimeBySource(source: string) {
  return factSheetOps.getLastFactSheetTimeBySource(dbWrapper, ensureInitialized, source);
}

export async function updateFactSheetFacts(sheetId: string, userId: string, factsJson: string, factCount: number) {
  return factSheetOps.updateFactSheetFacts(dbWrapper, ensureInitialized, sheetId, userId, factsJson, factCount);
}

export async function deleteOldFactSheets(userId: string) {
  return factSheetOps.deleteOldFactSheets(dbWrapper, ensureInitialized, userId);
}

// User KV operations
import * as kvOps from './db/db-kv';

export async function getUserKV(userId: string, key: string) {
  return kvOps.getUserKV(dbWrapper, ensureInitialized, userId, key);
}

export async function setUserKV(userId: string, key: string, value: string) {
  return kvOps.setUserKV(dbWrapper, ensureInitialized, userId, key, value);
}

export async function deleteUserKV(userId: string, key: string) {
  return kvOps.deleteUserKV(dbWrapper, ensureInitialized, userId, key);
}

// Job operations
export async function createJob(id: string, type: string) {
  return jobOps.createJob(dbWrapper, ensureInitialized, id, type);
}

export async function getJob(id: string) {
  return jobOps.getJob(dbWrapper, ensureInitialized, id);
}

export async function updateJobState(id: string, state: import('./db/db-types').JobState) {
  return jobOps.updateJobState(dbWrapper, ensureInitialized, id, state);
}

export async function addJobEvent(id: string, jobId: string, seq: number, kind: string, payload: string) {
  return jobOps.addJobEvent(dbWrapper, ensureInitialized, id, jobId, seq, kind, payload);
}

export async function getJobEvents(jobId: string, sinceSeq: number = 0) {
  return jobOps.getJobEvents(dbWrapper, ensureInitialized, jobId, sinceSeq);
}

export async function enqueueJob(id: string, jobId: string, input: string, priority: number = 0) {
  return jobOps.enqueueJob(dbWrapper, ensureInitialized, id, jobId, input, priority);
}

export async function claimNextJob(workerId: string, jobType?: string) {
  return jobOps.claimNextJob(dbWrapper, ensureInitialized, workerId, jobType);
}

export async function completeQueueItem(
  queueId: string,
  jobId: string,
  state: 'done' | 'failed',
  jobState: import('./db/db-types').JobState
) {
  return jobOps.completeQueueItem(dbWrapper, ensureInitialized, queueId, jobId, state, jobState);
}

// Conversation tool job operations
export async function addConversationToolJob(
  id: string,
  conversationId: string,
  parentJobId: string,
  jobId: string,
  toolName: string,
  metadata?: object
) {
  return conversationToolJobOps.addConversationToolJob(dbWrapper, ensureInitialized, {
    id,
    conversationId,
    parentJobId,
    jobId,
    toolName,
    metadata,
  });
}

export async function updateConversationToolJobState(
  jobId: string,
  state: import('./db/db-types').ConversationToolJobState,
  output?: object,
  error?: string | null
) {
  return conversationToolJobOps.updateConversationToolJobState(
    dbWrapper,
    ensureInitialized,
    jobId,
    state,
    output,
    error
  );
}

export async function getConversationToolJobs(conversationId: string) {
  return conversationToolJobOps.getConversationToolJobs(dbWrapper, ensureInitialized, conversationId);
}

export async function getConversationToolJobsByParentJob(parentJobId: string) {
  return conversationToolJobOps.getConversationToolJobsByParentJob(dbWrapper, ensureInitialized, parentJobId);
}

export async function getConversationToolJobByJobId(jobId: string) {
  return conversationToolJobOps.getConversationToolJobByJobId(dbWrapper, ensureInitialized, jobId);
}

export async function linkToolJobsToMessage(parentJobId: string, messageId: string) {
  return conversationToolJobOps.linkToolJobsToMessage(dbWrapper, ensureInitialized, parentJobId, messageId);
}

// Tool call log operations
export async function addToolCallLog(
  conversationId: string,
  toolName: string,
  args: any,
  options?: {
    parentJobId?: string;
    messageId?: string;
    isRetrievalTool?: boolean;
  }
) {
  return toolCallLogOps.addToolCallLog(dbWrapper, ensureInitialized, {
    conversationId,
    parentJobId: options?.parentJobId,
    messageId: options?.messageId,
    toolName,
    arguments: args,
    isRetrievalTool: options?.isRetrievalTool,
  });
}

export async function updateToolCallLogResult(
  toolCallLogId: string,
  data: {
    status: import('./db/db-types').ToolCallLogStatus;
    response?: any;
    error?: string | null;
  }
) {
  return toolCallLogOps.updateToolCallLogResult(dbWrapper, ensureInitialized, toolCallLogId, data);
}

export async function markToolCallLogYielded(
  toolCallLogId: string,
  data: {
    asyncJobId: string;
    response?: any;
  }
) {
  return toolCallLogOps.markToolCallLogYielded(dbWrapper, ensureInitialized, toolCallLogId, data);
}

export async function getRecentToolCallLogs(conversationId: string, limit: number = 20) {
  return toolCallLogOps.getRecentToolCallLogs(dbWrapper, ensureInitialized, conversationId, limit);
}

export async function getToolCallLogByToolCallId(conversationId: string, toolCallId: string) {
  return toolCallLogOps.getToolCallLogByToolCallId(dbWrapper, ensureInitialized, conversationId, toolCallId);
}

export async function getToolCallLogsByToolCallIds(conversationId: string, toolCallIds: string[]) {
  return toolCallLogOps.getToolCallLogsByToolCallIds(dbWrapper, ensureInitialized, conversationId, toolCallIds);
}

export async function linkToolCallLogsToMessage(parentJobId: string, messageId: string) {
  return toolCallLogOps.linkToolCallLogsToMessage(dbWrapper, ensureInitialized, parentJobId, messageId);
}

export async function getYieldedToolCallLogsByParentJob(parentJobId: string) {
  return toolCallLogOps.getYieldedToolCallLogsByParentJob(dbWrapper, ensureInitialized, parentJobId);
}

export async function getAsyncToolCallLogsByParentJob(parentJobId: string) {
  return toolCallLogOps.getAsyncToolCallLogsByParentJob(dbWrapper, ensureInitialized, parentJobId);
}

export async function createChatYieldSession(
  conversationId: string,
  userId: string,
  originChatJobId: string,
  originExit: import('./db/db-types').ChatYieldSessionOriginExit,
  yieldNote: string,
  options?: {
    deadlineAt?: string;
    nextCheckAt?: string;
    partialOutput?: string | null;
    partialThoughts?: string | null;
    partialThinkingDuration?: number | null;
  }
) {
  return chatYieldSessionOps.createChatYieldSession(dbWrapper, ensureInitialized, {
    conversationId,
    userId,
    originChatJobId,
    originExit,
    yieldNote,
    deadlineAt: options?.deadlineAt,
    nextCheckAt: options?.nextCheckAt,
    partialOutput: options?.partialOutput,
    partialThoughts: options?.partialThoughts,
    partialThinkingDuration: options?.partialThinkingDuration,
  });
}

export async function getChatYieldSessionById(id: string) {
  return chatYieldSessionOps.getChatYieldSessionById(dbWrapper, ensureInitialized, id);
}

export async function getChatYieldSessionByOriginChatJobId(originChatJobId: string) {
  return chatYieldSessionOps.getChatYieldSessionByOriginChatJobId(dbWrapper, ensureInitialized, originChatJobId);
}

export async function getChatYieldSessionByResumeJobId(resumeJobId: string) {
  return chatYieldSessionOps.getChatYieldSessionByResumeJobId(dbWrapper, ensureInitialized, resumeJobId);
}

export async function updateChatYieldSessionState(
  id: string,
  state: import('./db/db-types').ChatYieldSessionState,
  options?: {
    resumeJobId?: string | null;
    resumeReason?: import('./db/db-types').ChatYieldSessionResumeReason | null;
    lastError?: string | null;
    timedOutAt?: string | null;
    deadlineAt?: string | null;
    nextCheckAt?: string | null;
    resumeQueuedAt?: string | null;
  }
) {
  return chatYieldSessionOps.updateChatYieldSessionState(dbWrapper, ensureInitialized, id, state, options);
}

export async function transitionChatYieldSessionState(
  id: string,
  fromState: import('./db/db-types').ChatYieldSessionState,
  toState: import('./db/db-types').ChatYieldSessionState
) {
  return chatYieldSessionOps.transitionChatYieldSessionState(
    dbWrapper,
    ensureInitialized,
    id,
    fromState,
    toState
  );
}

export async function claimWaitingChatYieldSession(id: string, resumeQueuedAt: string) {
  return chatYieldSessionOps.claimWaitingChatYieldSession(
    dbWrapper,
    ensureInitialized,
    id,
    resumeQueuedAt
  );
}

export async function releaseChatYieldSessionClaim(
  id: string,
  options: {
    nextCheckAt: string;
    lastError?: string | null;
    incrementAttempt?: boolean;
    clearResumeJobId?: boolean;
  }
) {
  return chatYieldSessionOps.releaseChatYieldSessionClaim(
    dbWrapper,
    ensureInitialized,
    id,
    options
  );
}

export async function markChatYieldSessionResumed(
  id: string,
  data: {
    resumeJobId: string;
    resumeReason: import('./db/db-types').ChatYieldSessionResumeReason;
    timedOutAt?: string | null;
  }
) {
  return chatYieldSessionOps.markChatYieldSessionResumed(
    dbWrapper,
    ensureInitialized,
    id,
    data
  );
}

export async function markChatYieldSessionFailedFromResumeQueue(
  id: string,
  options: {
    lastError: string;
    incrementAttempt?: boolean;
  }
) {
  return chatYieldSessionOps.markChatYieldSessionFailedFromResumeQueue(
    dbWrapper,
    ensureInitialized,
    id,
    options
  );
}

export async function backfillChatYieldSessionSchedulerFields(
  id: string,
  fields: {
    deadlineAt: string;
    nextCheckAt: string;
  }
) {
  return chatYieldSessionOps.backfillChatYieldSessionSchedulerFields(
    dbWrapper,
    ensureInitialized,
    id,
    fields
  );
}

export async function listWaitingChatYieldSessionsForScheduler(nowIso: string, limit: number) {
  return chatYieldSessionOps.listWaitingChatYieldSessionsForScheduler(
    dbWrapper,
    ensureInitialized,
    nowIso,
    limit
  );
}

export async function listStaleResumeQueuedChatYieldSessionsForScheduler(staleBeforeIso: string, limit: number) {
  return chatYieldSessionOps.listStaleResumeQueuedChatYieldSessionsForScheduler(
    dbWrapper,
    ensureInitialized,
    staleBeforeIso,
    limit
  );
}

export async function cancelWaitingChatYieldSessionsForConversation(conversationId: string) {
  return chatYieldSessionOps.cancelWaitingChatYieldSessionsForConversation(
    dbWrapper,
    ensureInitialized,
    conversationId
  );
}

export async function getLatestActiveChatYieldSessionForConversation(conversationId: string) {
  return chatYieldSessionOps.getLatestActiveChatYieldSessionForConversation(
    dbWrapper,
    ensureInitialized,
    conversationId
  );
}

export async function getAllActiveChatYieldSessionsForConversation(conversationId: string) {
  return chatYieldSessionOps.getAllActiveChatYieldSessionsForConversation(
    dbWrapper,
    ensureInitialized,
    conversationId
  );
}

// Chat event operations
export async function addChatEvent(
  conversationId: string,
  kind: import('./db/db-types').ChatEventKind,
  content: any
) {
  return chatEventOps.addChatEvent(dbWrapper, ensureInitialized, conversationId, kind, content);
}

export async function getChatEvents(conversationId: string) {
  return chatEventOps.getChatEvents(dbWrapper, ensureInitialized, conversationId);
}

export async function getChatEventsByKind(
  conversationId: string,
  kind: import('./db/db-types').ChatEventKind,
  afterCreatedAt?: string
) {
  return chatEventOps.getChatEventsByKind(dbWrapper, ensureInitialized, conversationId, kind, afterCreatedAt);
}

export async function updateChatEventFeedback(eventId: string, feedback: number | null) {
  return chatEventOps.updateChatEventFeedback(dbWrapper, ensureInitialized, eventId, feedback);
}

export async function deleteChatEventsForConversation(conversationId: string) {
  return chatEventOps.deleteChatEventsForConversation(dbWrapper, ensureInitialized, conversationId);
}

export async function deleteChatEventsAfterSeq(conversationId: string, afterSeq: number) {
  return chatEventOps.deleteChatEventsAfterSeq(dbWrapper, ensureInitialized, conversationId, afterSeq);
}

export async function searchRecentMessages(userId: string, query: string, afterTimestamp: string, kinds: string[], limit?: number) {
  return chatEventOps.searchRecentMessages(dbWrapper, ensureInitialized, userId, query, afterTimestamp, kinds, limit);
}

export async function getConversationTextEvents(conversationId: string) {
  return chatEventOps.getConversationTextEvents(dbWrapper, ensureInitialized, conversationId);
}

// Embedding operations
import * as embeddingOps from './db/db-embeddings';

export async function saveFactEmbedding(factId: string, userId: string, embedding: Float32Array) {
  return embeddingOps.saveFactEmbedding(dbWrapper, ensureInitialized, factId, userId, embedding);
}

export async function deleteFactEmbedding(factId: string) {
  return embeddingOps.deleteFactEmbedding(dbWrapper, ensureInitialized, factId);
}

export async function searchFactsByEmbedding(userId: string, queryEmbedding: Float32Array, limit?: number, maxDistance?: number) {
  return embeddingOps.searchFactsByEmbedding(dbWrapper, ensureInitialized, userId, queryEmbedding, limit, maxDistance);
}

export async function getFactsWithoutEmbeddings(userId?: string) {
  return embeddingOps.getFactsWithoutEmbeddings(dbWrapper, ensureInitialized, userId);
}

// Upload operations
export async function createUpload(id: string, userId: string, filename: string) {
  return uploadOps.createUpload(dbWrapper, ensureInitialized, id, userId, filename);
}

export async function getUploadByFilename(filename: string) {
  return uploadOps.getUploadByFilename(dbWrapper, ensureInitialized, filename);
}

// Export the wrapper for advanced usage
export default dbWrapper;
