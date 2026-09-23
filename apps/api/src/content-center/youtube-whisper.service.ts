import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DataSource } from 'typeorm';
import { isSocialUrl } from './social-address';
import { YoutubeTranscriptionSettingsService } from './youtube-transcription-settings.service';

const GROQ_API = 'https://api.groq.com/openai/v1';
const MAX_UPLOAD_BYTES = 24 * 1024 * 1024;
const TRANSCRIPT_MARKER = '\n\nТранскрипция видео:\n';

type YoutubePage = {
  url: string;
  title: string;
  status: string;
  content?: string;
  transcript?: string;
  transcriptStatus?: 'queued' | 'processing' | 'succeeded' | 'failed';
  transcriptError?: string;
  [key: string]: unknown;
};
type Snapshot = { pages?: YoutubePage[]; [key: string]: unknown };
type Job = {
  id: string;
  workspace_id: string;
  material_id: string;
  video_id: string;
  video_url: string;
  title: string;
  status: 'queued' | 'processing' | 'succeeded' | 'failed';
  attempts: number;
  transcript: string | null;
  error: string | null;
  model: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export class YoutubeWhisperError extends Error {}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function extractVideoId(value: string): string | null {
  try {
    const url = new URL(value);
    const id = url.searchParams.get('v');
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

function safeMessage(error: unknown): string {
  if (error instanceof YoutubeWhisperError) return error.message;
  if (error instanceof Error && error.message.includes('yt-dlp'))
    return 'Не удалось скачать аудиодорожку YouTube. Проверьте, что видео публичное и доступно серверу.';
  return 'Не удалось расшифровать видео. Повторите попытку позже.';
}

@Injectable()
export class YoutubeWhisperService {
  private readonly logger = new Logger(YoutubeWhisperService.name);
  private timer?: ReturnType<typeof setInterval>;
  private working = false;

  constructor(
    private readonly db: DataSource,
    private readonly settings: YoutubeTranscriptionSettingsService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.processNext().catch(() =>
        this.logger.error('Не удалось выполнить очередь расшифровки YouTube'),
      );
    }, 3000);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async checkConnection() {
    const credentials = await this.settings.credentials();
    try {
      const response = await fetch(`${GROQ_API}/models`, {
        headers: { Authorization: `Bearer ${credentials.apiKey}` },
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error();
      const payload = object(await response.json());
      const models = Array.isArray(payload.data) ? payload.data : [];
      if (
        !models.some((item: unknown) => object(item).id === credentials.model)
      )
        throw new YoutubeWhisperError(
          'Ключ принят, но выбранная модель Whisper недоступна в Groq.',
        );
      return this.settings.markVerified(credentials.revision);
    } catch (error) {
      if (error instanceof YoutubeWhisperError) throw error;
      throw new YoutubeWhisperError(
        'Groq не подтвердил ключ. Проверьте ключ и доступность API.',
      );
    }
  }

  async enqueue(
    workspaceId: string,
    materialId: string,
    expectedRevision: number,
  ) {
    const [material] = await this.db.query<
      Array<{
        revision: number;
        kind: string;
        url_category: string;
        source_url: string | null;
        site_pages: Snapshot | null;
      }>
    >(
      `SELECT revision,kind,url_category,source_url,site_pages
       FROM cc_materials WHERE workspace_id=$1 AND id=$2`,
      [workspaceId, materialId],
    );
    if (!material) throw new NotFoundException('Материал не найден');
    if (
      material.revision !== expectedRevision ||
      material.kind !== 'url' ||
      material.url_category !== 'social' ||
      !isSocialUrl(material.source_url, 'youtube')
    )
      throw new BadRequestException(
        'Расшифровка доступна только для YouTube-канала.',
      );
    if (!material.site_pages?.pages)
      throw new BadRequestException(
        'Сначала обновите сбор YouTube, чтобы получить список видео.',
      );

    const videos = material.site_pages.pages
      .map((page) => ({ page, videoId: extractVideoId(page.url) }))
      .filter(
        (item): item is { page: YoutubePage; videoId: string } =>
          Boolean(item.videoId) && item.page.status === 'loaded',
      );
    if (!videos.length)
      throw new BadRequestException('В сохранённом сборе нет доступных видео.');

    await this.db.transaction(async (manager) => {
      for (const { page, videoId } of videos) {
        await manager.query(
          `INSERT INTO cc_youtube_transcriptions
             (workspace_id,material_id,video_id,video_url,title,status,model)
           VALUES ($1,$2,$3,$4,$5,'queued',(SELECT model FROM platform_transcription_settings WHERE id='groq'))
           ON CONFLICT (material_id,video_id) DO UPDATE
             SET video_url=EXCLUDED.video_url,title=EXCLUDED.title,model=EXCLUDED.model`,
          [workspaceId, materialId, videoId, page.url, page.title],
        );
      }
      const [snapshot] = await manager.query<Array<{ site_pages: Snapshot }>>(
        'SELECT site_pages FROM cc_materials WHERE workspace_id=$1 AND id=$2 FOR UPDATE',
        [workspaceId, materialId],
      );
      await this.writeStatuses(
        manager,
        workspaceId,
        materialId,
        snapshot.site_pages,
      );
    });
    return this.list(workspaceId, materialId);
  }

  async list(workspaceId: string, materialId: string) {
    const jobs = await this.db.query<Job[]>(
      `SELECT id,video_id,video_url,title,status,attempts,error,model,created_at,started_at,finished_at
       FROM cc_youtube_transcriptions
       WHERE workspace_id=$1 AND material_id=$2 ORDER BY created_at,video_id`,
      [workspaceId, materialId],
    );
    const counts = jobs.reduce(
      (all, job) => ({ ...all, [job.status]: (all[job.status] ?? 0) + 1 }),
      {} as Record<string, number>,
    );
    return { jobs, counts, total: jobs.length };
  }

  async retry(workspaceId: string, materialId: string) {
    await this.db.query(
      `UPDATE cc_youtube_transcriptions
       SET status='queued',attempts=0,error=NULL,started_at=NULL,finished_at=NULL,heartbeat_at=NULL
       WHERE workspace_id=$1 AND material_id=$2 AND status='failed'`,
      [workspaceId, materialId],
    );
    await this.syncMaterialStatuses(workspaceId, materialId);
    return this.list(workspaceId, materialId);
  }

  private async processNext() {
    if (this.working) return;
    this.working = true;
    try {
      await this.db.query(
        `UPDATE cc_youtube_transcriptions
         SET status='queued',heartbeat_at=NULL
         WHERE status='processing' AND COALESCE(heartbeat_at,started_at) < now()-interval '10 minutes'`,
      );
      const [job] = await this.db.query<Job[]>(
        `WITH claimed AS (
           UPDATE cc_youtube_transcriptions
           SET status='processing',attempts=attempts+1,started_at=now(),heartbeat_at=now(),error=NULL
           WHERE id=(
             SELECT id FROM cc_youtube_transcriptions
             WHERE status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
           ) RETURNING *
         ) SELECT * FROM claimed`,
      );
      if (!job) return;
      await this.syncMaterialStatuses(job.workspace_id, job.material_id);
      const heartbeat = setInterval(() => {
        void this.db
          .query(
            `UPDATE cc_youtube_transcriptions SET heartbeat_at=now() WHERE id=$1 AND status='processing'`,
            [job.id],
          )
          .catch(() => undefined);
      }, 15_000);
      heartbeat.unref();
      try {
        const transcript = await this.transcribeVideo(job.video_url);
        await this.db.query(
          `UPDATE cc_youtube_transcriptions
           SET status='succeeded',transcript=$2,error=NULL,finished_at=now(),heartbeat_at=NULL
           WHERE id=$1 AND status='processing'`,
          [job.id, transcript],
        );
        await this.syncMaterialStatuses(job.workspace_id, job.material_id);
      } catch (error) {
        await this.db.query(
          `UPDATE cc_youtube_transcriptions
           SET status='failed',error=$2,finished_at=now(),heartbeat_at=NULL
           WHERE id=$1 AND status='processing'`,
          [job.id, safeMessage(error)],
        );
        await this.syncMaterialStatuses(job.workspace_id, job.material_id);
      } finally {
        clearInterval(heartbeat);
      }
    } finally {
      this.working = false;
    }
  }

  private async transcribeVideo(videoUrl: string): Promise<string> {
    const credentials = await this.settings.credentials();
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'wispo-youtube-'),
    );
    try {
      const source = path.join(directory, 'source.%(ext)s');
      await this.run(
        'yt-dlp',
        [
          '--no-playlist',
          '--no-progress',
          '--no-warnings',
          '--extract-audio',
          '--audio-format',
          'mp3',
          '--audio-quality',
          '64K',
          '--output',
          source,
          '--',
          videoUrl,
        ],
        AbortSignal.timeout(25 * 60_000),
      );
      const files = await fs.readdir(directory);
      const audioName = files.find((file) => file.endsWith('.mp3'));
      if (!audioName) throw new YoutubeWhisperError('YouTube не отдал аудио.');
      const audioPath = path.join(directory, audioName);
      const info = await fs.stat(audioPath);
      const chunks =
        info.size <= MAX_UPLOAD_BYTES
          ? [audioPath]
          : await this.splitAudio(audioPath, directory);
      const texts: string[] = [];
      for (const chunk of chunks) {
        texts.push(
          await this.transcribeChunk(
            chunk,
            credentials.apiKey,
            credentials.model,
          ),
        );
      }
      const transcript = texts.join('\n\n').trim();
      if (!transcript)
        throw new YoutubeWhisperError('Whisper вернул пустую расшифровку.');
      return transcript.slice(0, 300_000);
    } finally {
      await fs
        .rm(directory, { recursive: true, force: true })
        .catch(() => undefined);
    }
  }

  private async splitAudio(audioPath: string, directory: string) {
    const pattern = path.join(directory, 'chunk-%03d.mp3');
    await this.run(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        audioPath,
        '-f',
        'segment',
        '-segment_time',
        '900',
        '-c',
        'copy',
        '-reset_timestamps',
        '1',
        pattern,
      ],
      AbortSignal.timeout(10 * 60_000),
    );
    const names = (await fs.readdir(directory))
      .filter((name) => /^chunk-\d{3}\.mp3$/.test(name))
      .sort();
    if (!names.length)
      throw new YoutubeWhisperError('Не удалось разделить аудио на части.');
    return names.map((name) => path.join(directory, name));
  }

  private async transcribeChunk(
    filePath: string,
    apiKey: string,
    model: string,
  ) {
    const data = await fs.readFile(filePath);
    if (data.byteLength > MAX_UPLOAD_BYTES)
      throw new YoutubeWhisperError(
        'Аудиофрагмент превышает лимит Groq 25 МБ.',
      );
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(data)], { type: 'audio/mpeg' }),
      'audio.mp3',
    );
    form.append('model', model);
    form.append('response_format', 'json');
    let response: Response;
    try {
      response = await fetch(`${GROQ_API}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        redirect: 'error',
        signal: AbortSignal.timeout(10 * 60_000),
      });
    } catch {
      throw new YoutubeWhisperError(
        'Groq не ответил вовремя. Расшифровка не сохранена.',
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401)
        throw new YoutubeWhisperError(
          'Groq отклонил ключ. Замените его в настройках.',
        );
      if (response.status === 429)
        throw new YoutubeWhisperError(
          'Groq сообщил о лимите запросов. Повторите позже.',
        );
      throw new YoutubeWhisperError('Groq не принял аудиофайл.');
    }
    const payload = object(await response.json());
    const text = typeof payload.text === 'string' ? payload.text.trim() : '';
    if (!text) throw new YoutubeWhisperError('Groq вернул пустой текст.');
    return text;
  }

  private async run(command: string, args: string[], signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';
      const abort = () => child.kill('SIGTERM');
      signal.addEventListener('abort', abort, { once: true });
      child.stderr?.on('data', (chunk: Buffer) => {
        if (stderr.length < 2000) stderr += chunk.toString('utf8');
      });
      child.once('error', (error) => {
        signal.removeEventListener('abort', abort);
        reject(
          new YoutubeWhisperError(
            error.message.includes('ENOENT')
              ? `${command} не установлен на сервере.`
              : 'Не удалось подготовить аудиодорожку YouTube.',
          ),
        );
      });
      child.once('close', (code) => {
        signal.removeEventListener('abort', abort);
        if (signal.aborted)
          return reject(
            new YoutubeWhisperError(
              'Скачивание аудио превысило лимит времени.',
            ),
          );
        if (code !== 0)
          return reject(
            new YoutubeWhisperError(
              stderr.includes('Sign in')
                ? 'YouTube не разрешил скачать это видео без входа в аккаунт.'
                : 'Не удалось скачать аудиодорожку YouTube.',
            ),
          );
        resolve();
      });
    });
  }

  private async syncMaterialStatuses(workspaceId: string, materialId: string) {
    await this.db.transaction(async (manager) => {
      const [row] = await manager.query<Array<{ site_pages: Snapshot | null }>>(
        'SELECT site_pages FROM cc_materials WHERE workspace_id=$1 AND id=$2 FOR UPDATE',
        [workspaceId, materialId],
      );
      if (!row?.site_pages) return;
      await this.writeStatuses(
        manager,
        workspaceId,
        materialId,
        row.site_pages,
      );
    });
  }

  private async writeStatuses(
    manager: Pick<DataSource, 'query'>,
    workspaceId: string,
    materialId: string,
    snapshot: Snapshot | null,
  ) {
    if (!snapshot?.pages) return;
    const jobs = await manager.query<
      Array<
        Pick<Job, 'video_id' | 'video_url' | 'status' | 'transcript' | 'error'>
      >
    >(
      `SELECT video_id,video_url,status,transcript,error FROM cc_youtube_transcriptions
       WHERE workspace_id=$1 AND material_id=$2`,
      [workspaceId, materialId],
    );
    const byUrl = new Map(jobs.map((job) => [job.video_url, job]));
    for (const page of snapshot.pages) {
      const job = byUrl.get(page.url);
      if (!job) continue;
      page.transcriptStatus = job.status;
      page.transcriptError = job.error ?? undefined;
      if (job.status === 'succeeded' && job.transcript) {
        page.transcript = job.transcript;
        const base = (page.content ?? '').split(TRANSCRIPT_MARKER)[0].trimEnd();
        page.content = `${base}${TRANSCRIPT_MARKER}${job.transcript}`;
      }
    }
    await manager.query(
      `UPDATE cc_materials SET site_pages=$3::jsonb,site_checked_at=COALESCE(site_checked_at,now()),updated_at=now()
       WHERE workspace_id=$1 AND id=$2`,
      [workspaceId, materialId, JSON.stringify(snapshot)],
    );
  }
}
