import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  Unique,
} from 'typeorm';

export enum PlatformRole {
  WISPO_ADMIN = 'wispo_admin',
  EMPLOYEE = 'employee',
  /** Legacy values are accepted until the access-model migration has run. */
  AGENCY_MEMBER = 'agency_member',
  MEMBER = 'member',
}

export enum WorkspaceRole {
  EMPLOYEE = 'employee',
  /** Legacy values are normalized to EMPLOYEE by the access-model migration. */
  WORKSPACE_ADMIN = 'workspace_admin',
  DEVELOPER = 'developer',
  CONTENT_MANAGER = 'content_manager',
  CLIENT_APPROVER = 'client_approver',
}

export enum SiteType {
  MEDIA = 'media',
  CORPORATE = 'corporate',
  LANDING = 'landing',
}

export enum DomainStatus {
  NOT_CONFIGURED = 'not_configured',
  PENDING = 'pending',
  VERIFIED = 'verified',
  ERROR = 'error',
}

export enum ArticleStatus {
  DRAFT = 'draft',
  REVIEW = 'review',
  CHANGES = 'changes_requested',
  PUBLISHED = 'published',
  HIDDEN = 'hidden',
}

export enum PublicationState {
  DRAFT = 'draft',
  PUBLISHED = 'published',
  HIDDEN = 'hidden',
  DISABLED = 'disabled',
  ARCHIVE = 'archive',
}

export enum EditorialState {
  DRAFT = 'draft',
  REVIEW = 'review',
  CHANGES = 'changes',
  APPROVED = 'approved',
}

export enum ContentEntityType {
  ARTICLE = 'article',
  CATEGORY = 'category',
}

export enum ContentActorKind {
  USER = 'user',
  SYSTEM = 'system',
}

export enum ContentEventType {
  CREATED = 'created',
  CONTENT_UPDATED = 'content_updated',
  PARAMETERS_UPDATED = 'parameters_updated',
  SEO_UPDATED = 'seo_updated',
  MOVED = 'moved',
  PUBLICATION_CHANGED = 'publication_changed',
  EDITORIAL_CHANGED = 'editorial_changed',
  SCHEDULED = 'scheduled',
  SCHEDULE_CANCELLED = 'schedule_cancelled',
  SCHEDULE_EXECUTED = 'schedule_executed',
  SCHEDULE_FAILED = 'schedule_failed',
  VERSION_CREATED = 'version_created',
  VERSION_RESTORED = 'version_restored',
  DUPLICATED = 'duplicated',
  DELETED = 'deleted',
  RESTORED = 'restored',
  REDIRECT_CREATED = 'redirect_created',
  REDIRECT_REMOVED = 'redirect_removed',
  RELATED_UPDATED = 'related_updated',
}

export enum ContentScheduleStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  FAILED = 'failed',
}

export enum ContentTemplateKind {
  ARTICLES_LIST = 'articles_list',
  ARTICLE = 'article',
  CATEGORY = 'category',
}

export enum CategoryStatus {
  ACTIVE = 'active',
  HIDDEN = 'hidden',
  DRAFT = 'draft',
}

export type ArticleDocumentBlock =
  | {
      id: string;
      type: 'heading';
      text: string;
      level: 2 | 3 | 4;
    }
  | {
      id: string;
      type: 'paragraph';
      text: string;
      href?: string | null;
    }
  | {
      id: string;
      type: 'image';
      mediaId: string;
      alt?: string;
      caption?: string;
    }
  | { id: string; type: 'bullet_list'; items: string[] }
  | { id: string; type: 'numbered_list'; items: string[] }
  | {
      id: string;
      type: 'quote';
      text: string;
      cite?: string;
    };

export type ArticleDocument = {
  version: 1;
  blocks: ArticleDocumentBlock[];
};

export enum ArticleActivityType {
  UPDATED = 'updated',
  COMMENT = 'comment',
  STATUS_CHANGED = 'status_changed',
}

export enum PageKind {
  HOMEPAGE = 'homepage',
  PAGE = 'page',
}

export enum PageStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
}

export enum BannerPlacement {
  HOMEPAGE_TOP = 'homepage_top',
  HOMEPAGE_MIDDLE = 'homepage_middle',
  ARTICLE_SIDEBAR = 'article_sidebar',
}

export type PageBlock = {
  id: string;
  type: 'hero' | 'text' | 'cta';
  title?: string;
  text?: string;
  buttonLabel?: string;
  buttonUrl?: string;
  mediaId?: string;
  data?: Record<string, unknown>;
};

export type SiteGlobalData = {
  companyName?: string;
  organizationType?: 'ip' | 'ooo' | 'self_employed' | 'other';
  legalName?: string;
  inn?: string;
  ogrn?: string;
  legalAddress?: string;
  phone?: string;
  email?: string;
  address?: string;
  telegramUrl?: string;
  vkUrl?: string;
};

export type SiteLayoutSettings = {
  logoText?: string;
  logoMediaId?: string;
  showPages?: boolean;
  showArticles?: boolean;
  ctaLabel?: string;
  ctaUrl?: string;
  footerDescription?: string;
  showContacts?: boolean;
  showSocials?: boolean;
};

@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255 })
  email!: string;

  @Column({ name: 'password_hash', type: 'varchar', length: 255 })
  passwordHash!: string;

  @Column({ name: 'full_name', type: 'varchar', length: 160 })
  fullName!: string;

  @Column({
    name: 'platform_role',
    type: 'varchar',
    length: 40,
    default: PlatformRole.EMPLOYEE,
  })
  platformRole!: PlatformRole;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @OneToMany(() => WorkspaceMembershipEntity, (membership) => membership.user)
  memberships!: WorkspaceMembershipEntity[];

  @OneToMany(() => ArticleActivityEntity, (activity) => activity.user)
  articleActivities!: ArticleActivityEntity[];

  @OneToMany(() => AuditLogEntity, (entry) => entry.actor)
  auditEntries!: AuditLogEntity[];
}

@Entity('workspaces')
export class WorkspaceEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 160 })
  name!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 100 })
  slug!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @OneToMany(() => SiteEntity, (site) => site.workspace)
  sites!: SiteEntity[];

  @OneToMany(() => MediaEntity, (media) => media.workspace)
  media!: MediaEntity[];

  @OneToMany(
    () => WorkspaceMembershipEntity,
    (membership) => membership.workspace,
  )
  memberships!: WorkspaceMembershipEntity[];
}

@Entity('sites')
@Unique(['workspaceId', 'slug'])
@Check(
  'CHK_sites_site_type',
  `"site_type" IN ('media', 'corporate', 'landing')`,
)
export class SiteEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @ManyToOne(() => WorkspaceEntity, (workspace) => workspace.sites, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'workspace_id' })
  workspace!: WorkspaceEntity;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId!: string | null;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_user_id' })
  createdBy!: UserEntity | null;

  @Column({ type: 'varchar', length: 160 })
  name!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 100 })
  slug!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  domain!: string | null;

  @Column({
    name: 'domain_status',
    type: 'varchar',
    length: 24,
    default: DomainStatus.NOT_CONFIGURED,
  })
  domainStatus!: DomainStatus;

  @Column({ name: 'domain_checked_at', type: 'timestamptz', nullable: true })
  domainCheckedAt!: Date | null;

  @Column({
    name: 'domain_status_message',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  domainStatusMessage!: string | null;

  @Column({ name: 'linked_commercial_site_id', type: 'uuid', nullable: true })
  linkedCommercialSiteId!: string | null;

  @ManyToOne(() => SiteEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'linked_commercial_site_id' })
  linkedCommercialSite!: SiteEntity | null;

  @Column({
    name: 'site_type',
    type: 'varchar',
    length: 32,
  })
  siteType!: SiteType;

  @Column({ name: 'seo_title', type: 'varchar', length: 200, nullable: true })
  seoTitle!: string | null;

  @Column({
    name: 'seo_description',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  seoDescription!: string | null;

  @Column({
    name: 'canonical_url',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  canonicalUrl!: string | null;

  @Column({ name: 'seo_image_media_id', type: 'uuid', nullable: true })
  seoImageMediaId!: string | null;

  @Column({ name: 'no_index', type: 'boolean', default: false })
  noIndex!: boolean;

  @Column({
    name: 'notification_email',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  notificationEmail!: string | null;

  @Column({ name: 'global_data', type: 'jsonb', default: () => "'{}'::jsonb" })
  globalData!: SiteGlobalData;

  @Column({
    name: 'layout_settings',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  layoutSettings!: SiteLayoutSettings;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @OneToMany(() => CategoryEntity, (category) => category.site)
  categories!: CategoryEntity[];

  @OneToMany(() => AuthorEntity, (author) => author.site)
  authors!: AuthorEntity[];

  @OneToMany(() => ArticleEntity, (article) => article.site)
  articles!: ArticleEntity[];

  @OneToMany(() => MediaEntity, (media) => media.site)
  media!: MediaEntity[];

  @OneToMany(() => PageEntity, (page) => page.site)
  pages!: PageEntity[];

  @OneToMany(() => BannerEntity, (banner) => banner.site)
  banners!: BannerEntity[];

  @OneToMany(() => AuditLogEntity, (entry) => entry.site)
  auditEntries!: AuditLogEntity[];

  @OneToMany(() => PrivacyPolicyStateEntity, (state) => state.site)
  privacyPolicyStates!: PrivacyPolicyStateEntity[];
}

@Entity('workspace_memberships')
@Unique(['userId', 'workspaceId'])
export class WorkspaceMembershipEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => UserEntity, (user) => user.memberships, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'user_id' })
  user!: UserEntity;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @ManyToOne(() => WorkspaceEntity, (workspace) => workspace.memberships, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'workspace_id' })
  workspace!: WorkspaceEntity;

  @Column({ type: 'varchar', length: 40 })
  role!: WorkspaceRole;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

export type AuditChanges = {
  submittedValues?: Record<string, unknown>;
  redactedFields?: string[];
};

@Entity('audit_logs')
@Index(['createdAt'])
@Index(['workspaceId', 'createdAt'])
@Index(['siteId', 'createdAt'])
export class AuditLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId!: string | null;

  @ManyToOne(() => UserEntity, (user) => user.auditEntries, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'actor_user_id' })
  actor!: UserEntity | null;

  @Column({ name: 'actor_name', type: 'varchar', length: 160 })
  actorName!: string;

  @Column({ name: 'workspace_id', type: 'uuid', nullable: true })
  workspaceId!: string | null;

  @ManyToOne(() => WorkspaceEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'workspace_id' })
  workspace!: WorkspaceEntity | null;

  @Column({ name: 'site_id', type: 'uuid', nullable: true })
  siteId!: string | null;

  @ManyToOne(() => SiteEntity, (site) => site.auditEntries, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'site_id' })
  site!: SiteEntity | null;

  @Column({ name: 'entity_type', type: 'varchar', length: 80 })
  entityType!: string;

  @Column({ name: 'entity_id', type: 'varchar', length: 160, nullable: true })
  entityId!: string | null;

  @Column({ type: 'varchar', length: 40 })
  action!: string;

  @Column({ type: 'varchar', length: 500 })
  description!: string;

  @Column({ type: 'jsonb', nullable: true })
  changes!: AuditChanges | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

@Entity('categories')
@Unique(['siteId', 'slug'])
export class CategoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'site_id', type: 'uuid' })
  siteId!: string;

  @ManyToOne(() => SiteEntity, (site) => site.categories, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'site_id' })
  site!: SiteEntity;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'varchar', length: 100 })
  slug!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 24, default: CategoryStatus.ACTIVE })
  status!: CategoryStatus;

  @Column({
    name: 'publication_state',
    type: 'varchar',
    length: 24,
    default: PublicationState.DRAFT,
  })
  publicationState!: PublicationState;

  @Column({ name: 'display_template_key', type: 'varchar', length: 80 })
  displayTemplateKey!: string;

  @Column({ name: 'display_template_version', type: 'varchar', length: 40 })
  displayTemplateVersion!: string;

  @Column({
    name: 'display_template_config',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  displayTemplateConfig!: Record<string, unknown>;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  @Column({ name: 'deleted_by_user_id', type: 'uuid', nullable: true })
  deletedByUserId!: string | null;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt!: Date | null;

  @Column({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder!: number;

  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId!: string | null;

  @ManyToOne(() => CategoryEntity, (category) => category.children, {
    nullable: true,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'parent_id' })
  parent!: CategoryEntity | null;

  @OneToMany(() => CategoryEntity, (category) => category.parent)
  children!: CategoryEntity[];

  @Column({ type: 'varchar', length: 20, default: '#9f91ef' })
  color!: string;

  @Column({ type: 'varchar', length: 80, nullable: true })
  icon!: string | null;

  @Column({ name: 'image_media_id', type: 'uuid', nullable: true })
  imageMediaId!: string | null;

  @ManyToOne(() => MediaEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'image_media_id' })
  imageMedia!: MediaEntity | null;

  @Column({ name: 'seo_title', type: 'varchar', length: 240, nullable: true })
  seoTitle!: string | null;

  @Column({
    name: 'seo_description',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  seoDescription!: string | null;

  @Column({
    name: 'canonical_url',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  canonicalUrl!: string | null;

  @Column({ name: 'no_index', type: 'boolean', default: false })
  noIndex!: boolean;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId!: string | null;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_user_id' })
  createdBy!: UserEntity | null;

  @Column({ name: 'updated_by_user_id', type: 'uuid', nullable: true })
  updatedByUserId!: string | null;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'updated_by_user_id' })
  updatedBy!: UserEntity | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => ArticleEntity, (article) => article.category)
  articles!: ArticleEntity[];
}

@Entity('category_redirects')
@Unique(['siteId', 'fromSlug'])
export class CategoryRedirectEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'site_id', type: 'uuid' })
  siteId!: string;

  @ManyToOne(() => SiteEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'site_id' })
  site!: SiteEntity;

  @Column({ name: 'category_id', type: 'uuid' })
  categoryId!: string;

  @ManyToOne(() => CategoryEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'category_id' })
  category!: CategoryEntity;

  @Column({ name: 'from_slug', type: 'varchar', length: 100 })
  fromSlug!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

@Entity('category_activities')
export class CategoryActivityEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'category_id', type: 'uuid' })
  categoryId!: string;

  @ManyToOne(() => CategoryEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'category_id' })
  category!: CategoryEntity;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId!: string | null;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'user_id' })
  user!: UserEntity | null;

  @Column({ type: 'varchar', length: 40 })
  action!: string;

  @Column({ type: 'text', nullable: true })
  message!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

@Entity('authors')
export class AuthorEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'site_id', type: 'uuid' })
  siteId!: string;

  @ManyToOne(() => SiteEntity, (site) => site.authors, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'site_id' })
  site!: SiteEntity;

  @Column({ name: 'full_name', type: 'varchar', length: 160 })
  fullName!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email!: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  bio!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @OneToMany(() => ArticleEntity, (article) => article.author)
  articles!: ArticleEntity[];
}

@Entity('media')
export class MediaEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @ManyToOne(() => WorkspaceEntity, (workspace) => workspace.media, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'workspace_id' })
  workspace!: WorkspaceEntity;

  @Column({ name: 'site_id', type: 'uuid', nullable: true })
  siteId!: string | null;

  @ManyToOne(() => SiteEntity, (site) => site.media, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'site_id' })
  site!: SiteEntity | null;

  @Column({ name: 'storage_namespace', type: 'varchar', length: 100 })
  storageNamespace!: string;

  @Column({ name: 'stored_name', type: 'varchar', length: 255 })
  storedName!: string;

  @Column({ name: 'original_name', type: 'varchar', length: 255 })
  originalName!: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 100 })
  mimeType!: string;

  @Column({ type: 'integer' })
  size!: number;

  @Column({ name: 'alt_text', type: 'varchar', length: 300, nullable: true })
  altText!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @OneToMany(() => ArticleEntity, (article) => article.coverMedia)
  coverArticles!: ArticleEntity[];
}

@Entity('articles')
@Unique(['siteId', 'slug'])
export class ArticleEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'site_id', type: 'uuid' })
  siteId!: string;

  @ManyToOne(() => SiteEntity, (site) => site.articles, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'site_id' })
  site!: SiteEntity;

  @Column({ name: 'category_id', type: 'uuid', nullable: true })
  categoryId!: string | null;

  @ManyToOne(() => CategoryEntity, (category) => category.articles, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'category_id' })
  category!: CategoryEntity | null;

  @Column({ name: 'author_id', type: 'uuid', nullable: true })
  authorId!: string | null;

  @ManyToOne(() => AuthorEntity, (author) => author.articles, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'author_id' })
  author!: AuthorEntity | null;

  @Column({ name: 'cover_media_id', type: 'uuid', nullable: true })
  coverMediaId!: string | null;

  @ManyToOne(() => MediaEntity, (media) => media.coverArticles, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'cover_media_id' })
  coverMedia!: MediaEntity | null;

  @Column({ name: 'preview_media_id', type: 'uuid', nullable: true })
  previewMediaId!: string | null;

  @ManyToOne(() => MediaEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'preview_media_id' })
  previewMedia!: MediaEntity | null;

  @Column({ type: 'varchar', length: 240 })
  title!: string;

  @Column({ type: 'varchar', length: 160 })
  slug!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  excerpt!: string | null;

  @Column({ type: 'text', default: '' })
  body!: string;

  @Column({ name: 'body_document', type: 'jsonb', nullable: true })
  bodyDocument!: ArticleDocument | null;

  @Column({ name: 'document_version', type: 'integer', default: 1 })
  documentVersion!: number;

  @Column({ name: 'seo_title', type: 'varchar', length: 240, nullable: true })
  seoTitle!: string | null;

  @Column({
    name: 'seo_description',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  seoDescription!: string | null;

  @Column({
    name: 'canonical_url',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  canonicalUrl!: string | null;

  @Column({ name: 'no_index', type: 'boolean', default: false })
  noIndex!: boolean;

  @Column({ type: 'varchar', length: 32, default: ArticleStatus.DRAFT })
  status!: ArticleStatus;

  @Column({
    name: 'publication_state',
    type: 'varchar',
    length: 24,
    default: PublicationState.DRAFT,
  })
  publicationState!: PublicationState;

  @Column({
    name: 'editorial_state',
    type: 'varchar',
    length: 24,
    default: EditorialState.DRAFT,
  })
  editorialState!: EditorialState;

  @Column({ name: 'display_template_key', type: 'varchar', length: 80 })
  displayTemplateKey!: string;

  @Column({ name: 'display_template_version', type: 'varchar', length: 40 })
  displayTemplateVersion!: string;

  @Column({
    name: 'display_template_config',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  displayTemplateConfig!: Record<string, unknown>;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  @Column({ name: 'deleted_by_user_id', type: 'uuid', nullable: true })
  deletedByUserId!: string | null;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt!: Date | null;

  @Column({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder!: number;

  @Column({ type: 'integer', default: 0 })
  revision!: number;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId!: string | null;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_user_id' })
  createdBy!: UserEntity | null;

  @Column({ name: 'updated_by_user_id', type: 'uuid', nullable: true })
  updatedByUserId!: string | null;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'updated_by_user_id' })
  updatedBy!: UserEntity | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => ArticleActivityEntity, (activity) => activity.article)
  activities!: ArticleActivityEntity[];
}

@Entity('article_redirects')
@Unique(['siteId', 'fromSlug'])
export class ArticleRedirectEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'site_id', type: 'uuid' })
  siteId!: string;

  @ManyToOne(() => SiteEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'site_id' })
  site!: SiteEntity;

  @Column({ name: 'article_id', type: 'uuid' })
  articleId!: string;

  @ManyToOne(() => ArticleEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'article_id' })
  article!: ArticleEntity;

  @Column({ name: 'from_slug', type: 'varchar', length: 160 })
  fromSlug!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

@Entity('article_activities')
export class ArticleActivityEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'article_id', type: 'uuid' })
  articleId!: string;

  @ManyToOne(() => ArticleEntity, (article) => article.activities, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'article_id' })
  article!: ArticleEntity;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => UserEntity, (user) => user.articleActivities, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'user_id' })
  user!: UserEntity;

  @Column({ type: 'varchar', length: 32 })
  type!: ArticleActivityType;

  @Column({ type: 'text', nullable: true })
  message!: string | null;

  @Column({ name: 'from_status', type: 'varchar', length: 32, nullable: true })
  fromStatus!: ArticleStatus | null;

  @Column({ name: 'to_status', type: 'varchar', length: 32, nullable: true })
  toStatus!: ArticleStatus | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

@Entity('site_content_templates')
@Unique(['siteId', 'kind', 'key', 'version'])
export class SiteContentTemplateEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'site_id', type: 'uuid' })
  siteId!: string;

  @ManyToOne(() => SiteEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'site_id' })
  site!: SiteEntity;

  @Column({ type: 'varchar', length: 32 })
  kind!: ContentTemplateKind;

  @Column({ type: 'varchar', length: 80 })
  key!: string;

  @Column({ type: 'varchar', length: 40 })
  version!: string;

  @Column({ type: 'varchar', length: 160 })
  name!: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  config!: Record<string, unknown>;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

@Entity('article_section_settings')
@Unique(['siteId'])
export class ArticleSectionSettingsEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'site_id', type: 'uuid' })
  siteId!: string;

  @ManyToOne(() => SiteEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'site_id' })
  site!: SiteEntity;

  @Column({ name: 'list_template_key', type: 'varchar', length: 80 })
  listTemplateKey!: string;

  @Column({ name: 'list_template_version', type: 'varchar', length: 40 })
  listTemplateVersion!: string;

  @Column({
    name: 'list_template_config',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  listTemplateConfig!: Record<string, unknown>;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('article_related_items')
@Unique(['articleId', 'relatedArticleId'])
export class ArticleRelatedItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'article_id', type: 'uuid' })
  articleId!: string;

  @ManyToOne(() => ArticleEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'article_id' })
  article!: ArticleEntity;

  @Column({ name: 'related_article_id', type: 'uuid' })
  relatedArticleId!: string;

  @ManyToOne(() => ArticleEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'related_article_id' })
  relatedArticle!: ArticleEntity;

  @Column({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder!: number;
}

@Entity('article_versions')
@Unique(['articleId', 'versionNumber'])
export class ArticleVersionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'article_id', type: 'uuid' })
  articleId!: string;

  @ManyToOne(() => ArticleEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'article_id' })
  article!: ArticleEntity;

  @Column({ name: 'version_number', type: 'integer' })
  versionNumber!: number;

  @Column({ type: 'jsonb' })
  snapshot!: Record<string, unknown>;

  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId!: string | null;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'actor_user_id' })
  actor!: UserEntity | null;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

@Entity('content_events')
@Index(['groupId'])
export class ContentEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'site_id', type: 'uuid' })
  siteId!: string;

  @Column({ name: 'entity_type', type: 'varchar', length: 24 })
  entityType!: ContentEntityType;

  @Column({ name: 'entity_id', type: 'uuid' })
  entityId!: string;

  @Column({ name: 'event_type', type: 'varchar', length: 40 })
  eventType!: ContentEventType;

  @Column({ name: 'actor_kind', type: 'varchar', length: 16 })
  actorKind!: ContentActorKind;

  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId!: string | null;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'actor_user_id' })
  actor!: UserEntity | null;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  before!: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  after!: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  changes!: Record<string, unknown> | null;

  @Column({ name: 'version_id', type: 'uuid', nullable: true })
  versionId!: string | null;

  @Column({ name: 'group_id', type: 'uuid', nullable: true })
  groupId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

@Entity('content_status_schedules')
export class ContentStatusScheduleEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'site_id', type: 'uuid' })
  siteId!: string;

  @Column({ name: 'entity_type', type: 'varchar', length: 24 })
  entityType!: ContentEntityType;

  @Column({ name: 'entity_id', type: 'uuid' })
  entityId!: string;

  @Column({ name: 'target_publication_state', type: 'varchar', length: 24 })
  targetPublicationState!: PublicationState;

  @Column({ name: 'execute_at', type: 'timestamptz' })
  executeAt!: Date;

  @Column({
    type: 'varchar',
    length: 24,
    default: ContentScheduleStatus.PENDING,
  })
  status!: ContentScheduleStatus;

  @Column({ name: 'requested_by_user_id', type: 'uuid', nullable: true })
  requestedByUserId!: string | null;

  @Column({ name: 'attempt_count', type: 'integer', default: 0 })
  attemptCount!: number;

  @Column({ name: 'executed_at', type: 'timestamptz', nullable: true })
  executedAt!: Date | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

@Entity('pages')
@Unique(['siteId', 'slug'])
export class PageEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'site_id', type: 'uuid' })
  siteId!: string;

  @ManyToOne(() => SiteEntity, (site) => site.pages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'site_id' })
  site!: SiteEntity;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  @Column({ type: 'varchar', length: 160 })
  slug!: string;

  @Column({ type: 'varchar', length: 24, default: PageKind.PAGE })
  kind!: PageKind;

  @Column({ type: 'varchar', length: 24, default: PageStatus.DRAFT })
  status!: PageStatus;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  blocks!: PageBlock[];

  @Column({ name: 'seo_title', type: 'varchar', length: 240, nullable: true })
  seoTitle!: string | null;

  @Column({
    name: 'seo_description',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  seoDescription!: string | null;

  @Column({
    name: 'canonical_url',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  canonicalUrl!: string | null;

  @Column({ name: 'no_index', type: 'boolean', default: false })
  noIndex!: boolean;

  @Column({
    name: 'system_template_key',
    type: 'varchar',
    length: 80,
    nullable: true,
  })
  systemTemplateKey!: string | null;

  @Column({
    name: 'system_template_version',
    type: 'varchar',
    length: 40,
    nullable: true,
  })
  systemTemplateVersion!: string | null;

  @Column({
    name: 'published_system_template_key',
    type: 'varchar',
    length: 80,
    nullable: true,
  })
  publishedSystemTemplateKey!: string | null;

  @Column({
    name: 'published_system_template_version',
    type: 'varchar',
    length: 40,
    nullable: true,
  })
  publishedSystemTemplateVersion!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

export type PrivacyLegalSection = {
  key: string;
  title: string;
  body: string;
};

export type PrivacyLegalRule = {
  sectionKey: string;
  when?:
    | {
        setting:
          'dataCategories' | 'purposes' | 'services' | 'collectionMethods';
        hasAny?: string[];
      }
    | { boolean: 'thirdPartyTransfer' | 'cookies' };
};

export type PrivacyModelSectionDiff = {
  key: string;
  status: 'added' | 'removed' | 'changed' | 'unchanged';
  sourceTitle: string | null;
  targetTitle: string | null;
};

export type PrivacySettings = {
  dataCategories?: string[];
  purposes?: string[];
  services?: string[];
  collectionMethods?: string[];
  otherServiceDescription?: string;
  thirdPartyTransfer?: boolean;
  thirdPartyDescription?: string;
  cookies?: boolean;
  [key: string]: unknown;
};

@Entity('privacy_legal_models')
@Check('CHK_privacy_legal_models_status', `"status" IN ('draft', 'approved')`)
export class PrivacyLegalModelEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 80 })
  version!: string;

  @Column({ type: 'varchar', length: 20, default: 'draft' })
  status!: 'draft' | 'approved';

  @Column({ type: 'jsonb' })
  sections!: PrivacyLegalSection[];

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  rules!: PrivacyLegalRule[];

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;

  @Column({ name: 'approved_by_user_id', type: 'uuid', nullable: true })
  approvedByUserId!: string | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'approved_by_user_id' })
  approvedBy!: UserEntity | null;

  @Column({ name: 'change_summary', type: 'text', nullable: true })
  changeSummary!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => PrivacyPolicyStateEntity, (state) => state.legalModel)
  policyStates!: PrivacyPolicyStateEntity[];
}

@Entity('privacy_policy_states')
@Unique(['siteId'])
@Unique(['pageId'])
@Check('CHK_privacy_policy_states_mode', `"mode" IN ('automatic', 'manual')`)
export class PrivacyPolicyStateEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'site_id', type: 'uuid' })
  siteId!: string;

  @ManyToOne(() => SiteEntity, (site) => site.privacyPolicyStates, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'site_id' })
  site!: SiteEntity;

  @Column({ name: 'page_id', type: 'uuid' })
  pageId!: string;

  @ManyToOne(() => PageEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'page_id' })
  page!: PageEntity;

  @Column({ name: 'legal_model_id', type: 'uuid' })
  legalModelId!: string;

  @ManyToOne(() => PrivacyLegalModelEntity, (model) => model.policyStates, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'legal_model_id' })
  legalModel!: PrivacyLegalModelEntity;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  settings!: PrivacySettings;

  @Column({ name: 'display_template_key', type: 'varchar', length: 80 })
  displayTemplateKey!: string;

  @Column({ name: 'display_template_version', type: 'varchar', length: 40 })
  displayTemplateVersion!: string;

  @Column({
    name: 'display_template_config',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  displayTemplateConfig!: Record<string, unknown>;

  @Column({ name: 'automatic_snapshot', type: 'text', nullable: true })
  automaticSnapshot!: string | null;

  @Column({ name: 'manual_snapshot', type: 'text', nullable: true })
  manualSnapshot!: string | null;

  @Column({ name: 'published_snapshot', type: 'text', nullable: true })
  publishedSnapshot!: string | null;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt!: Date | null;

  @Column({
    name: 'published_legal_model_version',
    type: 'varchar',
    length: 80,
    nullable: true,
  })
  publishedLegalModelVersion!: string | null;

  @Column({
    name: 'published_display_template_key',
    type: 'varchar',
    length: 80,
    nullable: true,
  })
  publishedDisplayTemplateKey!: string | null;

  @Column({
    name: 'published_display_template_version',
    type: 'varchar',
    length: 40,
    nullable: true,
  })
  publishedDisplayTemplateVersion!: string | null;

  @Column({
    name: 'published_display_template_config',
    type: 'jsonb',
    nullable: true,
  })
  publishedDisplayTemplateConfig!: Record<string, unknown> | null;

  @Column({ name: 'deferred_legal_model_id', type: 'uuid', nullable: true })
  deferredLegalModelId!: string | null;

  @Column({
    name: 'model_review_source_version',
    type: 'varchar',
    length: 80,
    nullable: true,
  })
  modelReviewSourceVersion!: string | null;

  @Column({ name: 'model_review_comparison', type: 'jsonb', nullable: true })
  modelReviewComparison!: PrivacyModelSectionDiff[] | null;

  @Column({ type: 'varchar', length: 20, default: 'automatic' })
  mode!: 'automatic' | 'manual';

  @Column({
    name: 'input_fingerprint',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  inputFingerprint!: string | null;

  @Column({ name: 'legacy_content_preserved', type: 'boolean', default: false })
  legacyContentPreserved!: boolean;

  @Column({ name: 'generated_at', type: 'timestamptz', nullable: true })
  generatedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('banners')
export class BannerEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'site_id', type: 'uuid' })
  siteId!: string;

  @ManyToOne(() => SiteEntity, (site) => site.banners, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'site_id' })
  site!: SiteEntity;

  @Column({ name: 'media_id', type: 'uuid', nullable: true })
  mediaId!: string | null;

  @ManyToOne(() => MediaEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'media_id' })
  media!: MediaEntity | null;

  @Column({ type: 'varchar', length: 160 })
  name!: string;

  @Column({ type: 'varchar', length: 40 })
  placement!: BannerPlacement;

  @Column({ type: 'varchar', length: 200, nullable: true })
  title!: string | null;

  @Column({ name: 'link_url', type: 'varchar', length: 500, nullable: true })
  linkUrl!: string | null;

  @Column({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder!: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

export const databaseEntities = [
  UserEntity,
  WorkspaceEntity,
  SiteEntity,
  WorkspaceMembershipEntity,
  CategoryEntity,
  CategoryRedirectEntity,
  CategoryActivityEntity,
  AuthorEntity,
  MediaEntity,
  ArticleEntity,
  ArticleRedirectEntity,
  ArticleActivityEntity,
  SiteContentTemplateEntity,
  ArticleSectionSettingsEntity,
  ArticleRelatedItemEntity,
  ArticleVersionEntity,
  ContentEventEntity,
  ContentStatusScheduleEntity,
  PageEntity,
  PrivacyLegalModelEntity,
  PrivacyPolicyStateEntity,
  BannerEntity,
  AuditLogEntity,
];
