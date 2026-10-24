// All calls from the website to the FastAPI backend go through this file.

import type { Appearance } from "./themes";

import type {
  AccountStatus,
  AdminAction,
  AdminProblemReport,
  AdminReport,
  AdminReportStatus,
  AdminStats,
  AdminSuspension,
  AllowMessages,
  Asset,
  Badges,
  Bootstrap,
  ChatDetail,
  ChatList,
  ChatMessage,
  Comment,
  CommentList,
  DesignSpec,
  DesignVersion,
  ExploreFilterChoice,
  ExploreFilters,
  GenerationJob,
  GeneratorInfo,
  Interests,
  MessagePage,
  MyComment,
  NotebookMessage,
  NotificationPage,
  NotificationSettings,
  Onboarding,
  OnboardingStep,
  PackageResult,
  PeoplePage,
  PersonListItem,
  ProjectDetail,
  ProjectSummary,
  PersonSummary,
  Post,
  PostContentChoice,
  PostPage,
  PostStatus,
  PostTags,
  PrivacyChoices,
  ProblemCategory,
  Profile,
  ProfileDetail,
  ProfilePostsPage,
  ProviderOverview,
  PublishOptions,
  ReportReason,
  ReportTarget,
  Role,
  SearchEntry,
  SearchResults,
  SendResult,
  SuggestedPerson,
  TimeDay,
  TutorialVideo,
  UsageSummary,
  VerificationRequest,
  VerificationState,
  VerificationStatus,
  Visibility,
} from "./types";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** True when the browser could not reach the backend at all (it is probably not running). */
export function isOfflineError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 0;
}

// ----- sign-in -----
// The AuthProvider tells this file how to get the current sign-in token and
// what to do when the backend says the sign-in is no longer valid.
let getToken: () => Promise<string | null> = async () => null;
let onSignedOut: (message: string) => void = () => {};
// Short-lived token that lets <img> tags load the user's own pictures.
let mediaToken = "";

export function configureAuth(options: { getToken: () => Promise<string | null>; onSignedOut: (message: string) => void }) {
  getToken = options.getToken;
  onSignedOut = options.onSignedOut;
}

export function setMediaToken(token: string) {
  mediaToken = token;
}

// ----- start-up summary -----
// When a page opens, the first call for each of these parts is answered by one /api/me/bootstrap request
// instead of six separate ones. Later calls (for example after saving a change) ask their own endpoint.
let bootstrap: Promise<Bootstrap> | null = null;
const usedFromBootstrap = new Set<keyof Bootstrap>();

function firstFromBootstrap<K extends keyof Bootstrap>(part: K, alone: () => Promise<Bootstrap[K]>): Promise<Bootstrap[K]> {
  if (usedFromBootstrap.has(part)) return alone();
  usedFromBootstrap.add(part);
  bootstrap ??= request<Bootstrap>("/api/me/bootstrap");
  return bootstrap.then((b) => b[part]).catch(() => alone());
}

/** Forget the start-up summary (on sign-in and sign-out, so nobody ever sees another person's). */
export function resetBootstrap() {
  bootstrap = null;
  usedFromBootstrap.clear();
}

/** Plain-words messages for when the server gives no better one. */
export function statusMessage(status: number): string {
  if (status === 400 || status === 422) return "Please check what you entered and try again.";
  if (status === 401) return "Please sign in again.";
  if (status === 403) return "You do not have access to this.";
  if (status === 404) return "Not found. It may have been deleted.";
  if (status === 413) return "That is too large to send.";
  if (status === 429) return "Too many requests. Please wait a minute and try again.";
  if (status >= 500 && status !== 500) return "The server is busy or restarting. Please try again in a minute.";
  return "Something went wrong on the server. Please try again.";
}

async function send(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getToken();
  const headers: Record<string, string> = init.body instanceof FormData || init.body === undefined ? {} : { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string>) } });
  } catch {
    throw new ApiError(`Cannot reach the server at ${API_URL}. Check your internet connection; if the server was asleep it can take up to a minute to wake up.`, 0);
  }
  if (!res.ok) {
    let message = statusMessage(res.status);
    try {
      const body = await res.json();
      if (typeof body.detail === "string") message = body.detail;
      else if (Array.isArray(body.detail)) message = body.detail.map((d: { msg: string }) => d.msg).join("; ");
    } catch {
      /* response had no JSON body */
    }
    if (res.status === 401 && token) onSignedOut(message);
    throw new ApiError(message, res.status);
  }
  return res;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await send(path, init);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Download a file that needs the sign-in header (so a plain link cannot be used). */
async function download(path: string, fallbackName: string): Promise<void> {
  const res = await send(path);
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const api = {
  health: () => request<{ status: string }>("/api/health"),
  providers: () => request<ProviderOverview>("/api/providers"),
  usage: () => request<UsageSummary>("/api/usage"),
  generators: () => request<GeneratorInfo[]>("/api/generators"),
  /** Learning Library search. Fails with status 503 when tutorial search is not connected. */
  searchTutorials: (q: string, language = "any") =>
    request<TutorialVideo[]>(`/api/tutorials/search?${new URLSearchParams({ q, language })}`),

  listProjects: (search = "", garmentCategory = "") => {
    const q = new URLSearchParams();
    if (search) q.set("search", search);
    if (garmentCategory) q.set("garment_category", garmentCategory);
    return request<ProjectSummary[]>(`/api/projects?${q}`);
  },
  createProject: (body: { title: string; garment_category: string; idea: string }) =>
    request<ProjectSummary>("/api/projects", json("POST", body)),
  getProject: (id: string) => request<ProjectDetail>(`/api/projects/${id}`),
  renameProject: (id: string, title: string) => request<ProjectSummary>(`/api/projects/${id}`, json("PATCH", { title })),
  deleteProject: (id: string) => request<void>(`/api/projects/${id}`, { method: "DELETE" }),
  duplicateProject: (id: string) => request<ProjectSummary>(`/api/projects/${id}/duplicate`, json("POST")),
  /** Download the whole project as a JSON file. */
  downloadExport: (id: string, title: string) => download(`/api/projects/${id}/export`, `${title || "project"}.json`),

  saveVersion: (id: string, spec: DesignSpec, note = "") =>
    request<DesignVersion>(`/api/projects/${id}/versions`, json("POST", { spec, note })),
  restoreVersion: (id: string, version: number) =>
    request<DesignVersion>(`/api/projects/${id}/versions/${version}/restore`, json("POST")),

  addMessage: (id: string, content: string) =>
    request<NotebookMessage>(`/api/projects/${id}/messages`, json("POST", { content })),
  deleteMessage: (id: string, messageId: string) =>
    request<void>(`/api/projects/${id}/messages/${messageId}`, { method: "DELETE" }),

  getCanvas: (id: string) =>
    request<{ data: Record<string, unknown>; updated_at: string | null }>(`/api/projects/${id}/canvas`),
  saveCanvas: (id: string, data: unknown) =>
    request<{ updated_at: string }>(`/api/projects/${id}/canvas`, json("PUT", { data })),

  uploadAsset: (id: string, file: Blob, filename: string, kind: "upload" | "sketch" = "upload") => {
    const form = new FormData();
    form.append("file", file, filename);
    form.append("kind", kind);
    return request<Asset>(`/api/projects/${id}/assets`, { method: "POST", body: form });
  },
  deleteAsset: (id: string, assetId: string) =>
    request<void>(`/api/projects/${id}/assets/${assetId}`, { method: "DELETE" }),
  /** Address of one of your pictures, for <img> tags (carries the short-lived media token). */
  assetUrl: (assetId: string) => `${API_URL}/api/assets/${assetId}?mt=${encodeURIComponent(mediaToken)}`,
  mediaToken: () => firstFromBootstrap("media_token", () => request<{ token: string; expires_at: string }>("/api/media-token")),

  generate: (id: string, generatorId: string, options: Record<string, unknown> = {}) =>
    request<GenerationJob>(`/api/projects/${id}/generate/${generatorId}`, json("POST", { options })),
  retryJob: (id: string, jobId: string) => request<GenerationJob>(`/api/projects/${id}/jobs/${jobId}/retry`, json("POST")),
  applyDesign: (id: string, jobId: string) =>
    request<{ version_number: number }>(`/api/projects/${id}/jobs/${jobId}/apply`, json("POST")),
  deleteJob: (id: string, jobId: string) => request<void>(`/api/projects/${id}/jobs/${jobId}`, { method: "DELETE" }),
  /** Download the tailor sheet PDF (dated in the user's own time zone). */
  downloadTailorPdf: (id: string, jobId: string) =>
    download(`/api/projects/${id}/jobs/${jobId}/tailor-sheet.pdf?tz_offset=${new Date().getTimezoneOffset()}`, "tailor-sheet.pdf"),
  generatePackage: (id: string, generatorIds: string[], options: Record<string, Record<string, unknown>>) =>
    request<PackageResult>(`/api/projects/${id}/package`, json("POST", { generator_ids: generatorIds, options })),

  // ----- Phase 8: themes -----
  appearance: () => firstFromBootstrap("appearance", () => request<Appearance>("/api/me/appearance")),
  saveAppearance: (body: Partial<Pick<Appearance, "app_theme" | "profile_theme" | "custom_theme">>) =>
    request<Appearance>("/api/me/appearance", json("PUT", body)),

  // ----- Phase 6A: profiles, posts, feed -----
  myProfile: () => firstFromBootstrap("profile", () => request<Profile | null>("/api/me/profile")),
  saveProfile: (body: { username: string; display_name: string; bio: string; role: Role }) =>
    request<Profile>("/api/me/profile", json("PUT", body)),
  uploadAvatar: (file: Blob, filename: string) => {
    const form = new FormData();
    form.append("file", file, filename);
    return request<Profile>("/api/me/avatar", { method: "POST", body: form });
  },
  /** Profile picture address for <img>; the version makes browsers fetch a new picture after a change. */
  avatarUrl: (userId: string, version: string | null) =>
    `${API_URL}/api/avatars/${userId}?mt=${encodeURIComponent(mediaToken)}&v=${encodeURIComponent(version ?? "")}`,
  profile: (username: string) => request<ProfileDetail>(`/api/profiles/${encodeURIComponent(username)}`),
  profilePosts: (username: string, cursor?: string | null) =>
    request<ProfilePostsPage>(`/api/profiles/${encodeURIComponent(username)}/posts${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),
  follow: (username: string, on: boolean) =>
    request<ProfileDetail>(`/api/profiles/${encodeURIComponent(username)}/follow`, { method: on ? "POST" : "DELETE" }),
  searchPeople: (q: string) => request<PersonSummary[]>(`/api/profiles/search?${new URLSearchParams({ q })}`),
  closeFriends: () => request<PersonSummary[]>("/api/me/close-friends"),
  addCloseFriend: (username: string) => request<PersonSummary[]>("/api/me/close-friends", json("POST", { username })),
  removeCloseFriend: (username: string) =>
    request<PersonSummary[]>(`/api/me/close-friends/${encodeURIComponent(username)}`, { method: "DELETE" }),

  publishOptions: (projectId: string) => request<PublishOptions>(`/api/projects/${projectId}/publish-options`),
  createPost: (body: { project_id: string; status: "draft" | "published"; visibility: Visibility; caption: string; tags: PostTags; content: PostContentChoice }) =>
    request<Post>("/api/posts", json("POST", body)),
  getPost: (id: string) => request<Post>(`/api/posts/${id}`),
  updatePost: (
    id: string,
    body: Partial<{ status: PostStatus; visibility: Visibility; caption: string; tags: PostTags; pinned: boolean; content: PostContentChoice }>,
  ) => request<Post>(`/api/posts/${id}`, json("PATCH", body)),
  deletePost: (id: string) => request<void>(`/api/posts/${id}`, { method: "DELETE" }),
  myPosts: (status: PostStatus, cursor?: string | null) =>
    request<PostPage>(`/api/me/posts?${new URLSearchParams(cursor ? { status, cursor } : { status })}`),
  feed: (cursor?: string | null) => request<PostPage>(`/api/feed${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),
  saved: (cursor?: string | null) => request<PostPage>(`/api/me/saved${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),
  react: (id: string, what: "like" | "save", on: boolean) => request<Post>(`/api/posts/${id}/${what}`, { method: on ? "POST" : "DELETE" }),
  postImageUrl: (imageId: string) => `${API_URL}/api/post-images/${imageId}?mt=${encodeURIComponent(mediaToken)}`,

  // ----- Phase 6B: follow requests, safety, comments, reposts, Explore -----
  setPrivacy: (isPrivate: boolean) => request<Profile>("/api/me/privacy", json("PUT", { is_private: isPrivate })),
  followers: (username: string, offset = 0) => request<PeoplePage>(`/api/profiles/${encodeURIComponent(username)}/followers?offset=${offset}`),
  following: (username: string, offset = 0) => request<PeoplePage>(`/api/profiles/${encodeURIComponent(username)}/following?offset=${offset}`),
  removeFollower: (username: string) => request<void>(`/api/me/followers/${encodeURIComponent(username)}`, { method: "DELETE" }),
  followRequests: () => request<PersonListItem[]>("/api/me/follow-requests"),
  answerRequest: (username: string, accept: boolean) =>
    request<PersonListItem[]>(`/api/me/follow-requests/${encodeURIComponent(username)}${accept ? "/accept" : ""}`, { method: accept ? "POST" : "DELETE" }),
  /** Block, restrict or mute someone (on = true), or undo it. */
  setSafety: (username: string, what: "block" | "restrict" | "mute", on: boolean) =>
    request<ProfileDetail>(`/api/profiles/${encodeURIComponent(username)}/${what}`, { method: on ? "POST" : "DELETE" }),
  safetyList: (what: "blocked" | "restricted" | "muted") => request<PersonListItem[]>(`/api/me/${what}`),
  profileReposts: (username: string, cursor?: string | null) =>
    request<PostPage>(`/api/profiles/${encodeURIComponent(username)}/reposts${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),
  repost: (id: string, on: boolean) => request<Post>(`/api/posts/${id}/repost`, { method: on ? "POST" : "DELETE" }),

  comments: (postId: string) => request<CommentList>(`/api/posts/${postId}/comments`),
  addComment: (postId: string, body: string, parentId?: string | null) =>
    request<Comment>(`/api/posts/${postId}/comments`, json("POST", { body, parent_id: parentId ?? null })),
  deleteComment: (id: string) => request<void>(`/api/comments/${id}`, { method: "DELETE" }),
  approveComment: (id: string) => request<Comment>(`/api/comments/${id}/approve`, json("POST")),
  likeComment: (id: string, on: boolean) => request<Comment>(`/api/comments/${id}/like`, { method: on ? "POST" : "DELETE" }),
  report: (body: { target_type: ReportTarget; target: string; reason: ReportReason; details: string }) =>
    request<{ id: string; status: string; created_at: string }>("/api/reports", json("POST", body)),

  explore: (filters: ExploreFilterChoice, cursor?: string | null) => {
    const q = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
    if (cursor) q.set("cursor", cursor);
    return request<PostPage>(`/api/explore?${q}`);
  },
  trending: (filters: ExploreFilterChoice) =>
    request<PostPage>(`/api/explore/trending?${new URLSearchParams(Object.entries(filters).filter(([, v]) => v))}`),
  exploreFilters: () => request<ExploreFilters>("/api/explore/filters"),
  search: (q: string) => request<SearchResults>(`/api/search?${new URLSearchParams({ q })}`),

  // ----- Phase 6C: chats and notifications -----
  badges: () => firstFromBootstrap("badges", () => request<Badges>("/api/me/badges")),
  messagingSettings: () => request<{ allow_messages_from: AllowMessages }>("/api/me/messaging"),
  saveMessagingSettings: (value: AllowMessages) =>
    request<{ allow_messages_from: AllowMessages }>("/api/me/messaging", json("PUT", { allow_messages_from: value })),
  chats: (folder: "inbox" | "requests") => request<ChatList>(`/api/chats?folder=${folder}`),
  /** Open the chat with this person (started now if they accept messages from you). */
  startChat: (username: string) => request<ChatDetail>("/api/chats", json("POST", { username })),
  chat: (id: string) => request<ChatDetail>(`/api/chats/${id}`),
  messages: (id: string, before?: string | null) =>
    request<MessagePage>(`/api/chats/${id}/messages${before ? `?before=${encodeURIComponent(before)}` : ""}`),
  sendMessage: (id: string, body: string, postId?: string) =>
    request<ChatMessage>(`/api/chats/${id}/messages`, json("POST", { body, post_id: postId ?? null })),
  sendDesign: (id: string, projectId: string, assetId: string, body = "") =>
    request<ChatMessage>(`/api/chats/${id}/design`, json("POST", { project_id: projectId, asset_id: assetId, body })),
  sendPost: (postId: string, usernames: string[], body = "") =>
    request<SendResult[]>(`/api/posts/${postId}/send`, json("POST", { usernames, body })),
  unsend: (messageId: string) => request<void>(`/api/messages/${messageId}`, { method: "DELETE" }),
  messageImageUrl: (messageId: string) => `${API_URL}/api/messages/${messageId}/image?mt=${encodeURIComponent(mediaToken)}`,
  markChatRead: (id: string) => request<void>(`/api/chats/${id}/read`, json("POST")),
  acceptChat: (id: string) => request<ChatDetail>(`/api/chats/${id}/accept`, json("POST")),
  /** Delete the chat (or a message request) for you only. */
  deleteChat: (id: string) => request<void>(`/api/chats/${id}`, { method: "DELETE" }),

  notifications: (cursor?: string | null) =>
    request<NotificationPage>(`/api/notifications${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),
  readAllNotifications: () => request<void>("/api/notifications/read", json("POST")),
  readNotification: (id: string) => request<void>(`/api/notifications/${id}/read`, json("POST")),
  notificationSettings: () => request<NotificationSettings>("/api/me/notification-settings"),
  saveNotificationSettings: (body: NotificationSettings) =>
    request<NotificationSettings>("/api/me/notification-settings", json("PUT", body)),

  // ----- Phase 6D: settings, your activity, help -----
  account: () => firstFromBootstrap("account", () => request<AccountStatus>("/api/me/account")),
  deactivate: () => request<AccountStatus>("/api/me/deactivate", json("POST")),
  reactivate: () => request<AccountStatus>("/api/me/reactivate", json("POST")),
  requestDelete: (confirm: string) => request<AccountStatus>("/api/me/delete", json("POST", { confirm })),
  cancelDelete: () => request<AccountStatus>("/api/me/delete", { method: "DELETE" }),
  /** Download everything about you as one JSON file. */
  downloadMyData: () => download("/api/me/export", "drapeit-my-data.json"),
  privacyChoices: () => request<PrivacyChoices>("/api/me/privacy-settings"),
  savePrivacyChoices: (body: PrivacyChoices) => request<PrivacyChoices>("/api/me/privacy-settings", json("PUT", body)),
  liked: (cursor?: string | null) => request<PostPage>(`/api/me/liked${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),
  myComments: (cursor?: string | null) =>
    request<{ comments: MyComment[]; next_cursor: string | null }>(`/api/me/comments${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),
  restorePost: (id: string) => request<Post>(`/api/posts/${id}/restore`, json("POST")),
  deletePostForGood: (id: string) => request<void>(`/api/posts/${id}?permanent=true`, { method: "DELETE" }),
  searchHistory: () => request<SearchEntry[]>("/api/me/search-history"),
  saveSearch: (query: string) => request<void>("/api/me/search-history", json("POST", { query })),
  deleteSearch: (id?: string) => request<void>(`/api/me/search-history${id ? `/${id}` : ""}`, { method: "DELETE" }),
  timePing: (day: string) => request<void>("/api/me/time", json("POST", { day })),
  timeSpent: (today: string) => request<TimeDay[]>(`/api/me/time?today=${today}`),
  reportProblem: (body: { category: ProblemCategory; description: string; page: string; browser: string }, screenshot: File | null) => {
    const form = new FormData();
    Object.entries(body).forEach(([k, v]) => form.append(k, v));
    if (screenshot) form.append("screenshot", screenshot, screenshot.name);
    return request<{ id: string; created_at: string }>("/api/problem-reports", { method: "POST", body: form });
  },

  // ----- Phase 6E: onboarding, warnings, verification, admin -----
  onboarding: () => firstFromBootstrap("onboarding", () => request<Onboarding>("/api/me/onboarding")),
  saveOnboarding: (body: { step?: OnboardingStep; interests?: Interests }) => request<Onboarding>("/api/me/onboarding", json("PUT", body)),
  skipOnboarding: () => request<Onboarding>("/api/me/onboarding/skip", json("POST")),
  suggestions: () => request<SuggestedPerson[]>("/api/onboarding/suggestions"),
  acknowledgeWarning: (id: string) => request<void>(`/api/me/warnings/${id}/ack`, json("POST")),
  verification: () => request<VerificationState>("/api/me/verification"),
  requestVerification: (reason: string, portfolioUrl: string) =>
    request<VerificationState>("/api/me/verification", json("POST", { reason, portfolio_url: portfolioUrl })),

  admin: {
    stats: () => request<AdminStats>("/api/admin/stats"),
    reports: (status: "open" | "closed", type = "") => request<AdminReport[]>(`/api/admin/reports?${new URLSearchParams({ status, type })}`),
    reportAction: (id: string, action: "dismiss" | "resolve" | "remove", note = "") =>
      request<void>(`/api/admin/reports/${id}/${action}`, json("POST", { note })),
    warn: (userId: string, reason: string, reportId?: string) =>
      request<void>(`/api/admin/users/${userId}/warn`, json("POST", { reason, report_id: reportId ?? null })),
    suspend: (userId: string, reason: string, days: number | null, reportId?: string) =>
      request<void>(`/api/admin/users/${userId}/suspend`, json("POST", { reason, days, report_id: reportId ?? null })),
    suspensions: () => request<AdminSuspension[]>("/api/admin/suspensions"),
    lift: (id: string, note = "") => request<void>(`/api/admin/suspensions/${id}/lift`, json("POST", { note })),
    problemReports: (status: "open" | "closed") => request<AdminProblemReport[]>(`/api/admin/problem-reports?status=${status}`),
    setProblemStatus: (id: string, status: AdminReportStatus) => request<void>(`/api/admin/problem-reports/${id}`, json("POST", { status })),
    /** Opens the screenshot in a new tab (needs the sign-in header, so it is fetched first). */
    openScreenshot: async (id: string) => {
      const res = await send(`/api/admin/problem-reports/${id}/screenshot`);
      window.open(URL.createObjectURL(await res.blob()), "_blank", "noopener");
    },
    verifications: (status: VerificationStatus) => request<VerificationRequest[]>(`/api/admin/verification-requests?status=${status}`),
    reviewVerification: (id: string, approve: boolean, note = "") =>
      request<void>(`/api/admin/verification-requests/${id}/${approve ? "approve" : "reject"}`, json("POST", { note })),
    removeBadge: (userId: string) => request<void>(`/api/admin/verified/${userId}`, { method: "DELETE" }),
    actions: () => request<AdminAction[]>("/api/admin/actions"),
  },
};
