// TypeScript versions of the backend's data shapes (see backend/app/schemas).
// If you change a schema in the backend, update the matching type here.

import type { Appearance, CustomTheme, ProfileThemeChoice } from "./themes";

export type MeasurementUnit = "cm" | "in";
export type SkillLevel = "beginner" | "intermediate" | "advanced" | "professional";

export interface Measurement {
  name: string;
  value: number;
  verified: boolean;
  note: string;
}

export type ReferenceView = "front" | "back" | "side" | "detail";

export interface TailorReference {
  asset_id: string;
  view: ReferenceView;
  note: string;
}

/** Phase 3: notes and reference pictures for the tailor (free text, never calculated). */
export interface TailorNotes {
  construction: string;
  cutting: string;
  stitching: string;
  references: TailorReference[];
}

export interface DesignSpec {
  title: string;
  idea: string;
  garment_category: string;
  occasion: string;
  silhouette: string;
  fit: string;
  neckline: string;
  sleeve_style: string;
  garment_length: string;
  fabric_requirements: string;
  preferred_fabrics: string[];
  colour_palette: string[];
  embellishments: string[];
  closures: string[];
  climate: string;
  measurement_unit: MeasurementUnit;
  measurements: Measurement[];
  budget: { amount: number | null; currency: string; note: string };
  skill_level: SkillLevel;
  design_notes: string;
  visual_description: string;
  reference_asset_ids: string[];
  /** Missing on specs saved before Phase 3. */
  tailor?: TailorNotes;
  unresolved_questions: string[];
  assumptions: string[];
}

export interface ProjectSummary {
  id: string;
  title: string;
  garment_category: string;
  current_version: number;
  thumbnail_asset_id: string | null;
  output_count: number;
  created_at: string;
  updated_at: string;
}

export interface DesignVersion {
  id: string;
  project_id: string;
  version_number: number;
  spec: DesignSpec;
  note: string;
  created_at: string;
}

export interface NotebookMessage {
  id: string;
  project_id: string;
  role: "user" | "assistant";
  content: string;
  is_mock: boolean;
  created_at: string;
}

export type JobStatus = "running" | "succeeded" | "failed";

export interface GenerationJob {
  id: string;
  project_id: string;
  generator_id: string;
  version_number: number;
  status: JobStatus;
  provider: string;
  is_mock: boolean;
  output: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
  stale: boolean;
  stale_fields: string[];
}

export interface Asset {
  id: string;
  project_id: string;
  kind: "upload" | "sketch" | "generated";
  filename: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  // Only set for generated pictures (kind "generated").
  job_id: string | null;
  generator_id: string | null;
  version_number: number | null;
  provider: string | null;
  is_mock: boolean;
}

export interface ProjectDetail {
  project: ProjectSummary;
  current_spec: DesignSpec;
  versions: DesignVersion[];
  messages: NotebookMessage[];
  jobs: GenerationJob[];
  assets: Asset[];
}

export interface GeneratorInfo {
  id: string;
  name: string;
  description: string;
  available: boolean;
  phase: number;
  service: string;
  provider: string | null;
  is_mock: boolean;
  depends_on: string[];
  unavailable_reason: string | null;
  in_package_by_default: boolean;
}

export interface ProviderStatus {
  service: string;
  provider: string;
  is_mock: boolean;
  configured: boolean;
  note: string;
  paid: boolean;
}

export interface ProviderOverview {
  services: ProviderStatus[];
  warnings: string[];
  /** Which API keys are set in backend/.env (true/false only, never the key). */
  keys: Record<string, boolean>;
}

export interface UsageSummary {
  today_usd: number;
  total_usd: number;
  daily_budget_usd: number;
  paid_calls_today: number;
  paid_calls_total: number;
  recent: {
    created_at: string;
    service: string;
    provider: string;
    success: boolean;
    estimated_cost_usd: number;
    duration_ms: number;
    generator_id: string | null;
  }[];
}

export interface PackageResult {
  steps: {
    generator_id: string;
    status: "succeeded" | "failed" | "skipped";
    job_id: string | null;
    reason: string | null;
  }[];
}

// ----- Generator outputs -----

export interface DesignPlan {
  concept_statement: string;
  style_keywords: string[];
  colour_story: { name: string; hex: string; role: string }[];
  design_details: { area: string; detail: string }[];
  construction_overview: { step: string; note: string }[];
  fabric_direction: string;
  difficulty: SkillLevel;
  difficulty_reason: string;
}

export interface DesignConceptOutput {
  summary: string;
  proposed_spec: DesignSpec;
  detected: string[];
  unresolved_questions: string[];
  assumptions: string[];
  /** Phase 2. Older outputs do not have a plan. */
  plan?: DesignPlan | null;
}

export const SKETCH_STYLES = [
  { id: "pencil", label: "Pencil sketch" },
  { id: "ink", label: "Ink drawing" },
  { id: "technical_flat", label: "Technical flat" },
  { id: "charcoal", label: "Charcoal illustration" },
  { id: "coloured", label: "Coloured illustration" },
  { id: "watercolour", label: "Watercolour concept" },
] as const;
export type SketchStyle = (typeof SKETCH_STYLES)[number]["id"];

export interface SketchOutput {
  style: SketchStyle;
  svg: string | null;
  asset_id: string | null;
  caption: string;
  prompt?: string;
  editable: boolean;
}

export interface PreviewOutput {
  svg: string | null;
  asset_id: string | null;
  caption: string;
  prompt?: string;
  editable: boolean;
}

export type Level = "low" | "medium" | "high";

export interface FabricRecommendation {
  name: string;
  swatch_colour: string;
  texture: "plain" | "twill" | "satin" | "sheer" | "knit" | "pile" | "slub" | "crepe";
  suitability: string;
  properties: string[];
  advantages: string[];
  limitations: string[];
  care: string;
  drape: Level;
  breathability: Level;
  approximate_cost: string | null;
  score: number;
  // Phase 3 factors (missing on older outputs).
  comfort?: Level;
  maintenance?: "easy" | "moderate" | "delicate";
  weight?: "light" | "medium" | "heavy";
  /** Compared with the other fabrics listed. Not a price. */
  cost_level?: Level | null;
  climate_fit?: string;
  occasion_fit?: string;
  budget_note?: string;
  lining_needed?: boolean;
}

export interface Suggestion {
  name: string;
  reason: string;
}

export interface FabricOutput {
  recommendations: FabricRecommendation[];
  lining: string[];
  complementary_materials: string[];
  considerations: string[];
  lining_options?: Suggestion[];
  embellishment_options?: Suggestion[];
}

export interface ChecklistItem {
  item: string;
  category: "tool" | "material" | "notion" | "embellishment";
  reason: string;
  optional: boolean;
  linked_to?: string;
  quantity_hint?: string;
}

export interface MaterialsOutput {
  items: ChecklistItem[];
  notes: string[];
  based_on?: string[];
}

export interface TailorSheetOutput {
  title: string;
  sections: { heading: string; rows: [string, string][] }[];
  measurements: { name: string; value: string; status: string; note: string }[];
  missing_measurements: string[];
  construction_notes: string[];
  cutting_notes: string[];
  warnings: string[];
  unit?: string;
  stitching_notes?: string[];
  references?: { asset_id: string; view: string; note: string }[];
  open_questions?: string[];
}

export type CostKind = "fabric" | "lining" | "notion" | "embellishment" | "other";

export interface CostLineInput {
  item: string;
  kind: CostKind;
  quantity: number | null;
  unit: string;
  unit_price: number | null;
  price_source: string;
}

export interface LabourInput {
  task: string;
  amount: number | null;
  note: string;
}

/** What the user types into the Cost Estimate form (sent as generator options). */
export interface CostInputs {
  currency: string;
  region: string;
  price_date: string;
  materials: CostLineInput[];
  labour: LabourInput[];
  contingency_percent: number;
}

export interface CostEstimateOutput {
  currency: string;
  region: string;
  price_date: string;
  materials: (CostLineInput & { line_total: number | null; status: "priced" | "missing_price" | "missing_quantity" | "missing_both" })[];
  labour: (LabourInput & { status: "quoted" | "missing" })[];
  materials_subtotal: number;
  contingency_percent: number;
  contingency_amount: number;
  labour_subtotal: number;
  total: number;
  complete: boolean;
  missing: string[];
  assumptions: string[];
  budget_amount: number | null;
  budget_currency: string;
  budget_status: "within" | "over" | "unknown";
  budget_note: string;
}

// ----- Phase 4: learning and advanced generators -----

export interface TutorialVideo {
  video_id: string;
  title: string;
  channel: string;
  url: string;
  thumbnail_url: string;
  published_at: string;
  duration: string;
  description: string;
  topic: string;
  relevance: string[];
  score: number;
}

export interface TutorialOutput {
  source: string;
  connected: boolean;
  language: string;
  steps: { topic: string; why: string; search_query: string; search_url: string; video_ids: string[] }[];
  videos: TutorialVideo[];
  notes: string[];
}

// ----- Stitching Guide -----

export type GuidePhase = "prep" | "shaping" | "main_seams" | "openings" | "side_seams" | "hem" | "pressing";

export interface GarmentComponents {
  garment_type: string;
  family: string;
  bodice: string;
  neckline: string;
  neckline_finish: string;
  sleeves: string;
  skirt: string;
  closure: string;
  closure_position: string;
  length: string;
  fabric: string;
  fabric_class: string;
  fabric_weight: "light" | "medium" | "heavy";
  lined: boolean;
  features: string[];
  source: "spec" | "spec+photo";
  assumptions: string[];
  photo_notes: string[];
}

export interface GuideVideo {
  video_id: string;
  title: string;
  channel: string;
  url: string;
  thumbnail_url: string;
  duration: string;
  start_seconds: number;
  end_seconds: number | null;
  timing: "chapter" | "indexed" | "whole_video";
  chapter_title: string;
  relevance: string[];
}

export interface GuideStep {
  key: string;
  number: number;
  phase: GuidePhase;
  phase_label: string;
  title: string;
  module_slug: string;
  module_title: string;
  why: string;
  instructions: string[];
  tips: string[];
  fabric_tips: string[];
  video: GuideVideo | null;
  more_videos: GuideVideo[];
  video_status: "found" | "none" | "not_connected";
  search_query: string;
  search_url: string;
}

export interface FabricCard {
  fabric: string;
  needle: string;
  thread: string;
  stitch_length: string;
  seam_types: string[];
  pressing: string;
  notes: string[];
}

export interface StitchingGuideOutput {
  garment: GarmentComponents;
  fabric_card: FabricCard | null;
  steps: GuideStep[];
  knowledge_source: string;
  video_source: string;
  video_connected: boolean;
  video_language: string;
  notes: string[];
}

export interface StitchingProgress {
  version_number: number;
  done_keys: string[];
}

export interface ColourSwatch {
  name: string;
  hex: string;
  role: string;
}

export interface DesignVariation {
  kind: "neckline" | "sleeves" | "silhouette" | "embellishment" | "colour";
  name: string;
  description: string;
  why: string;
  neckline: string;
  sleeve_style: string;
  silhouette: string;
  embellishments: string[];
  colour_palette: string[];
  colour_hex: string[];
}

export interface VariationsOutput {
  base_summary: string;
  variations: DesignVariation[];
  notes: string[];
}

export interface MoodboardOutput {
  title: string;
  story: string;
  mood_words: string[];
  palette: ColourSwatch[];
  textures: { name: string; texture: FabricRecommendation["texture"]; colour: string; note: string }[];
  motifs: string[];
  references: string[];
  image_asset_ids: string[];
  notes: string[];
}

export type Placement = "neckline" | "yoke" | "bodice" | "sleeves" | "cuffs" | "waist" | "hem" | "back" | "dupatta" | "all_over";

export interface EmbroideryConcept {
  name: string;
  kind: "embroidery" | "print" | "surface";
  technique: string;
  motif: string;
  placements: Placement[];
  placement_note: string;
  scale: "fine" | "medium" | "bold";
  colours: ColourSwatch[];
  materials: string[];
  difficulty: SkillLevel;
  effort_note: string;
}

export interface EmbroideryOutput {
  concepts: EmbroideryConcept[];
  notes: string[];
}

export interface PatternOutput {
  conceptual: boolean;
  disclaimer: string;
  garment: string;
  unit: string;
  required_measurements: { name: string; value: string; status: string }[];
  missing_measurements: string[];
  pieces: { name: string; cut: string; fabric: "main" | "lining" | "interfacing"; grain: string; size: "large" | "medium" | "small"; notes: string }[];
  drafting_steps: { step: string; uses: string[]; note: string }[];
  layout: { fold: string; nap: boolean; steps: string[] };
  warnings: string[];
}

export interface VideoOutput {
  mode: "generated" | "storyboard";
  provider_note: string;
  title: string;
  scenes: { number: number; title: string; shot: string; action: string; narration: string; on_screen_text: string; seconds: number }[];
  script: string;
  tutorial_videos: TutorialVideo[];
  notes: string[];
}

// ----- Phase 6A: profiles, posts and the feed -----

export type Role = "designer" | "tailor" | "boutique" | "student" | "other";
export type Visibility = "public" | "followers" | "close_friends" | "private";
/** "deleted" = in Recently deleted (Phase 6D), only the author sees it. */
export type PostStatus = "draft" | "published" | "archived" | "deleted";

export interface Profile {
  user_id: string;
  username: string;
  display_name: string;
  bio: string;
  role: Role;
  has_avatar: boolean;
  avatar_version: string | null;
  /** Private account: only approved followers see the posts. */
  is_private: boolean;
  /** The verified badge (Phase 6E). */
  verified: boolean;
}

export type FollowStatus = "none" | "requested" | "following";

export interface ProfileDetail extends Profile {
  post_count: number;
  follower_count: number;
  following_count: number;
  is_me: boolean;
  is_following: boolean;
  is_close_friend: boolean;
  /** "requested" while a follow request to a private account waits for an answer. */
  follow_status: FollowStatus;
  follows_me: boolean;
  /** False for a private account you do not follow (or someone you blocked). */
  can_see_posts: boolean;
  blocked_by_me: boolean;
  restricted_by_me: boolean;
  muted_by_me: boolean;
  /** Only on your own profile: follow requests waiting for you. */
  request_count: number;
  /** May you open a chat with this person? */
  can_message: boolean;
  /** Phase 8: the owner's profile theme and the Premium tag. */
  appearance: ProfileAppearance;
}

export interface ProfileAppearance {
  profile_theme: ProfileThemeChoice;
  custom_theme: CustomTheme | null;
  is_premium: boolean;
}

export interface PersonSummary {
  user_id: string;
  username: string;
  display_name: string;
  has_avatar: boolean;
  avatar_version: string | null;
  /** The verified badge (Phase 6E). Optional so older code that builds a person still works. */
  verified?: boolean;
}

export interface PostTags {
  garment: string;
  fabric: string;
  occasion: string;
}

export interface PaletteColour {
  name: string;
  hex: string;
}

export interface FabricChoice {
  name: string;
  texture: string;
  swatch: string;
}

export interface Post {
  id: string;
  author: PersonSummary;
  status: PostStatus;
  visibility: Visibility;
  caption: string;
  tags: PostTags;
  palette: PaletteColour[];
  fabrics: FabricChoice[];
  images: { id: string; kind: "sketch" | "generated" }[];
  pinned: boolean;
  like_count: number;
  save_count: number;
  liked_by_me: boolean;
  saved_by_me: boolean;
  is_mine: boolean;
  repost_count: number;
  reposted_by_me: boolean;
  /** Public posts from public accounts can be reposted (never your own). */
  can_repost: boolean;
  comment_count: number;
  /** The author's "Who can comment" allows you. */
  can_comment: boolean;
  /** When it went to Recently deleted (author only). */
  deleted_at: string | null;
  /** Set when someone you follow reposted it (feed) or on a profile's Reposts tab. */
  reposted_by: PersonSummary | null;
  /** Only for the author; null if the design was deleted. */
  project_id: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PostPage {
  posts: Post[];
  next_cursor: string | null;
}

export interface ProfilePostsPage extends PostPage {
  /** Pinned posts, only on the first page. */
  pinned: Post[];
}

export interface PostContentChoice {
  image_asset_ids: string[];
  show_palette: boolean;
  show_fabric: boolean;
}

export interface PublishOptions {
  images: { asset_id: string; kind: "sketch" | "generated"; label: string }[];
  palette: PaletteColour[];
  fabrics: FabricChoice[];
  suggested_caption: string;
  suggested_tags: PostTags;
  has_profile: boolean;
}

// ----- Phase 6B: follow requests, comments, reports, Explore -----

export interface PersonListItem extends PersonSummary {
  since: string;
}

export interface PeoplePage {
  people: PersonListItem[];
  next_offset: number | null;
}

export interface Comment {
  id: string;
  post_id: string;
  parent_id: string | null;
  author: PersonSummary;
  body: string;
  /** False while it waits for the post owner's approval (restricted writer). */
  approved: boolean;
  like_count: number;
  liked_by_me: boolean;
  is_mine: boolean;
  can_delete: boolean;
  can_approve: boolean;
  /** Has one of the post owner's hidden words (only its writer and the owner see it). */
  hidden: boolean;
  created_at: string;
  replies: Comment[];
}

export interface CommentList {
  comments: Comment[];
  total: number;
  truncated: boolean;
}

export type ReportTarget = "post" | "comment" | "user" | "message";
export type ReportReason = "spam" | "nudity" | "harassment" | "hate" | "violence" | "scam" | "copied_design" | "false_information" | "other";

export interface FilterOption {
  value: string;
  count: number;
}

export interface ExploreFilters {
  garments: FilterOption[];
  occasions: FilterOption[];
  colours: FilterOption[];
  fabrics: FilterOption[];
}

export interface ExploreFilterChoice {
  garment: string;
  occasion: string;
  colour: string;
  fabric: string;
}

export interface SearchResults {
  people: PersonSummary[];
  tags: { kind: "garment" | "fabric" | "occasion"; value: string; count: number }[];
  posts: Post[];
}

// ----- Phase 6C: chats and notifications -----

export type AllowMessages = "everyone" | "followers" | "nobody";
export type ChatStatus = "accepted" | "request";
export type NotificationType = "like" | "comment" | "reply" | "follow" | "follow_request" | "mention" | "repost" | "message";

export interface SharedPost {
  id: string;
  author: PersonSummary;
  image_id: string | null;
  caption: string;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  is_mine: boolean;
  kind: "text" | "post" | "design";
  body: string;
  /** For kind "post", when you may see the post. */
  post: SharedPost | null;
  /** For kind "post": the post was deleted or you may not see it. */
  post_unavailable: boolean;
  /** kind "design": the picture is at api.messageImageUrl(id). */
  has_image: boolean;
  created_at: string;
}

export interface MessagePage {
  /** Oldest first. */
  messages: ChatMessage[];
  /** Pass back as `before` for older messages; null when there are no more. */
  next_cursor: string | null;
}

export interface ChatSummary {
  id: string;
  other: PersonSummary | null;
  /** Your side: "request" while it waits in your Requests folder. */
  status: ChatStatus;
  last_message: string;
  last_message_mine: boolean;
  last_message_at: string;
  unread_count: number;
}

export interface ChatList {
  chats: ChatSummary[];
  request_count: number;
}

export interface ChatDetail {
  id: string;
  other: PersonSummary | null;
  status: ChatStatus;
  can_send: boolean;
  cannot_send_reason: string | null;
  blocked_by_me: boolean;
  /** Your newest message the other person has read. */
  seen_message_id: string | null;
}

export interface SendResult {
  username: string;
  ok: boolean;
  conversation_id: string | null;
  error: string | null;
}

export interface NotificationItem {
  id: string;
  type: NotificationType;
  actor: PersonSummary | null;
  post_id: string | null;
  post_image_id: string | null;
  comment_id: string | null;
  comment_excerpt: string | null;
  conversation_id: string | null;
  created_at: string;
  read: boolean;
  request_pending: boolean;
  following_actor: boolean;
}

export interface NotificationPage {
  notifications: NotificationItem[];
  next_cursor: string | null;
}

export interface NotificationSettings {
  likes: boolean;
  comments: boolean;
  replies: boolean;
  follows: boolean;
  follow_requests: boolean;
  mentions: boolean;
  reposts: boolean;
  messages: boolean;
}

/** GET /api/me/bootstrap: what the app frame needs when a page opens, in one answer. */
export interface Bootstrap {
  profile: Profile | null;
  account: AccountStatus;
  onboarding: Onboarding;
  appearance: Appearance;
  badges: Badges;
}

export interface Badges {
  /** Unread notifications (messages are counted under chats). */
  notifications: number;
  /** Chats with unread messages. */
  chats: number;
  /** Message requests waiting. */
  requests: number;
}

// ----- Phase 6D: settings, your activity, help -----

export type Audience = "everyone" | "followers" | "nobody";

export interface AccountStatus {
  email: string;
  has_profile: boolean;
  username: string | null;
  deactivated: boolean;
  delete_requested_at: string | null;
  /** The account is deleted for good on this date unless you cancel. */
  delete_after: string | null;
  is_admin: boolean;
  suspension: Suspension | null;
  /** Admin warnings you have not acknowledged yet. */
  warnings: { id: string; reason: string; created_at: string }[];
}

export interface PrivacyChoices {
  allow_comments_from: Audience;
  allow_mentions_from: Audience;
  hidden_words: string[];
}

export interface SearchEntry {
  id: string;
  query: string;
  created_at: string;
}

export interface TimeDay {
  day: string;
  seconds: number;
}

export interface MyComment {
  id: string;
  body: string;
  approved: boolean;
  created_at: string;
  post_id: string;
  post_image_id: string | null;
  post_author: PersonSummary | null;
}

export type ProblemCategory = "bug" | "account" | "design_tools" | "social" | "payments" | "other";

// ----- Phase 6E: onboarding, verification, admin -----

export type OnboardingStep = "profile" | "avatar" | "interests" | "follow" | "tour" | "done";

export interface Interests {
  garments: string[];
  fabrics: string[];
  styles: string[];
}

export interface Onboarding {
  step: OnboardingStep;
  interests: Interests;
  completed: boolean;
  skipped: boolean;
  has_profile: boolean;
  /** They opened the welcome steps before (progress is saved). */
  started: boolean;
  /** Never started and no profile yet: open the welcome steps for them once. */
  is_new: boolean;
}

export interface SuggestedPerson extends PersonSummary {
  role: Role;
  is_private: boolean;
  follower_count: number;
  post_count: number;
}

export interface Suspension {
  id: string;
  reason: string;
  starts_at: string;
  ends_at: string | null;
  permanent: boolean;
}

export type VerificationStatus = "pending" | "approved" | "rejected";

export interface VerificationRequest {
  id: string;
  reason: string;
  portfolio_url: string;
  status: VerificationStatus;
  review_note: string;
  created_at: string;
  reviewed_at: string | null;
  person: PersonSummary | null;
}

export interface VerificationState {
  verified: boolean;
  source: "admin" | "premium" | null;
  latest_request: VerificationRequest | null;
}

export type AdminReportStatus = "open" | "reviewing" | "resolved" | "dismissed";

export interface AdminStats {
  total_users: number;
  new_users_this_week: number;
  profiles: number;
  published_posts: number;
  open_reports: number;
  open_problem_reports: number;
  pending_verifications: number;
  active_suspensions: number;
}

export interface AdminReport {
  id: string;
  target_type: ReportTarget;
  reason: ReportReason;
  details: string;
  excerpt: string;
  status: AdminReportStatus;
  created_at: string;
  reporter: PersonSummary | null;
  reported: PersonSummary | null;
  reported_user_id: string | null;
  post_id: string | null;
  comment_id: string | null;
  message_id: string | null;
  target_exists: boolean;
  reports_about_person: number;
  resolution_note: string;
  resolved_at: string | null;
}

export interface AdminSuspension extends Suspension {
  user_id: string;
  person: PersonSummary | null;
  lifted_at: string | null;
}

export interface AdminProblemReport {
  id: string;
  category: ProblemCategory;
  description: string;
  page: string;
  browser: string;
  status: AdminReportStatus;
  has_screenshot: boolean;
  created_at: string;
  person: PersonSummary | null;
  email: string | null;
}

export interface AdminAction {
  id: string;
  action: string;
  admin: PersonSummary | null;
  target: PersonSummary | null;
  note: string;
  details: Record<string, unknown>;
  created_at: string;
}
